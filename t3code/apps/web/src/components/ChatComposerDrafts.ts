/**
 * Per-thread draft message persistence for ChatComposer (issue 819).
 */

export class DraftStore {
  private drafts = new Map<string, string>();

  save(threadId: string, text: string): void {
    const t = text.trimEnd();
    if (!t.trim()) {
      this.drafts.delete(threadId);
      return;
    }
    this.drafts.set(threadId, text);
  }

  load(threadId: string): string {
    return this.drafts.get(threadId) ?? "";
  }

  clear(threadId: string): void {
    this.drafts.delete(threadId);
  }

  /** Switch threads: save from, return draft for to. */
  switchThread(fromId: string | null, toId: string, currentText: string): string {
    if (fromId) this.save(fromId, currentText);
    return this.load(toId);
  }

  size(): number {
    return this.drafts.size;
  }
}
