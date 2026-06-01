/**
 * Draft message preservation for ChatComposer.
 * Saves and restores draft messages when switching threads.
 */

interface DraftEntry {
  content: string;
  threadId: string;
  timestamp: number;
  attachments?: string[];
}

export class DraftManager {
  private storageKey = "chat-drafts";
  private maxDrafts = 50;
  private autoSaveDelay = 1000;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Save a draft message for a thread.
   */
  saveDraft(threadId: string, content: string, attachments?: string[]): void {
    if (!content.trim() && !attachments?.length) {
      this.deleteDraft(threadId);
      return;
    }

    const drafts = this.getAllDrafts();
    const existing = drafts.findIndex((d) => d.threadId === threadId);

    const entry: DraftEntry = {
      content,
      threadId,
      timestamp: Date.now(),
      attachments,
    };

    if (existing >= 0) {
      drafts[existing] = entry;
    } else {
      drafts.push(entry);
    }

    // Trim to max
    if (drafts.length > this.maxDrafts) {
      drafts.sort((a, b) => b.timestamp - a.timestamp);
      drafts.length = this.maxDrafts;
    }

    this.saveAllDrafts(drafts);
  }

  /**
   * Get draft for a specific thread.
   */
  getDraft(threadId: string): DraftEntry | null {
    const drafts = this.getAllDrafts();
    return drafts.find((d) => d.threadId === threadId) || null;
  }

  /**
   * Delete a draft.
   */
  deleteDraft(threadId: string): void {
    const drafts = this.getAllDrafts().filter((d) => d.threadId !== threadId);
    this.saveAllDrafts(drafts);
  }

  /**
   * Auto-save with debounce.
   */
  scheduleAutoSave(threadId: string, content: string): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      this.saveDraft(threadId, content);
    }, this.autoSaveDelay);
  }

  /**
   * Get all drafts.
   */
  getAllDrafts(): DraftEntry[] {
    try {
      const data = localStorage.getItem(this.storageKey);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * Clear all drafts.
   */
  clearAll(): void {
    localStorage.removeItem(this.storageKey);
  }

  /**
   * Cleanup old drafts (older than 7 days).
   */
  cleanup(): void {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const drafts = this.getAllDrafts().filter((d) => d.timestamp > cutoff);
    this.saveAllDrafts(drafts);
  }

  private saveAllDrafts(drafts: DraftEntry[]): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(drafts));
    } catch {
      // Storage full, clear old drafts
      this.cleanup();
      try {
        localStorage.setItem(this.storageKey, JSON.stringify(drafts));
      } catch {
        // Give up
      }
    }
  }
}
