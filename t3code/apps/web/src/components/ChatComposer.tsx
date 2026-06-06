"use client";

import { useState, useEffect, useRef } from "react";
import { api } from "~/utils/api";
import { useDraftStore } from "~/stores/draftStore";

interface ChatComposerProps {
  threadId: string;
  onSend: (message: string) => void;
}

export function ChatComposer({ threadId, onSend }: ChatComposerProps) {
  const [message, setMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { drafts, saveDraft, getDraft, clearDraft } = useDraftStore();

  // Load draft when thread changes
  useEffect(() => {
    const draft = getDraft(threadId);
    if (draft) {
      setMessage(draft);
    } else {
      setMessage("");
    }
  }, [threadId, drafts]);

  // Save draft when message changes
  useEffect(() => {
    if (message.trim() !== "") {
      saveDraft(threadId, message);
    } else {
      clearDraft(threadId);
    }
  }, [message, threadId]);

  const handleSubmit = () => {
    if (message.trim()) {
      onSend(message);
      clearDraft(threadId);
      setMessage("");
    }
  };

  return (
    <div className="flex w-full flex-col">
      <textarea
        ref={textareaRef}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Type your message..."
        className="w-full rounded-lg border p-2"
        rows={3}
      />
      <button 
        onClick={handleSubmit}
        disabled={!message.trim()}
        className="mt-2 rounded bg-blue-500 px-4 py-2 text-white disabled:opacity-50"
      >
        Send
      </button>
    </div>
  );
}