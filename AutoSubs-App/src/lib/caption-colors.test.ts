import { describe, it, expect } from 'vitest';
import { hexToRgb01, resolveCaptionColor, applyColorToSettings } from './caption-colors';

const FALLBACK = { r: 1, g: 1, b: 1 };

describe('hexToRgb01', () => {
    it('converts six-digit hex to 0..1 floats', () => {
        expect(hexToRgb01('#FFE64A')).toEqual({ r: 1, g: 230 / 255, b: 74 / 255 });
    });

    it('accepts hex without a leading hash', () => {
        expect(hexToRgb01('000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('throws on malformed input rather than silently returning black', () => {
        expect(() => hexToRgb01('#ZZZ')).toThrow();
    });
});

describe('resolveCaptionColor', () => {
    it('returns the fallback when no rules are given', () => {
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, fallback: FALLBACK }))
            .toEqual(FALLBACK);
    });

    it('uses the track colour when one matches', () => {
        const rules = { trackColors: { 3: '#000000' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 0, g: 0, b: 0 });
    });

    it('falls back when the track has no colour', () => {
        const rules = { trackColors: { 4: '#000000' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual(FALLBACK);
    });

    it('prefers a caption override over the track colour', () => {
        const rules = { trackColors: { 3: '#000000' }, captionOverrides: { a: '#FFFFFF' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 1, g: 1, b: 1 });
    });

    it('applies an override to only the caption it names', () => {
        const rules = { trackColors: { 3: '#000000' }, captionOverrides: { a: '#FFFFFF' } };
        expect(resolveCaptionColor({ captionId: 'b', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 0, g: 0, b: 0 });
    });
});

describe('applyColorToSettings', () => {
    it('writes fill channels without mutating the input', () => {
        const settings = { Font: 'Montserrat' };
        const out = applyColorToSettings(settings, { r: 1, g: 0.5, b: 0 });
        expect(out.FillColorRed).toBe(1);
        expect(out.FillColorGreen).toBe(0.5);
        expect(out.FillColorBlue).toBe(0);
        expect(out.Font).toBe('Montserrat');
        expect(settings).toEqual({ Font: 'Montserrat' });
    });
});
