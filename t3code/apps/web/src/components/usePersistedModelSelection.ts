/**
 * Persist provider model selection across reloads.
 */

import { useState, useEffect, useCallback } from "react";

interface Selection {
  providerId: string;
  modelId: string;
  timestamp: number;
}

export function usePersistedModelSelection(storageKey = "model-selection") {
  const [selection, setSelection] = useState<Selection | null>(() => {
    try {
      const data = localStorage.getItem(storageKey);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  });

  const updateSelection = useCallback((providerId: string, modelId: string) => {
    const sel: Selection = { providerId, modelId, timestamp: Date.now() };
    setSelection(sel);
    localStorage.setItem(storageKey, JSON.stringify(sel));
  }, [storageKey]);

  const clearSelection = useCallback(() => {
    setSelection(null);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (selection && Date.now() - selection.timestamp > 30 * 24 * 60 * 60 * 1000) {
      clearSelection();
    }
  }, [selection, clearSelection]);

  return { selection, updateSelection, clearSelection };
}
