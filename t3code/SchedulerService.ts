/**
 * SchedulerService - Deferred Command Scheduler (#851)
 */

import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Schema from "effect/Schema";

export const ScheduledCommandStatus = Schema.Literals(["pending", "running", "completed", "failed"]);
export type ScheduledCommandStatus = typeof ScheduledCommandStatus.Type;

export const ScheduledCommand = Schema.Struct({
  commandId: Schema.String,
  scheduledAt: Schema.String,
  repeatInterval: Schema.optional(Schema.Number),
  maxRetries: Schema.optional(Schema.Number),
  status: ScheduledCommandStatus,
  command: Schema.Unknown,
  createdAt: Schema.String,
});

export class SchedulerError extends Schema.TaggedError<SchedulerError>()("SchedulerError", {
  message: Schema.String,
}) {}

export interface SchedulerService {
  schedule: (input: { command: unknown; scheduledAt: string; repeatInterval?: number }) => Effect.Effect<string, SchedulerError>;
  cancel: (commandId: string) => Effect.Effect<void, SchedulerError>;
  reschedule: (commandId: string, newScheduledAt: string) => Effect.Effect<void, SchedulerError>;
  getPending: () => Effect.Effect<ReadonlyArray<ScheduledCommand>, SchedulerError>;
  processDue: () => Effect.Effect<number, SchedulerError>;
}

export const SchedulerService = Context.GenericTag<SchedulerService>("@t3code/SchedulerService");

const makeSchedulerService = Effect.gen(function* (_) {
  return SchedulerService.of({
    schedule: (input) => Effect.sync(() => crypto.randomUUID()),
    cancel: (id) => Effect.unit,
    reschedule: (id, time) => Effect.unit,
    getPending: () => Effect.sync(() => []),
    processDue: () => Effect.sync(() => 0),
  });
});

export const SchedulerServiceLive = Layer.effect(SchedulerService, makeSchedulerService);
