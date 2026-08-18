import { ColorRules } from '@/types';

export interface Rgb01 {
    r: number;
    g: number;
    b: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Convert `#RRGGBB` (hash optional) to Fusion's 0..1 float channels. */
export function hexToRgb01(hex: string): Rgb01 {
    const match = HEX_RE.exec(hex.trim());
    if (!match) {
        throw new Error(`Invalid hex colour: ${hex}`);
    }
    const int = parseInt(match[1], 16);
    return {
        r: ((int >> 16) & 0xff) / 255,
        g: ((int >> 8) & 0xff) / 255,
        b: (int & 0xff) / 255,
    };
}

/**
 * Resolve a caption's fill colour. Precedence, highest first:
 *   1. an explicit per-caption override
 *   2. the colour assigned to its track
 *   3. the fallback (the preset's own fill colour)
 */
export function resolveCaptionColor(args: {
    captionId: string;
    trackIndex: number;
    rules?: ColorRules;
    fallback: Rgb01;
}): Rgb01 {
    const { captionId, trackIndex, rules, fallback } = args;
    if (!rules) return fallback;

    const override = rules.captionOverrides?.[captionId];
    if (override) return hexToRgb01(override);

    const trackColor = rules.trackColors?.[trackIndex];
    if (trackColor) return hexToRgb01(trackColor);

    return fallback;
}

/** Return a copy of `settings` with the fill channels replaced. */
export function applyColorToSettings(
    settings: Record<string, unknown>,
    rgb: Rgb01,
): Record<string, unknown> {
    return {
        ...settings,
        FillColorRed: rgb.r,
        FillColorGreen: rgb.g,
        FillColorBlue: rgb.b,
    };
}
