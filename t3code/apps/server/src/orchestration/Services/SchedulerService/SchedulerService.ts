import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import { ScheduledCommand, ScheduledCommandStatus } from "@t3tools/contracts";

/**
 * CommandSchedulerService - manages deferred command execution.
 */
export interface CommandSchedulerShape {
  readonly schedule: (
    commandId: string,
    scheduledAt: Date,
    options?: { repeatInterval?: string; maxRetries?: number },
  ) => Effect.Effect<void>;

  readonly cancel: (commandId: string) => Effect.Effect<void>;

  readonly reschedule: (commandId: string, newScheduledAt: Date) => Effect.Effect<void>;

  readonly getStatus: (commandId: string) => Effect.Effect<ScheduledCommand | null>;
}

export class CommandSchedulerService extends Effect.Service<CommandSchedulerShape>()(
  "t3/orchestration/Services/CommandScheduler",
  {
    effect: Effect.gen(function* () {
      // In-memory store for demo; replace with SQLite repository in production
      const commands = new Map<string, ScheduledCommand>();

      return {
        schedule: (commandId, scheduledAt, options) =>
          Effect.gen(function* () {
            const now = new Date().toISOString();
            const cmd: ScheduledCommand = {
              commandId,
              scheduledAt,
              repeatInterval: options?.repeatInterval,
              maxRetries: options?.maxRetries ?? 3,
              status: "pending",
              retryCount: 0,
              createdAt: now,
              updatedAt: now,
            };
            commands.set(commandId, cmd);
            yield* Effect.logInfo("scheduler.command.scheduled", { commandId, scheduledAt });
          }),

        cancel: (commandId) =>
          Effect.gen(function* () {
            const cmd = commands.get(commandId);
            if (cmd) {
              commands.set(commandId, { ...cmd, status: "cancelled", updatedAt: new Date().toISOString() });
              yield* Effect.logInfo("scheduler.command.cancelled", { commandId });
            }
          }),

        reschedule: (commandId, newScheduledAt) =>
          Effect.gen(function* () {
            const cmd = commands.get(commandId);
            if (cmd) {
              commands.set(commandId, { ...cmd, scheduledAt: newScheduledAt, status: "pending", updatedAt: new Date().toISOString() });
              yield* Effect.logInfo("scheduler.command.rescheduled", { commandId, newScheduledAt });
            }
          }),

        getStatus: (commandId) =>
          Effect.succeed(commands.get(commandId) ?? null),
      };
    }),
  },
) {}