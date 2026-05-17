import { describe, expect, it, vi } from "vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Either from "effect/Either";

import {
  streamGeneration,
  collectStream,
  streamGenerationWithAbort,
  CodexStreamTimeoutError,
  CodexStreamAbortedError,
  DEFAULT_STREAMING_CONFIG,
  type CodexStreamEvent,
  type CodexStreamChunk,
  type CodexStreamWarning,
  type CodexStreamComplete,
} from "./streaming.ts";

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

const createMockClient = (response: unknown) => ({
  raw: {
    notifications: Stream.empty,
    requests: Stream.empty,
    request: vi.fn(),
    notify: vi.fn(),
    respond: vi.fn(),
    respondError: vi.fn(),
  },
  request: vi.fn().mockResolvedValue(response),
  notify: vi.fn().mockResolvedValue(undefined),
  handleServerRequest: vi.fn().mockResolvedValue(undefined),
  handleServerNotification: vi.fn().mockResolvedValue(undefined),
  handleUnknownServerRequest: vi.fn().mockResolvedValue(undefined),
  handleUnknownServerNotification: vi.fn().mockResolvedValue(undefined),
});

// ---------------------------------------------------------------------------
// Stream event type guards
// ---------------------------------------------------------------------------

const isChunk = (e: CodexStreamEvent): e is CodexStreamChunk => e._tag === "Chunk";
const isWarning = (e: CodexStreamEvent): e is CodexStreamWarning => e._tag === "Warning";
const isComplete = (e: CodexStreamEvent): e is CodexStreamComplete => e._tag === "Complete";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CodexStreaming", () => {
  describe("streamGeneration", () => {
    it("yields chunks from string response", async () => {
      const client = createMockClient("Hello, world!");
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      const completes = events.filter(isComplete);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]?.text).toBe("Hello, world!");
      expect(completes.length).toBeGreaterThanOrEqual(1);
    });

    it("yields chunks from object with text field", async () => {
      const client = createMockClient({ text: "Generated output" });
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]?.text).toBe("Generated output");
    });

    it("yields chunks from object with content field", async () => {
      const client = createMockClient({ content: "Content here" });
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks[0]?.text).toBe("Content here");
    });

    it("yields chunks from object with deltas array", async () => {
      const client = createMockClient({ deltas: ["Hello ", "world", "!"] });
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      expect(chunks.length).toBe(3);
      expect(chunks.map((c) => c.text).join("")).toBe("Hello world!");
    });

    it("chunks have sequential indices", async () => {
      const client = createMockClient({ deltas: ["a", "b", "c"] });
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    });

    it("completed stream has no duplicate chunks", async () => {
      const client = createMockClient({ deltas: ["x", "y", "z"] });
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      const chunks = events.filter(isChunk);
      const indices = chunks.map((c) => c.index);
      expect(new Set(indices).size).toBe(indices.length);
    });

    it("stream events include timestamps", async () => {
      const client = createMockClient("test");
      const events = await Effect.runPromise(
        Stream.runCollect(streamGeneration(client as any, "test.method", {})),
      );

      for (const event of events) {
        expect(event.timestamp).toBeTruthy();
        expect(() => new Date(event.timestamp)).not.toThrow();
      }
    });
  });

  describe("collectStream", () => {
    it("collects all text chunks into a single string", async () => {
      const client = createMockClient({ deltas: ["Hello ", "world!"] });
      const result = await Effect.runPromise(
        collectStream(client as any, "test.method", {}),
      );

      expect(result).toBe("Hello world!");
    });

    it("collects string response", async () => {
      const client = createMockClient("Simple response");
      const result = await Effect.runPromise(
        collectStream(client as any, "test.method", {}),
      );

      expect(result).toBe("Simple response");
    });
  });

  describe("streamGenerationWithAbort", () => {
    it("returns a stream and abort effect", async () => {
      const client = createMockClient("test");
      const [stream, abort] = await Effect.runPromise(
        Effect.provide(
          streamGenerationWithAbort(client as any, "test.method", {}),
          Scope.Scope,
        ) as any,
      );

      expect(stream).toBeDefined();
      expect(abort).toBeDefined();
    });
  });

  describe("configuration", () => {
    it("uses default config values", () => {
      expect(DEFAULT_STREAMING_CONFIG.chunkTimeoutMs).toBe(30_000);
      expect(DEFAULT_STREAMING_CONFIG.maxWaitMs).toBe(120_000);
      expect(DEFAULT_STREAMING_CONFIG.bufferSize).toBe(16);
    });
  });
});

import * as Scope from "effect/Scope";
