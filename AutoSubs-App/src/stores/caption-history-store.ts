import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage, flushTauriStorage } from '@/lib/tauri-storage';
import { SnapshotEntry } from '@/types';
import { pruneHistory } from '@/lib/caption-snapshots';

const STORE_FILE = 'autosubs-caption-history.json';
const STORE_KEY = 'history';
const MAX_ENTRIES_PER_TIMELINE = 10;

interface CaptionHistoryStore {
    entriesByKey: Record<string, SnapshotEntry[]>;
    /** False until the persisted history has been merged in; see
     *  `hydrateCaptionHistoryStore`. Nothing may be added before then. */
    isHydrated: boolean;
    addEntry: (key: string, entry: SnapshotEntry) => void;
    removeEntry: (key: string, entryId: string) => void;
    clearKey: (key: string) => void;
    setHydrated: () => void;
}

export const useCaptionHistoryStore = create<CaptionHistoryStore>()(
    persist(
        (set) => ({
            entriesByKey: {},
            isHydrated: false,
            addEntry: (key, entry) =>
                set((state) => ({
                    entriesByKey: {
                        ...state.entriesByKey,
                        [key]: pruneHistory(
                            [entry, ...(state.entriesByKey[key] ?? [])],
                            MAX_ENTRIES_PER_TIMELINE,
                        ),
                    },
                })),
            removeEntry: (key, entryId) =>
                set((state) => ({
                    entriesByKey: {
                        ...state.entriesByKey,
                        [key]: (state.entriesByKey[key] ?? []).filter((e) => e.id !== entryId),
                    },
                })),
            clearKey: (key) =>
                set((state) => {
                    const next = { ...state.entriesByKey };
                    delete next[key];
                    return { entriesByKey: next };
                }),
            setHydrated: () => set({ isHydrated: true }),
        }),
        {
            name: STORE_KEY,
            storage: createTauriStorage<Pick<CaptionHistoryStore, 'entriesByKey'>>(
                STORE_FILE,
                STORE_KEY,
            ),
            // Only the entries are persisted — never the hydration flag.
            partialize: (state) => ({ entriesByKey: state.entriesByKey }),
            // Rehydration is manual (see below) so callers can await it
            // before adding an entry. With automatic hydration, an entry
            // added during the async load is overwritten when the persisted
            // state lands — losing exactly the snapshot a mutation depends on.
            skipHydration: true,
        },
    ),
);

let hydration: Promise<void> | null = null;

/**
 * Merge the persisted history into the store, once per app run. Mirrors
 * `hydrateSettingsStore`'s skipHydration + explicit rehydrate() pattern.
 *
 * Idempotent and safe to await from anywhere: the shared promise means the
 * mount effect and a caller about to add an entry both wait on the same load
 * rather than racing it.
 */
export function hydrateCaptionHistoryStore(): Promise<void> {
    if (!hydration) {
        hydration = (async () => {
            try {
                await useCaptionHistoryStore.persist.rehydrate();
            } catch (error) {
                // A history file that cannot be read must not block the
                // panel; the user simply starts with no snapshots.
                console.error('Error hydrating caption history store:', error);
            } finally {
                useCaptionHistoryStore.getState().setHydrated();
            }
        })();
    }
    return hydration;
}

/**
 * Await the persisted write triggered by the last store mutation, rejecting
 * if it failed. `addEntry` is synchronous and the write behind it is not, so
 * a caller that is about to mutate the timeline must flush first — otherwise
 * "persist then mutate" is really "queue a write, then mutate", and a failed
 * write leaves the operation with no recoverable undo.
 */
export function flushCaptionHistory(): Promise<void> {
    return flushTauriStorage(STORE_FILE);
}
