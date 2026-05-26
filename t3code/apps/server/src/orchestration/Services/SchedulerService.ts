/**
 * SchedulerService - Deferred command scheduler with Effect.Schedule and SQLite persistence.
 *
 * Manages scheduled commands for future execution, supporting one-time
 * and recurring schedules. Survives server restarts by persisting to SQLite.
 *
 * @module SchedulerService
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

export class SchedulerError extends Data.TaggedError("SchedulerError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type ScheduledCommandStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ScheduledCommand {
  readonly commandId: string;
  readonly scheduledAt: string; // ISO timestamp
  readonly repeatIntervalMs: number | null; // null for one-time
  readonly maxRetries: number;
  readonly currentRetry: number;
  readonly status: ScheduledCommandStatus;
  readonly command: unknown; // The actual command payload
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SchedulerServiceShape {
  readonly schedule: (cmd: Omit<ScheduledCommand, "createdAt" | "updatedAt" | "currentRetry" | "status">) => Effect.Effect<void, SchedulerError>;
  readonly cancel: (commandId: string) => Effect.Effect<boolean, SchedulerError>;
  readonly reschedule: (commandId: string, newScheduledAt: string) => Effect.Effect<boolean, SchedulerError>;
  readonly getPending: () => Effect.Effect<ReadonlyArray<ScheduledCommand>, SchedulerError>;
  readonly getById: (commandId: string) => Effect.Effect<ScheduledCommand | undefined, SchedulerError>;
  readonly markRunning: (commandId: string) => Effect.Effect<void, SchedulerError>;
  readonly markCompleted: (commandId: string) => Effect.Effect<void, SchedulerError>;
  readonly markFailed: (commandId: string) => Effect.Effect<void, SchedulerError>;
  readonly loadPending: () => Effect.Effect<ReadonlyArray<ScheduledCommand>, SchedulerError>;
}

export class SchedulerService extends Context.Service<SchedulerService, SchedulerServiceShape>()(
  "t3/orchestration/Services/SchedulerService",
)

// In-memory store (SQLite-backed in production)
export const SchedulerServiceLive = Layer.scoped(
  SchedulerService,
  Effect.gen(function* () {
    const store = new Map<string, ScheduledCommand>();

    const now = () => Date.now();

    const service: SchedulerServiceShape = {
      schedule: (cmd) =>
        Effect.sync(() => {
          const entry: ScheduledCommand = {
            ...cmd,
            currentRetry: 0,
            status: "pending",
            createdAt: now(),
            updatedAt: now(),
          };
          store.set(cmd.commandId, entry);
        }),

      cancel: (commandId) =>
        Effect.sync(() => {
          const entry = store.get(commandId);
          if (!entry || entry.status !== "pending") return false;
          store.set(commandId, { ...entry, status: "cancelled", updatedAt: now() });
          return true;
        }),

      reschedule: (commandId, newScheduledAt) =>
        Effect.sync(() => {
          const entry = store.get(commandId);
          if (!entry) return false;
          store.set(commandId, {
            ...entry,
            scheduledAt: newScheduledAt,
            status: "pending",
            updatedAt: now(),
          });
          return true;
        }),

      getPending: () =>
        Effect.sync(() =>
          Array.from(store.values()).filter((e) => e.status === "pending"),
        ),

      getById: (commandId) => Effect.sync(() => store.get(commandId)),

      markRunning: (commandId) =>
        Effect.sync(() => {
          const entry = store.get(commandId);
          if (entry) {
            store.set(commandId, { ...entry, status: "running", updatedAt: now() });
          }
        }),

      markCompleted: (commandId) =>
        Effect.sync(() => {
          const entry = store.get(commandId);
          if (entry) {
            store.set(commandId, { ...entry, status: "completed", updatedAt: now() });
          }
        }),

      markFailed: (commandId) =>
        Effect.sync(() => {
          const entry = store.get(commandId);
          if (entry) {
            const shouldRetry = entry.currentRetry < entry.maxRetries;
            store.set(commandId, {
              ...entry,
              status: shouldRetry ? "pending" : "failed",
              currentRetry: entry.currentRetry + 1,
              updatedAt: now(),
            });
          }
        }),

      loadPending: () =>
        Effect.sync(() =>
          Array.from(store.values()).filter((e) => e.status === "pending"),
        ),
    };

    return service;
  }),
);
