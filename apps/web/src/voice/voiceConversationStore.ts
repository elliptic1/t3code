import { create } from "zustand";

/** Shared between the voice panel (mounted at the root) and the composer button that opens it. */
interface VoiceConversationUiState {
  /** Voice is enabled for the active environment, so the composer should offer it. */
  readonly available: boolean;
  readonly open: boolean;
  readonly running: boolean;
  readonly setAvailable: (available: boolean) => void;
  readonly setOpen: (open: boolean) => void;
  readonly setRunning: (running: boolean) => void;
}

export const useVoiceConversationStore = create<VoiceConversationUiState>((set) => ({
  available: false,
  open: false,
  running: false,
  setAvailable: (available) =>
    set(available ? { available } : { available, open: false, running: false }),
  setOpen: (open) => set({ open }),
  setRunning: (running) => set({ running }),
}));
