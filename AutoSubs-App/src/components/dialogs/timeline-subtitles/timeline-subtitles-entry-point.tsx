import * as React from "react";
import { Captions } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useResolve } from "@/contexts/ResolveContext";
import { useIntegration } from "@/contexts/IntegrationContext";
import { TimelineSubtitlesPanel } from "./timeline-subtitles-panel";

/**
 * Trigger + dialog host for `TimelineSubtitlesPanel`.
 *
 * Deliberately self-contained: the app shell mounts this with a single JSX
 * line and nothing else, so relocating the trigger later (a toolbar, a menu
 * item, wherever) is a one-line move, not a refactor of App.tsx.
 *
 * Resolve-only: the caption restyle/snapshot API this panel drives only
 * exists on the DaVinci Resolve side (see Task 8's `resolve-api.ts`), so
 * this renders nothing when a different integration is active or there is
 * no timeline open. `timelineInfo` is read from the app's existing
 * `ResolveContext` (already polled elsewhere) rather than fetched again
 * here.
 */
export function TimelineSubtitlesEntryPoint() {
    const [open, setOpen] = React.useState(false);
    const { timelineInfo } = useResolve();
    const { selectedIntegration } = useIntegration();

    if (selectedIntegration !== "davinci" || !timelineInfo.timelineId) {
        return null;
    }

    return (
        <>
            {/*
             * Bottom-left, not bottom-right: sonner's <Toaster/> (mounted in
             * main.tsx with no `position` prop, so it uses sonner's own
             * "bottom-right" default) renders at the same z-40 tier
             * (ui/sonner.tsx) and after <App/> in the DOM, so a bottom-right
             * button here would lose to any toast on screen — and
             * ResolveContext's pushToTimeline (ResolveContext.tsx:151,156)
             * fires exactly the toasts that appear while this button is
             * visible. Checked every other `fixed` element in src/ before
             * picking this corner; nothing else claims bottom-left.
             */}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                className="fixed bottom-4 left-4 z-40 gap-1.5 shadow-lg"
                onClick={() => setOpen(true)}
            >
                <Captions className="size-4" />
                Timeline Subtitles
            </Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Timeline Subtitles</DialogTitle>
                        <DialogDescription>
                            Restyle AutoSubs captions already on this timeline, or roll back a
                            previous restyle.
                        </DialogDescription>
                    </DialogHeader>
                    <TimelineSubtitlesPanel
                        projectName={timelineInfo.projectName}
                        timelineId={timelineInfo.timelineId}
                    />
                </DialogContent>
            </Dialog>
        </>
    );
}
