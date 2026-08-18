import { describe, it, expect } from 'vitest';
import {
    makeSnapshotEntry,
    pruneHistory,
    historyKey,
    shouldRestoreText,
    pruneKeys,
} from './caption-snapshots';
import { CaptionSnapshot, SnapshotEntry } from '@/types';

const caption: CaptionSnapshot = {
    captionId: 'c1',
    trackIndex: 3,
    startFrame: 0,
    endFrame: 10,
    text: 'HELLO',
    macroSettings: { Font: 'Montserrat' },
};

describe('makeSnapshotEntry', () => {
    it('records the operation and captions', () => {
        const entry = makeSnapshotEntry('restyle', [caption]);
        expect(entry.operation).toBe('restyle');
        expect(entry.captions).toHaveLength(1);
    });

    it('generates a unique id per entry', () => {
        const a = makeSnapshotEntry('restyle', [caption]);
        const b = makeSnapshotEntry('restyle', [caption]);
        expect(a.id).not.toBe(b.id);
    });

    it('derives a default label mentioning the caption count', () => {
        const entry = makeSnapshotEntry('restyle', [caption]);
        expect(entry.label).toContain('1');
    });

    it('honours an explicit label', () => {
        const entry = makeSnapshotEntry('restyle', [caption], 'before yellow');
        expect(entry.label).toBe('before yellow');
    });
});

describe('pruneHistory', () => {
    const entries: SnapshotEntry[] = [1, 2, 3, 4, 5].map(n => ({
        id: `e${n}`,
        label: `entry ${n}`,
        createdAt: `2026-08-1${n}T00:00:00.000Z`,
        operation: 'restyle',
        captions: [],
    }));

    it('keeps the newest entries and drops the oldest', () => {
        const kept = pruneHistory(entries, 3);
        expect(kept.map(e => e.id)).toEqual(['e5', 'e4', 'e3']);
    });

    it('returns everything when under the limit', () => {
        expect(pruneHistory(entries, 10)).toHaveLength(5);
    });

    it('never returns more than max', () => {
        expect(pruneHistory(entries, 0)).toHaveLength(0);
    });
});

describe('pruneKeys', () => {
    const entryAt = (createdAt: string): SnapshotEntry => ({
        id: `id-${createdAt}`,
        label: 'entry',
        createdAt,
        operation: 'restyle',
        captions: [],
    });

    const byKey = {
        old: [entryAt('2026-08-01T00:00:00.000Z')],
        middle: [entryAt('2026-08-05T00:00:00.000Z')],
        newest: [entryAt('2026-08-09T00:00:00.000Z'), entryAt('2026-08-02T00:00:00.000Z')],
    };

    it('keeps everything when under the cap', () => {
        expect(pruneKeys(byKey, 3)).toBe(byKey);
    });

    it('evicts the least recently updated timelines', () => {
        expect(Object.keys(pruneKeys(byKey, 2)).sort()).toEqual(['middle', 'newest']);
    });

    it('ranks a key by its newest entry, not its oldest', () => {
        // `newest` also holds an entry older than every entry in `old`.
        expect(Object.keys(pruneKeys(byKey, 1))).toEqual(['newest']);
    });

    it('evicts keys with no entries first', () => {
        const withEmpty = { ...byKey, empty: [] };
        expect(Object.keys(pruneKeys(withEmpty, 3)).sort()).toEqual([
            'middle',
            'newest',
            'old',
        ]);
    });
});

describe('shouldRestoreText', () => {
    it('never restores text for a styling snapshot', () => {
        // Restoring a "Before restyle" entry must not roll back a transcript
        // correction the user made in Resolve after the snapshot was taken.
        expect(shouldRestoreText('restyle')).toBe(false);
    });

    it('restores text for snapshots that precede caption removal or replacement', () => {
        expect(shouldRestoreText('remove-all')).toBe(true);
        expect(shouldRestoreText('generate')).toBe(true);
    });
});

describe('historyKey', () => {
    it('distinguishes timelines within the same project', () => {
        expect(historyKey('proj', 't1')).not.toBe(historyKey('proj', 't2'));
    });

    it('distinguishes projects sharing a timeline id', () => {
        expect(historyKey('a', 't1')).not.toBe(historyKey('b', 't1'));
    });
});
