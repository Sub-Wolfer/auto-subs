import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface TrackColorRowProps {
    trackIndex: number;
    captionCount: number;
    enabled: boolean;
    color: string;
    onToggle: (enabled: boolean) => void;
    onColorChange: (hex: string) => void;
    /** Disables both controls, e.g. while a restyle/restore is in flight. */
    disabled?: boolean;
}

/**
 * One row per video track in the "Captions on timeline" inventory: a toggle
 * to include/exclude the track from the next restyle, its caption count, and
 * the fill colour restyle will apply to captions on this track.
 */
export function TrackColorRow({
    trackIndex,
    captionCount,
    enabled,
    color,
    onToggle,
    onColorChange,
    disabled,
}: TrackColorRowProps) {
    const checkboxId = `track-color-row-v${trackIndex}`;

    return (
        <div className="flex items-center gap-3 rounded-md border px-3 py-2">
            <Checkbox
                id={checkboxId}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(checked) => onToggle(checked === true)}
                aria-label={`Include track V${trackIndex}`}
            />
            <Label
                htmlFor={checkboxId}
                className="w-14 shrink-0 cursor-pointer font-medium"
            >
                V{trackIndex}
            </Label>
            <span className="flex-1 text-sm text-muted-foreground">
                {captionCount} caption{captionCount === 1 ? "" : "s"}
            </span>
            <input
                type="color"
                value={color}
                disabled={disabled}
                onChange={(e) => onColorChange(e.target.value)}
                aria-label={`Colour for track V${trackIndex}`}
                className="h-8 w-12 cursor-pointer rounded-md border border-input bg-background p-0.5 disabled:cursor-not-allowed disabled:opacity-50"
            />
        </div>
    );
}
