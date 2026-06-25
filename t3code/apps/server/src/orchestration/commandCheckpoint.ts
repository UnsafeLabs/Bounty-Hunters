/**
 * Command interrupt checkpointing for the orchestration engine.
 *
 * The orchestration engine processes commands on a single worker fiber. When
 * that fiber is interrupted (graceful shutdown, supervised cancellation of a
 * stuck command, scope teardown) while a command is mid-flight, the in-progress
 * work is rolled back by the surrounding transaction but the command itself was
 * previously dropped silently: the caller's `Deferred` never settled and there
 * was no record that the command had been accepted-but-not-completed.
 *
 * This module records a small checkpoint at the exact moment of interruption so
 * the partial state (which command, at which read-model sequence, when) is
 * captured and can be queried and resumed instead of being lost.
 *
 * @module commandCheckpoint
 */
import type { CommandId, OrchestrationCommand, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

/**
 * InterruptedCommandCheckpoint - partial state captured when a command's
 * processing fiber is interrupted before completion.
 */
export interface InterruptedCommandCheckpoint {
  readonly commandId: CommandId;
  readonly command: OrchestrationCommand;
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
  /**
   * Read-model snapshot sequence observed when processing started. Resuming the
   * command re-applies it from this baseline; command receipts keep the replay
   * idempotent.
   */
  readonly snapshotSequence: number;
  /** ISO-8601 timestamp of the interruption, sourced from the Effect clock. */
  readonly interruptedAt: string;
}

/**
 * CommandCheckpointDescriptor - the stable processing context used to build a
 * checkpoint if the command is interrupted.
 */
export interface CommandCheckpointDescriptor {
  readonly commandId: CommandId;
  readonly command: OrchestrationCommand;
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
  readonly snapshotSequence: number;
}

/**
 * OrchestrationCommandCheckpointStore - storage for interrupted command
 * checkpoints, keyed by command id so a resumed command replaces its checkpoint.
 */
export interface OrchestrationCommandCheckpointStore {
  readonly record: (checkpoint: InterruptedCommandCheckpoint) => Effect.Effect<void>;
  readonly remove: (commandId: CommandId) => Effect.Effect<void>;
  readonly list: Effect.Effect<ReadonlyArray<InterruptedCommandCheckpoint>>;
}

/**
 * In-memory checkpoint store backed by a `Ref`. Entries are deduplicated by
 * command id and preserve insertion order so resume processes them oldest-first.
 */
export const makeInMemoryOrchestrationCommandCheckpointStore = Effect.gen(function* () {
  const checkpoints = yield* Ref.make<ReadonlyMap<CommandId, InterruptedCommandCheckpoint>>(
    new Map(),
  );

  const store: OrchestrationCommandCheckpointStore = {
    record: (checkpoint) =>
      Ref.update(checkpoints, (current) => {
        const next = new Map(current);
        next.set(checkpoint.commandId, checkpoint);
        return next;
      }),
    remove: (commandId) =>
      Ref.update(checkpoints, (current) => {
        if (!current.has(commandId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(commandId);
        return next;
      }),
    list: Ref.get(checkpoints).pipe(Effect.map((current) => Array.from(current.values()))),
  };

  return store;
});

/**
 * Interrupt finalizer that records a checkpoint with the partial command state
 * and emits an observability warning. Intended to be installed via
 * `Effect.onInterrupt` on the command-processing effect: interrupt finalizers
 * run uninterruptibly, so the checkpoint is always durable to the store. The
 * structured log carries the fiber id and timestamp automatically, in addition
 * to the command id annotated here.
 */
export const recordCommandInterruptCheckpoint = (
  store: OrchestrationCommandCheckpointStore,
  descriptor: CommandCheckpointDescriptor,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const interruptedAt = DateTime.formatIso(yield* DateTime.now);
    yield* store.record({
      commandId: descriptor.commandId,
      command: descriptor.command,
      aggregateKind: descriptor.aggregateKind,
      aggregateId: descriptor.aggregateId,
      snapshotSequence: descriptor.snapshotSequence,
      interruptedAt,
    });
    yield* Effect.logWarning(
      "orchestration command interrupted before completion; partial state checkpointed",
    ).pipe(
      Effect.annotateLogs({
        commandId: descriptor.commandId,
        commandType: descriptor.command.type,
        aggregateKind: descriptor.aggregateKind,
        aggregateId: descriptor.aggregateId,
        snapshotSequence: descriptor.snapshotSequence,
        interruptedAt,
      }),
    );
  });
