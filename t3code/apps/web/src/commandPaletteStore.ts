import { create } from "zustand";

interface CommandPaletteOpenIntent {
  kind: "add-project";
  requestId: number;
}

interface CommandPaletteOpenProjectPathIntent {
  kind: "open-project-path";
  requestId: number;
  path: string;
}

interface CommandPaletteStore {
  open: boolean;
  openIntent: CommandPaletteOpenIntent | CommandPaletteOpenProjectPathIntent | null;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  openAddProject: () => void;
  openProjectPath: (path: string) => void;
  clearOpenIntent: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set) => ({
  open: false,
  openIntent: null,
  setOpen: (open) => set({ open, ...(open ? {} : { openIntent: null }) }),
  toggleOpen: () =>
    set((state) => ({ open: !state.open, ...(state.open ? { openIntent: null } : {}) })),
  openAddProject: () =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "add-project",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
      },
    })),
  openProjectPath: (path) =>
    set((state) => ({
      open: true,
      openIntent: {
        kind: "open-project-path",
        requestId: (state.openIntent?.requestId ?? 0) + 1,
        path,
      },
    })),
  clearOpenIntent: () => set({ openIntent: null }),
}));
