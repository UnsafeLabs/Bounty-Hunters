import { describe, it, expect } from "vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";
import { SchedulerService, SchedulerServiceLive } from "./SchedulerService.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";

const testLayer = SchedulerServiceLive.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
);

const runTest = <A>(effect: Effect.Effect<A, never, SchedulerService | SqlClient.SqlClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(testLayer),
    ),
  );

const makeTestCommand = (id?: string) => ({
  commandId: id ?? `cmd_${crypto.randomUUID()}`,
  command: {
    type: "project.create" as const,
    commandId: `cid_${crypto.randomUUID()}`,
    projectId: `pid_${crypto.randomUUID()}`,
    title: "Test Project",
    workspaceRoot: "/tmp/test",
    createdAt: "2026-01-01T00:00:00Z",
  },
  scheduledAt: DateTime.unsafeNow,
});

describe("SchedulerService", () => {
  describe("schedule", () => {
    it("should create a pending scheduled command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = makeTestCommand();
          const scheduled = yield* scheduler.schedule(input);
          return scheduled;
        }),
      );

      expect(result.id).toBeDefined();
      expect(result.status).toBe("pending");
      expect(result.commandId).toBeDefined();
      expect(result.retryCount).toBe(0);
      expect(result.maxRetries).toBe(3);
    });

    it("should use custom maxRetries when provided", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = { ...makeTestCommand(), maxRetries: 5 };
          return yield* scheduler.schedule(input);
        }),
      );

      expect(result.maxRetries).toBe(5);
    });

    it("should support recurring commands with repeatIntervalMs", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = { ...makeTestCommand(), repeatIntervalMs: 60000 };
          return yield* scheduler.schedule(input);
        }),
      );

      expect(result.repeatIntervalMs).toBe(60000);
    });
  });

  describe("cancel", () => {
    it("should cancel a pending command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = makeTestCommand();
          const scheduled = yield* scheduler.schedule(input);
          const cancelled = yield* scheduler.cancel(scheduled.id);
          const after = yield* scheduler.getById(scheduled.id);
          return { cancelled, status: after._tag === "Some" ? after.value.status : null };
        }),
      );

      expect(result.cancelled).toBe(true);
      expect(result.status).toBe("cancelled");
    });

    it("should return false for non-existent command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return yield* scheduler.cancel("nonexistent");
        }),
      );

      expect(result).toBe(false);
    });
  });

  describe("reschedule", () => {
    it("should update scheduledAt for pending command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = makeTestCommand();
          const scheduled = yield* scheduler.schedule(input);
          const newTime = DateTime.add(scheduled.scheduledAt as any, { minutes: 30 });
          const rescheduled = yield* scheduler.reschedule(scheduled.id, newTime as any);
          const after = yield* scheduler.getById(scheduled.id);
          return { rescheduled, status: after._tag === "Some" ? after.value.status : null };
        }),
      );

      expect(result.rescheduled).toBe(true);
      expect(result.status).toBe("pending");
    });

    it("should reactivate a cancelled command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = makeTestCommand();
          const scheduled = yield* scheduler.schedule(input);
          yield* scheduler.cancel(scheduled.id);
          const newTime = DateTime.add(scheduled.scheduledAt as any, { minutes: 60 });
          const rescheduled = yield* scheduler.reschedule(scheduled.id, newTime as any);
          const after = yield* scheduler.getById(scheduled.id);
          return { rescheduled, status: after._tag === "Some" ? after.value.status : null };
        }),
      );

      expect(result.rescheduled).toBe(true);
      expect(result.status).toBe("pending");
    });
  });

  describe("getPending", () => {
    it("should return only due pending commands", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const pastInput = {
            ...makeTestCommand(),
            scheduledAt: DateTime.unsafeMake(2020, 1, 1),
          };
          const futureInput = {
            ...makeTestCommand(),
            scheduledAt: DateTime.add(DateTime.unsafeNow, { hours: 24 }),
          };
          yield* scheduler.schedule(pastInput);
          yield* scheduler.schedule(futureInput);
          return yield* scheduler.getPending();
        }),
      );

      expect(result.length).toBe(1);
    });

    it("should return empty array when no pending commands", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return yield* scheduler.getPending();
        }),
      );

      expect(result).toEqual([]);
    });
  });

  describe("getById", () => {
    it("should return Some for existing command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = makeTestCommand();
          const scheduled = yield* scheduler.schedule(input);
          return yield* scheduler.getById(scheduled.id);
        }),
      );

      expect(result._tag).toBe("Some");
    });

    it("should return None for non-existent command", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return yield* scheduler.getById("nonexistent");
        }),
      );

      expect(result._tag).toBe("None");
    });
  });

  describe("crash recovery", () => {
    it("should retain pending commands across service restart", async () => {
      const scheduledId = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          const input = {
            ...makeTestCommand(),
            scheduledAt: DateTime.add(DateTime.unsafeNow, { hours: 1 }),
          };
          const scheduled = yield* scheduler.schedule(input);
          return scheduled.id;
        }),
      );

      const found = await runTest(
        Effect.gen(function* () {
          const scheduler = yield* SchedulerService;
          return yield* scheduler.getById(scheduledId);
        }),
      );

      expect(found._tag).toBe("Some");
      expect(found.value.status).toBe("pending");
    });
  });
});
