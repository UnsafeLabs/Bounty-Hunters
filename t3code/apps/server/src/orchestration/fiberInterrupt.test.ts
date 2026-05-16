import { describe, it, expect } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Option from "effect/Option";
import * as TestClock from "effect/TestClock";
import { InterruptionCheckpoint, InterruptionCheckpointLive } from "./InterruptionCheckpoint.ts";

describe("InterruptionCheckpoint", () => {
  it("should save and retrieve an interrupted command entry", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;
      const entry = {
        commandId: "cmd-001",
        commandType: "project.create",
        aggregateRef: {
          aggregateKind: "project" as const,
          aggregateId: "proj-123",
        },
        snapshotSequence: 42,
        interruptedAt: "2026-05-16T12:00:00.000Z",
      };

      yield* checkpoint.save(entry);
      const result = yield* checkpoint.get("cmd-001");

      expect(Option.isSome(result)).toBe(true);
      expect(Option.getOrThrow(result)).toEqual(entry);
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should list all interrupted commands", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;
      const entry1 = {
        commandId: "cmd-001",
        commandType: "project.create",
        aggregateRef: {
          aggregateKind: "project" as const,
          aggregateId: "proj-1",
        },
        snapshotSequence: 10,
        interruptedAt: "2026-05-16T12:00:00.000Z",
      };
      const entry2 = {
        commandId: "cmd-002",
        commandType: "thread.message.send",
        aggregateRef: {
          aggregateKind: "thread" as const,
          aggregateId: "thread-2",
        },
        snapshotSequence: 20,
        interruptedAt: "2026-05-16T12:01:00.000Z",
      };

      yield* checkpoint.save(entry1);
      yield* checkpoint.save(entry2);

      const list = yield* checkpoint.list();
      expect(list.length).toBe(2);
      expect(list[0].commandId).toBe("cmd-001");
      expect(list[1].commandId).toBe("cmd-002");
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should remove a command after resume", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;
      const entry = {
        commandId: "cmd-001",
        commandType: "project.create",
        aggregateRef: {
          aggregateKind: "project" as const,
          aggregateId: "proj-1",
        },
        snapshotSequence: 10,
        interruptedAt: "2026-05-16T12:00:00.000Z",
      };

      yield* checkpoint.save(entry);
      yield* checkpoint.remove("cmd-001");

      const result = yield* checkpoint.get("cmd-001");
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should return none for unknown command", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;
      const result = yield* checkpoint.get("nonexistent");
      expect(Option.isNone(result)).toBe(true);
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));
});

describe("Fiber Interruption Handling (OrchestrationEngine)", () => {
  it("should handle fiber interruption gracefully via onInterrupt", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;

      const result = yield* Effect.gen(function* () {
        yield* Effect.sleep("1 second");
        return "completed";
      }).pipe(
        Effect.onInterrupt(() =>
          Effect.gen(function* () {
            yield* checkpoint.save({
              commandId: "interrupted-cmd",
              commandType: "project.create",
              aggregateRef: {
                aggregateKind: "project" as const,
                aggregateId: "proj-interrupted",
              },
              snapshotSequence: 0,
              interruptedAt: new Date().toISOString(),
            });
          }),
        ),
        Effect.fork,
        Effect.flatMap((fiber) =>
          Effect.gen(function* () {
            yield* TestClock.adjust("500 millis");
            yield* Fiber.interrupt(fiber);
            return yield* Fiber.await(fiber);
          }),
        ),
      );

      expect(Exit.isInterrupted(result)).toBe(true);

      const saved = yield* checkpoint.get("interrupted-cmd");
      expect(Option.isSome(saved)).toBe(true);
      expect(Option.getOrThrow(saved).commandId).toBe("interrupted-cmd");
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should not trigger onInterrupt for normally completed fibers", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;
      let interrupted = false;

      const result = yield* Effect.succeed("done").pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          }),
        ),
      );

      expect(result).toBe("done");
      expect(interrupted).toBe(false);
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should capture command metadata on interruption", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;

      const fiber = yield* Effect.gen(function* () {
        yield* Effect.sleep("10 seconds");
        return "never-reached";
      }).pipe(
        Effect.onInterrupt(() =>
          checkpoint.save({
            commandId: "cmd-meta-001",
            commandType: "thread.message.send",
            aggregateRef: {
              aggregateKind: "thread" as const,
              aggregateId: "thread-meta",
            },
            snapshotSequence: 99,
            interruptedAt: "2026-05-16T13:00:00.000Z",
          }),
        ),
        Effect.fork,
      );

      yield* TestClock.adjust("2 seconds");
      yield* Fiber.interrupt(fiber);

      const entry = yield* checkpoint.get("cmd-meta-001");
      expect(Option.isSome(entry)).toBe(true);
      if (Option.isSome(entry)) {
        expect(entry.value.commandType).toBe("thread.message.send");
        expect(entry.value.aggregateRef.aggregateKind).toBe("thread");
        expect(entry.value.aggregateRef.aggregateId).toBe("thread-meta");
        expect(entry.value.snapshotSequence).toBe(99);
      }
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));

  it("should query interruption checkpoints as a list", () =>
    Effect.gen(function* () {
      const checkpoint = yield* InterruptionCheckpoint;

      for (let i = 0; i < 3; i++) {
        yield* checkpoint.save({
          commandId: `cmd-${i}`,
          commandType: "project.create",
          aggregateRef: {
            aggregateKind: "project" as const,
            aggregateId: `proj-${i}`,
          },
          snapshotSequence: i * 10,
          interruptedAt: new Date().toISOString(),
        });
      }

      const list = yield* checkpoint.list();
      expect(list.length).toBe(3);
      expect(list.map((e) => e.commandId).sort()).toEqual(["cmd-0", "cmd-1", "cmd-2"]);
    }).pipe(Effect.provide(InterruptionCheckpointLive), Effect.runPromise));
});