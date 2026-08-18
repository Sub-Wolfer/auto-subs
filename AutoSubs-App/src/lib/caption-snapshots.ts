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

/** Newest first, capped at `max`. Snapshots hold full styling for every
 *  caption, so an uncapped history would grow without bound. */
export function pruneHistory(entries: SnapshotEntry[], max: number): SnapshotEntry[] {
    return [...entries]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(0, max));
}

export function historyKey(projectName: string, timelineId: string): string {
    return `${projectName} ${timelineId}`;
}
