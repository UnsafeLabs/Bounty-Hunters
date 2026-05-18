import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { SchedulerService, ScheduledCommand } from "./SchedulerService";
import { Schema } from "effect";

describe("SchedulerService", () => {
  it("should export SchedulerService as an Effect", () => {
    expect(Effect.isEffect(SchedulerService)).toBe(true);
  });

  it("ScheduledCommand schema should validate a pending command", () => {
    const data = {
      commandId: "cmd-1",
      scheduledAt: new Date().toISOString(),
      maxRetries: 3,
      payload: { action: "test" },
      status: "pending" as const,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    const result = Schema.decodeUnknownSync(ScheduledCommand)(data);
    expect(result.commandId).toBe("cmd-1");
    expect(result.status).toBe("pending");
  });

  it("ScheduledCommand should accept optional repeatInterval", () => {
    const data = {
      commandId: "cmd-2",
      scheduledAt: new Date().toISOString(),
      repeatInterval: 60000,
      maxRetries: 5,
      payload: {},
      status: "pending" as const,
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    const result = Schema.decodeUnknownSync(ScheduledCommand)(data);
    expect(result.repeatInterval).toBe(60000);
  });
});
