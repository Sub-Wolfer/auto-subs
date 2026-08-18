import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { TimelineCaption, SnapshotEntry } from "@/types";
import {
    listCaptions,
    snapshotCaptions,
    restyleSubtitles,
    restoreSnapshot,
} from "@/api/resolve-api";
import { resolveCaptionColor, Rgb01 } from "@/lib/caption-colors";
import { makeSnapshotEntry, historyKey } from "@/lib/caption-snapshots";
import { useCaptionHistoryStore } from "@/stores/caption-history-store";
import { usePresets } from "@/contexts/PresetsContext";
import { TrackColorRow } from "./track-color-row";
import { SnapshotHistoryList } from "./snapshot-history-list";

interface TimelineSubtitlesPanelProps {
    projectName: string;
    timelineId: string;
}

type PanelStatus = { tone: "error" | "info"; message: string; errors?: string[] };

// Server-side error arrays are already capped at 10 (see autosubs_core.lua);
// the UI caps further so one bad batch can't fill the panel with text.
const MAX_SHOWN_ERRORS = 3;

// Shorts Bold is the preset this panel is built around (vertical export,
// safe-zone aware), so it is the sensible default selection — not
// `DEFAULT_PRESET_ID` from PresetsContext, which is the first *built-in*
// preset and unrelated to this workflow.
const DEFAULT_PANEL_PRESET_ID = "builtin:shorts-bold";

