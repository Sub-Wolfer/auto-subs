import * as React from "react";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface PanelErrorBoundaryProps {
    children: React.ReactNode;
}

interface PanelErrorBoundaryState {
    message: string | null;
}

/**
 * Renders a short, readable message when the panel below it throws during
 * render.
 *
 * Without a boundary an uncaught render error unmounts the whole React root,
 * so the user sees an empty black window with no explanation — and release
 * builds ship without devtools, so there is no console to check either. A
 * silent blank is the worst failure mode this feature can have; failing
 * visibly, with the error text on screen, is what makes it reportable.
 *
 * Scoped deliberately to the dialog body: the surrounding Dialog stays alive,
 * so the user can still close it and keep using the app. Radix unmounts the
 * dialog's content when it closes, which resets this boundary — reopening
 * retries from scratch with no extra bookkeeping here.
 */
export class PanelErrorBoundary extends React.Component<
    PanelErrorBoundaryProps,
    PanelErrorBoundaryState
> {
    state: PanelErrorBoundaryState = { message: null };

    static getDerivedStateFromError(error: unknown): PanelErrorBoundaryState {
        return {
            message: error instanceof Error ? error.message : String(error),
        };
    }

    componentDidCatch(error: unknown, info: React.ErrorInfo) {
        console.error("Timeline Subtitles panel crashed:", error, info);
    }

    render() {
        if (this.state.message !== null) {
            return (
                <div className="p-4">
                    <Alert variant="destructive">
                        <AlertCircle className="size-4" />
                        <AlertDescription>
                            <p>Timeline Subtitles could not be displayed.</p>
                            <p className="mt-1.5 break-words text-xs">{this.state.message}</p>
                        </AlertDescription>
                    </Alert>
                </div>
            );
        }
        return this.props.children;
    }
}
