import { describe, it, expect } from "vitest";
import * as Schema from "effect/Schema";
import {
  ThreadId,
  TurnId,
  CommandId,
  EventId,
  NonNegativeInt,
  TrimmedNonEmptyString,
  IsoDateTime,
  ProjectId,
  MessageId,
  CheckpointRef,
  ApprovalRequestId,
  ProviderItemId,
} from "./baseSchemas.ts";

function roundTrip<T>(
  schema: Schema.Schema<T, T>,
  value: T,
) {
  const encoded = Schema.encodeSync(schema)(value);
  const decoded = Schema.decodeSync(schema)(encoded);
  expect(decoded).toEqual(value);
}

describe("Base schema round-trip tests", () => {
  describe("NonNegativeInt", () => {
    it("round-trips zero", () => {
      roundTrip(NonNegativeInt, 0);
    });

    it("round-trips positive integer", () => {
      roundTrip(NonNegativeInt, 42);
    });

    it("round-trips large integer", () => {
      roundTrip(NonNegativeInt, Number.MAX_SAFE_INTEGER);
    });

    it("rejects negative integer", () => {
      expect(() => Schema.decodeSync(NonNegativeInt)(-1)).toThrow();
    });

    it("rejects float", () => {
      expect(() => Schema.decodeSync(NonNegativeInt)(1.5)).toThrow();
    });
  });

  describe("TrimmedNonEmptyString", () => {
    it("round-trips normal string", () => {
      roundTrip(TrimmedNonEmptyString, "hello");
    });

    it("round-trips unicode string", () => {
      roundTrip(TrimmedNonEmptyString, "你好世界 🎉");
    });

    it("round-trips string with special characters", () => {
      roundTrip(TrimmedNonEmptyString, "test <>&\"'\/");
    });

    it("rejects empty string", () => {
      expect(() => Schema.decodeSync(TrimmedNonEmptyString)("")).toThrow();
    });

    it("rejects whitespace-only string", () => {
      expect(() => Schema.decodeSync(TrimmedNonEmptyString)("   ")).toThrow();
    });
  });

  describe("IsoDateTime", () => {
    it("round-trips ISO date string", () => {
      const date = "2026-05-16T12:00:00.000Z";
      roundTrip(IsoDateTime, date);
    });
  });

  describe("branded ID schemas", () => {
    it("round-trips ThreadId", () => {
      roundTrip(ThreadId, "thread-abc-123" as any);
    });

    it("round-trips TurnId", () => {
      roundTrip(TurnId, "turn-xyz-456" as any);
    });

    it("round-trips CommandId", () => {
      roundTrip(CommandId, "cmd-789" as any);
    });

    it("round-trips EventId", () => {
      roundTrip(EventId, "evt-012" as any);
    });

    it("round-trips ProjectId", () => {
      roundTrip(ProjectId, "proj-345" as any);
    });

    it("round-trips MessageId", () => {
      roundTrip(MessageId, "msg-678" as any);
    });
  });

  describe("edge cases", () => {
    it("handles maximum length strings", () => {
      const longStr = "a".repeat(1000);
      roundTrip(TrimmedNonEmptyString, longStr);
    });

    it("handles unicode in IDs", () => {
      const unicodeId = "thread-日本語テスト";
      roundTrip(ThreadId, unicodeId as any);
    });

    it("rejects null for NonNegativeInt", () => {
      expect(() => Schema.decodeSync(NonNegativeInt)(null)).toThrow();
    });

    it("rejects undefined for NonNegativeInt", () => {
      expect(() => Schema.decodeSync(NonNegativeInt)(undefined)).toThrow();
    });

    it("rejects string for NonNegativeInt", () => {
      expect(() => Schema.decodeSync(NonNegativeInt)("42")).toThrow();
    });
  });
});
