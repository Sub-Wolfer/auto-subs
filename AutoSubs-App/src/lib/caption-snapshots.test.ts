import { describe, it, expect } from 'vitest';
import { makeSnapshotEntry, pruneHistory, historyKey } from './caption-snapshots';
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

describe('historyKey', () => {
    it('distinguishes timelines within the same project', () => {
        expect(historyKey('proj', 't1')).not.toBe(historyKey('proj', 't2'));
    });

    it('distinguishes projects sharing a timeline id', () => {
        expect(historyKey('a', 't1')).not.toBe(historyKey('b', 't1'));
    });
});
