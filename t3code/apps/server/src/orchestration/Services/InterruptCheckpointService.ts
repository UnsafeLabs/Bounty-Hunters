import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const InterruptedCommand = Schema.Struct({
  commandId: Schema.String,
  aggregateKind: Schema.String,
  aggregateId: Schema.String,
  partialState: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  interruptedAt: Schema.String,
  reason: Schema.Literal("client_disconnect", "timeout", "fiber_interrupt"),
  fiberId: Schema.Number,
});
export type InterruptedCommand = typeof InterruptedCommand.Type;

export class InterruptCheckpointError extends Error {
  readonly _tag = "InterruptCheckpointError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export interface InterruptCheckpointServiceShape {
  readonly saveInterruptedState: (
    command: InterruptedCommand,
  ) => Effect.Effect<void, InterruptCheckpointError>;

  readonly getInterruptedCommand: (
    commandId: string,
  ) => Effect.Effect<InterruptedCommand | null, InterruptCheckpointError>;

  readonly listInterrupted: (
    aggregateId: string,
  ) => Effect.Effect<ReadonlyArray<InterruptedCommand>, InterruptCheckpointError>;

  readonly clearInterrupted: (
    commandId: string,
  ) => Effect.Effect<void, InterruptCheckpointError>;
}

export class InterruptCheckpointService extends Context.Service<
  InterruptCheckpointService,
  InterruptCheckpointServiceShape
>()("t3/orchestration/Services/InterruptCheckpointService") {}
