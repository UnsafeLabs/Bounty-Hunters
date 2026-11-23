import { create } from "zustand";

interface CommandPaletteOpenIntent {
  kind: "add-project";
  requestId: number;
}

interface GlobalSearchOpenIntent {
  kind: "global-search";
}

type OpenIntent = CommandPaletteOpenIntent | GlobalSearchOpenIntent | null;

interface CommandPaletteStore {
  open: boolean;
  openIntent: OpenIntent;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: () => void;
  openGlobalSearch: () => void;
  clearOpenIntent: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openIntent: null,
  setOpen: (open) => set({ open, ...(open ? {} : { openIntent: null }) }),
  toggleOpen: () =>
    set((state) => ({
      open: !state.open,
      ...(state.open ? { openIntent: null } : {}),
    })),
  openAddProject: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "add-project",
        requestId: (state.openIntent?.kind === "add-project" ? state.openIntent.requestId : 0) + 1,
      },
    })),
  openGlobalSearch: () =>
    set((state) => ({
      open: true,
      openIntent: { kind: "global-search" },
    })),
  clearOpenIntent: () => set({ openIntent: null }),
}));