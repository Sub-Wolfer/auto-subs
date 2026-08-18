import { RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SnapshotEntry } from "@/types";

interface SnapshotHistoryListProps {
    entries: SnapshotEntry[];
    onRestore: (entry: SnapshotEntry) => void;
    onDelete: (entry: SnapshotEntry) => void;
    busy: boolean;
}

/**
 * Newest-first list of caption snapshots for the current timeline (see
 * `useCaptionHistoryStore`). Restoring re-applies a snapshot's captured
 * macro settings via `restoreSnapshot`; deleting drops the entry from
 * history — this component only reports the click, `TimelineSubtitlesPanel`
 * owns the actual API call and the store write.
 */
export function SnapshotHistoryList({
    entries,
    onRestore,
    onDelete,
    busy,
}: SnapshotHistoryListProps) {
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
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={`Delete snapshot: ${entry.label}`}
                        title="Delete this snapshot"
                        onClick={() => onDelete(entry)}
                    >
                        <Trash2 className="size-4" />
                    </Button>
                </li>
            ))}
        </ul>
    );
}
