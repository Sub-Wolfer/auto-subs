import { describe, it, expect } from 'vitest';
import { BUILT_IN_PRESETS } from './built-in-presets';

describe('BUILT_IN_PRESETS', () => {
    it('includes the Shorts Bold preset', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold');
        expect(preset).toBeDefined();
        expect(preset!.builtIn).toBe(true);
    });

    it('positions Shorts Bold clear of the Shorts bottom overlay', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold')!;
        const pos = preset.macroSettings.TextPosition as number[];
        expect(pos[0]).toBe(0.5);
        expect(pos[1]).toBeGreaterThanOrEqual(0.3);
    });

    it('enables wrapping so long captions cannot overflow the frame', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold')!;
        expect(preset.macroSettings.Wrap).toBe(1);
        expect(preset.macroSettings.LayoutType).toBe(1);
        expect(preset.macroSettings.LayoutWidth as number).toBeLessThanOrEqual(0.9);
    });

    it('gives every preset a unique id', () => {
        const ids = BUILT_IN_PRESETS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
