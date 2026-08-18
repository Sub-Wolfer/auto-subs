import { CaptionSnapshot, SnapshotEntry } from '@/types';

function genId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const OPERATION_LABELS: Record<SnapshotEntry['operation'], string> = {
    restyle: 'Before restyle',
    generate: 'Before generate',
    'remove-all': 'Before remove all',
    restore: 'Before restore',
};

export function makeSnapshotEntry(
    operation: SnapshotEntry['operation'],
    captions: CaptionSnapshot[],
    label?: string,
): SnapshotEntry {
    return {
        id: genId(),
        label: label ?? `${OPERATION_LABELS[operation]} (${captions.length} captions)`,
        createdAt: new Date().toISOString(),
        operation,
        captions,
    };
}

/**
 * Whether restoring this snapshot should put its caption *text* back, not
 * just its styling.
 *
 * Only true for snapshots taken before an operation that removes or replaces
 * captions, where restore means recreating what was lost. A snapshot taken
 * before a styling change must never rewrite text: the user may have fixed a
 * typo in Resolve since it was captured, and silently reverting that
 * correction is exactly the transcript data loss this feature exists to
 * prevent. The Lua `RestoreSnapshot` endpoint defaults to style-only and
 * takes this as an explicit `restoreText` flag.
 */
export function shouldRestoreText(operation: SnapshotEntry['operation']): boolean {
    return operation === 'generate' || operation === 'remove-all';
}

/** Newest first, capped at `max`. Snapshots hold full styling for every
 *  caption, so an uncapped history would grow without bound. */
export function pruneHistory(entries: SnapshotEntry[], max: number): SnapshotEntry[] {
    return [...entries]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(0, max));
}

/**
 * Cap how many timelines history is kept for, evicting the least recently
 * updated first (a key's recency is its newest snapshot's `createdAt`; a key
 * with no entries left is the oldest of all).
 *
 * Per-key pruning alone is not enough: `entriesByKey` accumulates a key for
 * every project/timeline ever touched, and every one of them holds full macro
 * settings for every caption, all in a single JSON file.
 */
export function pruneKeys(
    entriesByKey: Record<string, SnapshotEntry[]>,
    maxKeys: number,
): Record<string, SnapshotEntry[]> {
    const keys = Object.keys(entriesByKey);
    if (keys.length <= maxKeys) return entriesByKey;

    const updatedAt = (key: string) =>
        (entriesByKey[key] ?? []).reduce(
            (newest, entry) => (entry.createdAt > newest ? entry.createdAt : newest),
            '',
        );

    const kept: Record<string, SnapshotEntry[]> = {};
    for (const key of keys
        .slice()
        .sort((a, b) => updatedAt(b).localeCompare(updatedAt(a)))
        .slice(0, Math.max(0, maxKeys))) {
        kept[key] = entriesByKey[key];
    }
    return kept;
}

export function historyKey(projectName: string, timelineId: string): string {
    return `${projectName} ${timelineId}`;
}