/** Convert Fusion's 0..1 float channels back to `#RRGGBB`, for swatch display only. */
function rgb01ToHex({ r, g, b }: Rgb01): string {
    const toHex = (channel: number) =>
        Math.round(Math.min(1, Math.max(0, channel)) * 255)
            .toString(16)
            .padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

/**
 * Lists the AutoSubs captions on the current timeline, lets the user assign
 * a fill colour per video track, and applies a style preset to captions
 * already on the timeline without regenerating them.
 *
 * Every restyle snapshots first and persists that snapshot to history before
 * mutating anything, so a bad bulk restyle can be rolled back — scripted
 * Fusion changes don't reliably land on Resolve's own undo stack.
 */
export function TimelineSubtitlesPanel({ projectName, timelineId }: TimelineSubtitlesPanelProps) {
    const { presets } = usePresets();
    const [captions, setCaptions] = useState<TimelineCaption[]>([]);
    const [presetId, setPresetId] = useState(DEFAULT_PANEL_PRESET_ID);
    const [trackColors, setTrackColors] = useState<Record<number, string>>({});
    const [disabledTracks, setDisabledTracks] = useState<Record<number, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<PanelStatus | null>(null);

    const key = historyKey(projectName, timelineId);
    const entries = useCaptionHistoryStore((s) => s.entriesByKey[key] ?? []);
    const addEntry = useCaptionHistoryStore((s) => s.addEntry);

    const refresh = useCallback(async () => {
        try {
            // listCaptions returns { captions, failed, total, firstError } —
            // not a bare array. `failed` counts captions that could not be read.
            const res = await listCaptions();
            setCaptions(res.captions);
            setStatus(
                res.failed > 0
                    ? {
                          tone: "error",
                          message: `${res.failed} caption(s) could not be read: ${res.firstError ?? "unknown error"}`,
                      }
                    : null,
            );
        } catch (err) {
            setStatus({ tone: "error", message: `Could not read timeline: ${String(err)}` });
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    const tracks = useMemo(() => {
        const counts = new Map<number, number>();
        for (const c of captions) counts.set(c.trackIndex, (counts.get(c.trackIndex) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => a[0] - b[0]);
    }, [captions]);

    const selectedTracks = useMemo(
        () => tracks.map(([i]) => i).filter((i) => !disabledTracks[i]),
        [tracks, disabledTracks],
    );

    const selectedPreset = useMemo(
        () => presets.find((p) => p.id === presetId),
        [presets, presetId],
    );

    // The colour a track's captions fall back to when the user hasn't chosen
    // an explicit swatch for it — i.e. what `resolveCaptionColor` will
    // actually resolve to. Reused both to build `resolvedColors` on restyle
    // and to show a truthful default in each track's swatch, so the colour
    // shown is always the colour that will actually be applied.
    const presetFallback: Rgb01 = useMemo(() => {
        const settings = selectedPreset?.macroSettings ?? {};
        return {
            r: Number(settings.FillColorRed ?? 1),
            g: Number(settings.FillColorGreen ?? 1),
            b: Number(settings.FillColorBlue ?? 1),
        };
    }, [selectedPreset]);
    const presetFallbackHex = useMemo(() => rgb01ToHex(presetFallback), [presetFallback]);

    const handleRestyle = useCallback(async () => {
        if (!selectedPreset) {
            setStatus({ tone: "error", message: "Pick a preset first." });
            return;
        }
        if (selectedTracks.length === 0) {
            // The Lua side treats an empty trackIndices array as "no filter"
            // (i.e. every track), not "no tracks". If every checkbox is off,
            // refuse rather than silently restyling everything the user just
            // excluded.
            setStatus({ tone: "error", message: "Select at least one track to restyle." });
            return;
        }

        setBusy(true);
        setStatus(null);
        try {
            // Snapshot BEFORE mutating. If this throws, no restyle is attempted.
            // snapshotCaptions returns { captions, failed, total, firstError }.
            const snapshot = await snapshotCaptions(selectedTracks);
            if (snapshot.failed > 0) {
                // A short snapshot means those captions are unrecoverable if the
                // restyle goes wrong. Refuse rather than offer a false undo.
                setStatus({
                    tone: "error",
                    message:
                        `Refusing to restyle: ${snapshot.failed} caption(s) could not be snapshotted ` +
                        `(${snapshot.firstError ?? "unknown error"}). Undo would not cover them.`,
                });
                return;
            }
            addEntry(key, makeSnapshotEntry("restyle", snapshot.captions));

            const rules = { trackColors };
            const resolvedColors: Record<string, Rgb01> = {};
            // Iterate snapshot.captions, not the component's `captions`
            // state: the snapshot was just fetched fresh from Resolve, so it
            // reflects the live timeline even if a caption was added
            // elsewhere while this panel stayed mounted. `captions` can be
            // stale, which would silently drop the caption's colour to the
            // preset's raw fallback with no error. Already scoped to the
            // enabled tracks via `snapshotCaptions(selectedTracks)`, so no
            // `disabledTracks` filter is needed here.
            for (const c of snapshot.captions) {
                resolvedColors[c.captionId] = resolveCaptionColor({
                    captionId: c.captionId,
                    trackIndex: c.trackIndex,
                    rules,
                    fallback: presetFallback,
                });
            }

            // Positional, not an options object, and macroSettings comes FIRST
            // — it is the only required argument. This differs from the Lua
            // argument order; see resolve-api.ts.
            const res = await restyleSubtitles(
                selectedPreset.macroSettings,
                selectedTracks,
                resolvedColors,
            );
            setStatus(
                res.failed > 0
                    ? {
                          tone: "error",
                          message: `${res.restyled} restyled, ${res.failed} failed.`,
                          errors: res.errors,
                      }
                    : { tone: "info", message: `${res.restyled} caption(s) restyled.` },
            );
            await refresh();
        } catch (err) {
            setStatus({ tone: "error", message: `Restyle failed: ${String(err)}` });
        } finally {
            setBusy(false);
        }
    }, [
        selectedPreset,
        selectedTracks,
        trackColors,
        presetFallback,
        key,
        addEntry,
        refresh,
    ]);

    const handleRestore = useCallback(
        async (entry: SnapshotEntry) => {
            setBusy(true);
            setStatus(null);
            try {
                const res = await restoreSnapshot(entry.captions);
                if (res.missing > 0 || res.failed > 0) {
                    const parts = [`${res.restored} restored`];
                    if (res.missing > 0) parts.push(`${res.missing} no longer on the timeline`);
                    if (res.failed > 0) parts.push(`${res.failed} failed`);
                    setStatus({ tone: "error", message: `${parts.join(", ")}.`, errors: res.errors });
                } else {
                    setStatus({ tone: "info", message: `${res.restored} caption(s) restored.` });
                }
                await refresh();
            } catch (err) {
                setStatus({ tone: "error", message: `Restore failed: ${String(err)}` });
            } finally {
                setBusy(false);
            }
        },
        [refresh],
    );

    return (
        <div className="space-y-6 p-4">
            <section className="space-y-2">
                <h3 className="text-sm font-semibold">Captions on timeline</h3>
                {captions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No AutoSubs captions found.</p>
                ) : (
                    <div className="space-y-1.5">
                        {tracks.map(([trackIndex, count]) => (
                            <TrackColorRow
                                key={trackIndex}
                                trackIndex={trackIndex}
                                captionCount={count}
                                enabled={!disabledTracks[trackIndex]}
                                color={trackColors[trackIndex] ?? presetFallbackHex}
                                disabled={busy}
                                onToggle={(on) =>
                                    setDisabledTracks((d) => ({ ...d, [trackIndex]: !on }))
                                }
                                onColorChange={(hex) =>
                                    setTrackColors((c) => ({ ...c, [trackIndex]: hex }))
                                }
                            />
                        ))}
                    </div>
                )}
                <p className="text-xs text-muted-foreground">
                    Colour follows the track. A caption moved to another track takes that
                    track&apos;s colour on the next restyle.
                </p>
            </section>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold">Restyle</h3>
                <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Preset</Label>
                    <Select value={presetId} onValueChange={setPresetId} disabled={busy}>
                        <SelectTrigger aria-label="Preset" className="bg-background">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {presets.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                    {p.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <Button
                    type="button"
                    disabled={busy || captions.length === 0 || selectedTracks.length === 0}
                    onClick={handleRestyle}
                >
                    {busy && <Loader2 className="animate-spin" />}
                    {busy ? "Working…" : "Apply to timeline"}
                </Button>
            </section>

            <section className="space-y-2">
                <h3 className="text-sm font-semibold">History</h3>
                <SnapshotHistoryList entries={entries} onRestore={handleRestore} busy={busy} />
            </section>

            {status && (
                <Alert variant={status.tone === "error" ? "destructive" : "default"}>
                    {status.tone === "error" && <AlertCircle className="size-4" />}
                    <AlertDescription>
                        <p>{status.message}</p>
                        {status.errors && status.errors.length > 0 && (
                            <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs">
                                {status.errors.slice(0, MAX_SHOWN_ERRORS).map((err, i) => (
                                    <li key={i} className="break-words">
                                        {err}
                                    </li>
                                ))}
                                {status.errors.length > MAX_SHOWN_ERRORS && (
                                    <li>+{status.errors.length - MAX_SHOWN_ERRORS} more</li>
                                )}
                            </ul>
                        )}
                    </AlertDescription>
                </Alert>
            )}
        </div>
    );
}
