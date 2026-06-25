import { CommandId, ThreadId, type OrchestrationCommand } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vitest";

import {
  makeInMemoryOrchestrationCommandCheckpointStore,
  recordCommandInterruptCheckpoint,
  type CommandCheckpointDescriptor,
} from "./commandCheckpoint.ts";

const sampleCommand: OrchestrationCommand = {
  type: "thread.meta.update",
  commandId: CommandId.make("cmd-interrupt-sample"),
  threadId: ThreadId.make("thread-interrupt-sample"),
  title: "Interrupted Thread",
};

const sampleDescriptor: CommandCheckpointDescriptor = {
  commandId: sampleCommand.commandId,
  command: sampleCommand,
  aggregateKind: "thread",
  aggregateId: ThreadId.make("thread-interrupt-sample"),
  snapshotSequence: 7,
};

describe("commandCheckpoint", () => {
  it.effect(
    "checkpoints partial command state with the interrupt timestamp when the fiber is interrupted",
    () =>
      Effect.gen(function* () {
        const store = yield* makeInMemoryOrchestrationCommandCheckpointStore;
        const started = yield* Deferred.make<void>();

        const fiber = yield* Effect.fork(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => recordCommandInterruptCheckpoint(store, sampleDescriptor)),
          ),
        );

        yield* Deferred.await(started);
        yield* TestClock.adjust(Duration.seconds(1));
        const expectedInterruptedAt = DateTime.formatIso(yield* DateTime.now);

        yield* Fiber.interrupt(fiber);

        const checkpoints = yield* store.list;
        assert.lengthOf(checkpoints, 1);
        assert.strictEqual(checkpoints[0]?.commandId, sampleCommand.commandId);
        assert.strictEqual(checkpoints[0]?.snapshotSequence, 7);
        assert.strictEqual(checkpoints[0]?.interruptedAt, expectedInterruptedAt);
        assert.deepStrictEqual(checkpoints[0]?.command, sampleCommand);
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("does not record a checkpoint when processing completes normally", () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryOrchestrationCommandCheckpointStore;

      yield* Effect.void.pipe(
        Effect.onInterrupt(() => recordCommandInterruptCheckpoint(store, sampleDescriptor)),
      );

      const checkpoints = yield* store.list;
      assert.lengthOf(checkpoints, 0);
    }),
  );

  it.effect("deduplicates checkpoints by command id and supports removal", () =>
    Effect.gen(function* () {
      const store = yield* makeInMemoryOrchestrationCommandCheckpointStore;
      const otherCommandId = CommandId.make("cmd-interrupt-other");

      yield* store.record({ ...sampleDescriptor, interruptedAt: "2026-01-01T00:00:00.000Z" });
      yield* store.record({ ...sampleDescriptor, interruptedAt: "2026-01-01T00:00:05.000Z" });
      yield* store.record({
        ...sampleDescriptor,
        commandId: otherCommandId,
        interruptedAt: "2026-01-01T00:00:10.000Z",
      });

      const afterRecord = yield* store.list;
      assert.lengthOf(afterRecord, 2);
      assert.strictEqual(
        afterRecord.find((entry) => entry.commandId === sampleCommand.commandId)?.interruptedAt,
        "2026-01-01T00:00:05.000Z",
      );

      yield* store.remove(sampleCommand.commandId);
      const afterRemove = yield* store.list;
      assert.deepStrictEqual(
        afterRemove.map((entry) => entry.commandId),
        [otherCommandId],
      );

      // Removing an unknown id is a no-op.
      yield* store.remove(CommandId.make("cmd-interrupt-missing"));
      assert.lengthOf(yield* store.list, 1);
    }),
  );
});
