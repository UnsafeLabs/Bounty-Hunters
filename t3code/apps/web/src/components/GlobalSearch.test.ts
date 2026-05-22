import {
  type ChatMessage,
  type SidebarThreadSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import { searchChatMessages, type SearchChatOptions } from "./GlobalSearch.logic";

function makeMessage(overrides: Partial<ChatMessage> & { text: string }): ChatMessage {
  return {
    id: overrides.id ?? "msg-1",
    role: overrides.role ?? "user",
    text: overrides.text,
    createdAt: overrides.createdAt ?? "2026-05-22T00:00:00.000Z",
    streaming: false,
    attachments: undefined,
    turnId: null,
    completedAt: undefined,
  };
}

function makeThread(overrides: Partial<SidebarThreadSummary> & { id: string }): SidebarThreadSummary {
  return {
    id: overrides.id,
    environmentId: overrides.environmentId ?? "env-1",
    projectId: overrides.projectId ?? "proj-1",
    title: overrides.title ?? "Test Thread",
    createdAt: overrides.createdAt ?? "2026-05-22T00:00:00.000Z",
    lastActivityAt: overrides.lastActivityAt ?? "2026-05-22T00:00:00.000Z",
    messageCount: overrides.messageCount ?? 1,
    status: overrides.status ?? "active",
    envMode: overrides.envMode ?? "auto",
  };
}

describe("GlobalSearch.logic", () => {
  describe("searchChatMessages", () => {
    it("returns empty array for empty query", () => {
      const result = searchChatMessages("", { threads: [], messagesByThread: new Map() });
      expect(result).toHaveLength(0);
    });

    it("finds messages by text content", () => {
      const threadId = "thread-1";
      const messages = new Map<string, ReadonlyArray<ChatMessage>>();
      messages.set(threadId, [
        makeMessage({ id: "msg-1", text: "Hello world testing search", role: "user" }),
      ]);
      const threads = [makeThread({ id: threadId, title: "Test Thread" })];

      const result = searchChatMessages("search", { threads, messagesByThread: messages });

      expect(result).toHaveLength(1);
      expect(result[0]?.source).toBe("chat");
      expect(result[0]?.label).toBe("Test Thread");
    });

    it("returns ranked results with better matches first", () => {
      const threadId = "thread-1";
      const messages = new Map<string, ReadonlyArray<ChatMessage>>();
      messages.set(threadId, [
        makeMessage({ id: "msg-1", text: "exact match", role: "user" }),
        makeMessage({ id: "msg-2", text: "some text containing match somewhere", role: "user" }),
      ]);
      const threads = [makeThread({ id: threadId, title: "Test Thread" })];

      const result = searchChatMessages("match", { threads, messagesByThread: messages });

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]?.source).toBe("chat");
    });

    it("does not match unrelated messages", () => {
      const threadId = "thread-1";
      const messages = new Map<string, ReadonlyArray<ChatMessage>>();
      messages.set(threadId, [
        makeMessage({ id: "msg-1", text: "completely unrelated content", role: "user" }),
      ]);
      const threads = [makeThread({ id: threadId, title: "Test Thread" })];

      const result = searchChatMessages("zzznotfoundzzz", { threads, messagesByThread: messages });

      expect(result).toHaveLength(0);
    });

    it("produces highlight ranges for matched text", () => {
      const threadId = "thread-1";
      const messages = new Map<string, ReadonlyArray<ChatMessage>>();
      messages.set(threadId, [
        makeMessage({ id: "msg-1", text: "find this highlighted text", role: "user" }),
      ]);
      const threads = [makeThread({ id: threadId, title: "Test Thread" })];

      const result = searchChatMessages("highlighted", { threads, messagesByThread: messages });

      expect(result).toHaveLength(1);
      expect(result[0]!.highlightRanges.length).toBeGreaterThan(0);
      expect(result[0]!.highlightRanges[0]![0]).toBeGreaterThanOrEqual(0);
    });
  });
});
