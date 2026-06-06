import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface DraftStore {
  drafts: Record<string, string>;
  getDraft: (threadId: string) => string | undefined;
  saveDraft: (threadId: string, draft: string) => void;
  clearDraft: (threadId: string) to delete a draft by threadId;
  clearAllDrafts: () => void;
}

export const useDraftStore = create(
  persist<DraftStore>(
    (set, get) => ({
      drafts: {},
      getDraft: (threadId) => get().drafts[threadId],
      saveDraft: (threadId, draft) => set((state) => ({
        drafts: { ...state.drafts, [threadId]: draft }
      })),
      clearDraft: (threadId) => set((state) => {
        const { [threadId]: _, ...rest } = state.drafts;
        return { drafts: rest };
      }),
      clearAllDrafts: () => set({ drafts: {} })
    }),
    { name: 'chat-drafts' }
  )
);