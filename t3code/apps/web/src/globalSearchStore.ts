import { create } from "zustand";

interface GlobalSearchStore {
  open: boolean;
  query: string;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setQuery: (query: string) => void;
  close: () => void;
}

export const useGlobalSearchStore = create<GlobalSearchStore>((set) => ({
  open: false,
  query: "",
  setOpen: (open) => set({ open, ...(open ? {} : { query: "" }) }),
  toggleOpen: () =>
    set((state) => ({ open: !state.open, ...(state.open ? { query: "" } : {}) })),
  setQuery: (query) => set({ query }),
  close: () => set({ open: false, query: "" }),
}));
