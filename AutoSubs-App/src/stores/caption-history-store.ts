import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';
import { SnapshotEntry } from '@/types';
import { pruneHistory } from '@/lib/caption-snapshots';

const STORE_FILE = 'autosubs-caption-history.json';
const STORE_KEY = 'history';
const MAX_ENTRIES_PER_TIMELINE = 10;

interface CaptionHistoryStore {
    entriesByKey: Record<string, SnapshotEntry[]>;
    addEntry: (key: string, entry: SnapshotEntry) => void;
    removeEntry: (key: string, entryId: string) => void;
    clearKey: (key: string) => void;
}

export const useCaptionHistoryStore = create<CaptionHistoryStore>()(
    persist(
        (set) => ({
            entriesByKey: {},
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
        }),
        {
            name: STORE_KEY,
            storage: createTauriStorage<Pick<CaptionHistoryStore, 'entriesByKey'>>(
                STORE_FILE,
                STORE_KEY,
            ),
            partialize: (state) => ({ entriesByKey: state.entriesByKey }),
        },
    ),
);
