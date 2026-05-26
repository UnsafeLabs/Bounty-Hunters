import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";

import {
  SchedulerService,
  SchedulerServiceLive,
  type ScheduledCommand,
  type ScheduledCommandStatus,
} from "./SchedulerService.ts";

const makeCommand = (
  commandId: string,
  scheduledAt: string,
  repeatIntervalMs: number | null = null,
  maxRetries = 3,
): Omit<ScheduledCommand, "createdAt" | "updatedAt" | "currentRetry" | "status"> => ({
  commandId,
  scheduledAt,
  repeatIntervalMs,
  maxRetries,
  command: { type: "test", data: "hello" },
});

describe("SchedulerService", () => {
  const TestLayer = SchedulerServiceLive;

  it.effect("schedules a command and retrieves it", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      const cmd = yield* scheduler.getById("cmd-1");
      assert.ok(cmd !== undefined);
      assert.equal(cmd!.commandId, "cmd-1");
      assert.equal(cmd!.status, "pending");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("returns undefined for non-existent command", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      const cmd = yield* scheduler.getById("nonexistent");
      assert.equal(cmd, undefined);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("cancels a pending command", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      const cancelled = yield* scheduler.cancel("cmd-1");
      assert.equal(cancelled, true);
      const cmd = yield* scheduler.getById("cmd-1");
      assert.equal(cmd!.status, "cancelled");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("cancel returns false for non-pending command", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      yield* scheduler.markRunning("cmd-1");
      const cancelled = yield* scheduler.cancel("cmd-1");
      assert.equal(cancelled, false);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("reschedules a command without duplicating", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      const originalTime = new Date().toISOString();
      yield* scheduler.schedule(makeCommand("cmd-1", originalTime));
      const newTime = new Date(Date.now() + 60000).toISOString();
      const rescheduled = yield* scheduler.reschedule("cmd-1", newTime);
      assert.equal(rescheduled, true);
      const cmd = yield* scheduler.getById("cmd-1");
      assert.equal(cmd!.scheduledAt, newTime);
      assert.equal(cmd!.status, "pending");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("marks command lifecycle: pending -> running -> completed", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      yield* scheduler.markRunning("cmd-1");
      let cmd = yield* scheduler.getById("cmd-1");
      assert.equal(cmd!.status, "running");

      yield* scheduler.markCompleted("cmd-1");
      cmd = yield* scheduler.getById("cmd-1");
      assert.equal(cmd!.status, "completed");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("retries failed commands up to maxRetries", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString(), null, 2));

      // Fail 3 times (maxRetries=2 means 2 retries after first failure = 3 total)
      for (let i = 0; i < 3; i++) {
        yield* scheduler.markRunning("cmd-1");
        yield* scheduler.markFailed("cmd-1");
      }

      const cmd = yield* scheduler.getById("cmd-1");
      assert.equal(cmd!.status, "failed");
      assert.equal(cmd!.currentRetry, 3);
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("getPending returns only pending commands", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      yield* scheduler.schedule(makeCommand("cmd-2", new Date().toISOString()));
      yield* scheduler.schedule(makeCommand("cmd-3", new Date().toISOString()));
      yield* scheduler.markRunning("cmd-2");
      yield* scheduler.cancel("cmd-3");

      const pending = yield* scheduler.getPending();
      assert.equal(pending.length, 1);
      assert.equal(pending[0]!.commandId, "cmd-1");
    }).pipe(Effect.provide(TestLayer)),
  );

  it.effect("loadPending returns all pending commands", () =>
    Effect.gen(function* () {
      const scheduler = yield* SchedulerService;
      yield* scheduler.schedule(makeCommand("cmd-1", new Date().toISOString()));
      yield* scheduler.schedule(makeCommand("cmd-2", new Date().toISOString()));
      const pending = yield* scheduler.loadPending();
      assert.equal(pending.length, 2);
    }).pipe(Effect.provide(TestLayer)),
  );
});
