import { create } from "zustand";

/**
 * Open state for the Timeline Subtitles dialog.
 *
 * The trigger lives in the transcription header while the dialog itself is
 * hosted at the app shell, so the two are not in a parent/child relationship.
 * Same split — and same reason — as `useOutputPanelStore`, which the caption
 * style button in that header already opens this way.
 */
interface TimelineSubtitlesStore {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useTimelineSubtitlesStore = create<TimelineSubtitlesStore>((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
