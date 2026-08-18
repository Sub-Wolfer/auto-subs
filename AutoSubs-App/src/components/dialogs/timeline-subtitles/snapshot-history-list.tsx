import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnapshotEntry } from "@/types";

interface SnapshotHistoryListProps {
    entries: SnapshotEntry[];
    onRestore: (entry: SnapshotEntry) => void;
    busy: boolean;
}

/**
 * Newest-first list of caption snapshots for the current timeline (see
 * `useCaptionHistoryStore`). Restoring re-applies a snapshot's captured
 * macro settings via `restoreSnapshot` — this component only reports the
 * click, `TimelineSubtitlesPanel` owns the actual API call.
 */
export function SnapshotHistoryList({ entries, onRestore, busy }: SnapshotHistoryListProps) {
    if (entries.length === 0) {
        return <p className="py-4 text-sm text-muted-foreground">No snapshots yet.</p>;
    }

    return (
        <ul className="divide-y rounded-md border">
            {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{entry.label}</div>
                        <div className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString()}
                        </div>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => onRestore(entry)}
                    >
                        <RotateCcw />
                        Restore
                    </Button>
                </li>
            ))}
        </ul>
    );
}
