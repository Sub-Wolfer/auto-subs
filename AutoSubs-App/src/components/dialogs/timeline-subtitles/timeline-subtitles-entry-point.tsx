import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useResolve } from "@/contexts/ResolveContext";
import { useIntegration } from "@/contexts/IntegrationContext";
import { useTimelineSubtitlesStore } from "@/stores/timeline-subtitles-store";
import { PanelErrorBoundary } from "./panel-error-boundary";
import { TimelineSubtitlesPanel } from "./timeline-subtitles-panel";

/**
 * Dialog host for `TimelineSubtitlesPanel`.
 *
 * The trigger is the captions button in the transcription header, which flips
 * `useTimelineSubtitlesStore` rather than calling into here — a floating
 * button in this component previously sat at `fixed bottom-4 left-4` and
 * landed on top of the in-flow "Generate" button at the bottom of the
 * transcription panel.
 *
 * Resolve-only: the caption restyle/snapshot API this panel drives only
 * exists on the DaVinci Resolve side (see Task 8's `resolve-api.ts`), so this
 * renders nothing when a different integration is active. It does not gate on
 * `timelineInfo.timelineId` — an empty one made the entry point vanish
 * whenever that field was momentarily blank, which is undiagnosable in a
 * release build. The panel reports an absent timeline itself, which is the
 * right place for it. `timelineInfo` comes from the app's existing
 * `ResolveContext` (already polled elsewhere) rather than being fetched again.
 */
export function TimelineSubtitlesEntryPoint() {
    const open = useTimelineSubtitlesStore((s) => s.open);
    const setOpen = useTimelineSubtitlesStore((s) => s.setOpen);
    const { timelineInfo } = useResolve();
    const { selectedIntegration } = useIntegration();

    if (selectedIntegration !== "davinci") {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Timeline Subtitles</DialogTitle>
                    <DialogDescription>
                        Restyle AutoSubs captions already on this timeline, or roll back a
                        previous restyle.
                    </DialogDescription>
                </DialogHeader>
                <PanelErrorBoundary>
                    <TimelineSubtitlesPanel
                        projectName={timelineInfo.projectName}
                        timelineId={timelineInfo.timelineId}
                    />
                </PanelErrorBoundary>
            </DialogContent>
        </Dialog>
    );
}
