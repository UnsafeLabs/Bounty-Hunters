import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

export interface InterruptedCommandEntry {
  readonly commandId: string;
  readonly commandType: string;
  readonly aggregateRef: {
    readonly aggregateKind: "project" | "thread";
    readonly aggregateId: string;
  };
  readonly snapshotSequence: number;
  readonly interruptedAt: string;
}

export interface InterruptionCheckpointShape {
  readonly save: (entry: InterruptedCommandEntry) => Effect.Effect<void>;
  readonly list: () => Effect.Effect<ReadonlyArray<InterruptedCommandEntry>>;
  readonly get: (commandId: string) => Effect.Effect<Option.Option<InterruptedCommandEntry>>;
  readonly remove: (commandId: string) => Effect.Effect<void>;
}

export class InterruptionCheckpoint extends Context.Tag("InterruptionCheckpoint")<
  InterruptionCheckpoint,
  InterruptionCheckpointShape
>() {}

const makeInterruptionCheckpoint = Effect.gen(function* () {
  const interruptedCommands = new Map<string, InterruptedCommandEntry>();

  const save: InterruptionCheckpointShape["save"] = (entry) =>
    Effect.sync(() => {
      interruptedCommands.set(entry.commandId, entry);
    });

  const list: InterruptionCheckpointShape["list"] = () =>
    Effect.sync(() => Array.from(interruptedCommands.values()));

  const get: InterruptionCheckpointShape["get"] = (commandId) =>
    Effect.sync(() => Option.fromNullable(interruptedCommands.get(commandId) ?? null));

  const remove: InterruptionCheckpointShape["remove"] = (commandId) =>
    Effect.sync(() => {
      interruptedCommands.delete(commandId);
    });

  return { save, list, get, remove } satisfies InterruptionCheckpointShape;
});

export const InterruptionCheckpointLive = Layer.effect(
  InterruptionCheckpoint,
  makeInterruptionCheckpoint,
);