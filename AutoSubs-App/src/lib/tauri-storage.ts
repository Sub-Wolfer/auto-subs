import { load, Store } from "@tauri-apps/plugin-store";
import type { PersistStorage, StorageValue } from "zustand/middleware";

/**
 * Cache of loaded Tauri `Store` instances, keyed by file path.
 *
 * The Tauri plugin-store backend keys stores by path, so multiple `load()`
 * calls with the same path share the same underlying Rust store. We cache the
 * JS wrapper to avoid creating redundant resource-table entries.
 */
const storeCache = new Map<string, Store>();

async function getStore(path: string): Promise<Store> {
  let store = storeCache.get(path);
  if (!store) {
    store = await load(path, { autoSave: false });
    storeCache.set(path, store);
  }
  return store;
}

/**
 * In-flight (or last failed) write per store file.
 *
 * Zustand's persist middleware calls `setItem` and drops the promise, so a
 * failed write — disk full, permissions — is otherwise completely silent.
 * Callers that must not proceed until the state is actually on disk (e.g. a
 * snapshot that has to exist before the timeline is mutated) await
 * `flushTauriStorage`. A successful write clears its entry; a failed one is
 * kept so a flush that arrives after the failure still sees it, until the
 * next write replaces it.
 */
const pendingWrites = new Map<string, Promise<void>>();

/**
 * Await the most recent write to `path`, rejecting with whatever the write
 * failed with. Resolves immediately when there is nothing outstanding.
 */
export async function flushTauriStorage(path: string): Promise<void> {
  const pending = pendingWrites.get(path);
  if (!pending) return;
  await pending;
}

/**
 * Check whether a key exists in the Tauri store file. Used during manual
 * rehydration to detect first-run (no persisted data) vs. returning users.
 */
export async function hasStoredValue(path: string, key: string): Promise<boolean> {
  const store = await getStore(path);
  return store.has(key);
}

/**
 * Create a zustand `PersistStorage` backed by the official Tauri plugin-store.
 *
 * Unlike `createJSONStorage` (which stores a JSON string), this adapter stores
 * the raw state object directly under `key` in the Tauri store file —
 * preserving the existing on-disk format so current users' settings files
 * continue to work without migration.
 *
 * The `StorageValue` wrapper (`{ state, version }`) that zustand's persist
 * middleware uses internally is unwrapped: only `value.state` is written to
 * disk, and on read the persisted object is re-wrapped as
 * `{ state: <obj>, version: 0 }`.
 *
 * @param path - Tauri store file name (e.g. `"autosubs-store.json"`)
 * @param key - Key under which the state is stored within the file
 */
export function createTauriStorage<T>(
  path: string,
  key: string,
): PersistStorage<T> {
  return {
    getItem: async () => {
      const store = await getStore(path);
      const value = await store.get<T>(key);
      if (value == null) return null;
      return { state: value, version: 0 } as StorageValue<T>;
    },
    setItem: async (_name, value) => {
      const write = (async () => {
        const store = await getStore(path);
        // Unwrap StorageValue — store only the state to preserve file format.
        await store.set(key, value.state);
        await store.save();
      })();
      pendingWrites.set(path, write);
      try {
        await write;
        // Only drop it on success; see pendingWrites.
        if (pendingWrites.get(path) === write) pendingWrites.delete(path);
      } catch (error) {
        // Swallowed here on purpose: persist voids this promise, so
        // rethrowing would surface as an unhandled rejection with nowhere to
        // report it. flushTauriStorage() is the one place the failure is
        // observed; log it so it is never completely invisible.
        console.error(`[tauri-storage] failed to persist ${path}:`, error);
      }
    },
    removeItem: async () => {
      const store = await getStore(path);
      await store.delete(key);
      await store.save();
    },
  };
}
