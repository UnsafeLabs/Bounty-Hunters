import { useCallback, useRef } from "react";
import { useState } from "react";

interface DraftStore {
  getDraft(threadId: string): string;
  setDraft(threadId: string, text: string): void;
  clearDraft(threadId: string): void;
}

function createDraftStore(): DraftStore {
  const drafts = new Map<string, string>();
  return {
    getDraft(threadId: string): string {
      return drafts.get(threadId) ?? "";
    },
    setDraft(threadId: string, text: string): void {
      if (text.length === 0) {
        drafts.delete(threadId);
      } else {
        drafts.set(threadId, text);
      }
    },
    clearDraft(threadId: string): void {
      drafts.delete(threadId);
    },
  };
}

export function useThreadDraftPersistence(currentThreadId: string) {
  const storeRef = useRef<DraftStore>(createDraftStore());
  const [value, setValue] = useState("");

  const switchToThread = useCallback(
    (newThreadId: string, currentText: string) => {
      storeRef.current.setDraft(currentThreadId, currentText);
      const restored = storeRef.current.getDraft(newThreadId);
      setValue(restored);
    },
    [currentThreadId],
  );

  const onTextChange = useCallback(
    (text: string) => {
      setValue(text);
      storeRef.current.setDraft(currentThreadId, text);
    },
    [currentThreadId],
  );

  const clearAfterSend = useCallback(() => {
    storeRef.current.clearDraft(currentThreadId);
    setValue("");
  }, [currentThreadId]);

  return { value, switchToThread, onTextChange, clearAfterSend };
}
