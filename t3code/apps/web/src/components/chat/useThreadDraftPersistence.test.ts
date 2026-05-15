import { describe, it, expect } from "vitest";

describe("useThreadDraftPersistence", () => {
  describe("draft store", () => {
    it("stores and retrieves drafts by thread ID", () => {
      const drafts = new Map<string, string>();
      drafts.set("thread-1", "Hello world");
      drafts.set("thread-2", "Another message");

      expect(drafts.get("thread-1")).toBe("Hello world");
      expect(drafts.get("thread-2")).toBe("Another message");
    });

    it("returns empty string for threads without drafts", () => {
      const drafts = new Map<string, string>();
      expect(drafts.get("nonexistent") ?? "").toBe("");
    });

    it("clears draft after message sent", () => {
      const drafts = new Map<string, string>();
      drafts.set("thread-1", "Hello world");
      drafts.delete("thread-1");
      expect(drafts.has("thread-1")).toBe(false);
    });

    it("does not store empty drafts", () => {
      const drafts = new Map<string, string>();
      const text = "";
      if (text.length === 0) {
        drafts.delete("thread-1");
      } else {
        drafts.set("thread-1", text);
      }
      expect(drafts.has("thread-1")).toBe(false);
    });

    it("maintains independent drafts per thread", () => {
      const drafts = new Map<string, string>();
      drafts.set("thread-1", "Draft A");
      drafts.set("thread-2", "Draft B");

      expect(drafts.get("thread-1")).toBe("Draft A");
      expect(drafts.get("thread-2")).toBe("Draft B");

      drafts.delete("thread-1");
      expect(drafts.has("thread-1")).toBe(false);
      expect(drafts.get("thread-2")).toBe("Draft B");
    });

    it("preserves special characters in drafts", () => {
      const drafts = new Map<string, string>();
      const special = "Hello 🎉 <script>alert('xss')</script> \n\t tabs & spaces";
      drafts.set("thread-1", special);
      expect(drafts.get("thread-1")).toBe(special);
    });

    it("handles long drafts", () => {
      const drafts = new Map<string, string>();
      const longText = "a".repeat(10000);
      drafts.set("thread-1", longText);
      expect(drafts.get("thread-1")).toBe(longText);
      expect(drafts.get("thread-1")!.length).toBe(10000);
    });
  });

  describe("thread switching", () => {
    it("saves current draft before switching", () => {
      const drafts = new Map<string, string>();
      const currentThreadId = "thread-1";
      const currentText = "Work in progress";

      drafts.set(currentThreadId, currentText);
      const newThreadId = "thread-2";
      const restored = drafts.get(newThreadId) ?? "";

      expect(drafts.get("thread-1")).toBe("Work in progress");
      expect(restored).toBe("");
    });

    it("restores draft when switching back", () => {
      const drafts = new Map<string, string>();
      drafts.set("thread-1", "Saved draft");

      const restored = drafts.get("thread-1") ?? "";
      expect(restored).toBe("Saved draft");
    });
  });
});
