import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { MessageQueue, DefaultQueueConfig } from "./MessageQueue";

describe("MessageQueue", () => {
  it("should have default max queue size of 1000", () => {
    expect(DefaultQueueConfig.maxQueueSize).toBe(1000);
  });

  it("should have default max 3 retries", () => {
    expect(DefaultQueueConfig.maxRetries).toBe(3);
  });

  it("should persist to disk by default", () => {
    expect(DefaultQueueConfig.persistToDisk).toBe(true);
  });

  it("should export MessageQueue as an Effect", () => {
    expect(Effect.isEffect(MessageQueue)).toBe(true);
  });
});
