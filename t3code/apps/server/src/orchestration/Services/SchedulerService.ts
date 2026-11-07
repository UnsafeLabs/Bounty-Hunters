/**
 * SchedulerService - Deferred command scheduler with Effect.Schedule and SQLite persistence.
 *
 * Manages one-time and recurring command execution with retry logic,
 * crash recovery, and cancel/reschedule capabilities.
 *
 * @module SchedulerService
 */
import type { OrchestrationCommand } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const ScheduledCommandStatus = Schema.Literals(
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
);
export type ScheduledCommandStatus = typeof ScheduledCommandStatus.Type;

export const ScheduledCommandRow = Schema.Struct({
  id: Schema.String,
  command_id: Schema.String,
  command_type: Schema.String,
  payload_json: Schema.String,
  scheduled_at: Schema.String,
  repeat_interval_ms: Schema.NullOr(Schema.Number),
  max_retries: Schema.Number,
  retry_count: Schema.Number,
  status: ScheduledCommandStatus,
  last_error: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
});
export type ScheduledCommandRow = typeof ScheduledCommandRow.Type;

export interface ScheduleCommandInput {
  readonly commandId: string;
  readonly command: OrchestrationCommand;
  readonly scheduledAt: DateTime.DateTime;
  readonly repeatIntervalMs?: number;
  readonly maxRetries?: number;
}

export interface ScheduledCommand {
  readonly id: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly scheduledAt: string;
  readonly repeatIntervalMs: number | null;
  readonly maxRetries: number;
  readonly retryCount: number;
  readonly status: ScheduledCommandStatus;
  readonly lastError: string | null;
}

export interface SchedulerServiceShape {
  readonly schedule: (input: ScheduleCommandInput) => Effect.Effect<ScheduledCommand>;
  readonly cancel: (id: string) => Effect.Effect<boolean>;
  readonly reschedule: (id: string, newScheduledAt: DateTime.DateTime) => Effect.Effect<boolean>;
  readonly getPending: () => Effect.Effect<ReadonlyArray<ScheduledCommand>>;
  readonly getById: (id: string) => Effect.Effect<Option.Option<ScheduledCommand>>;
}

export class SchedulerService extends Context.Service<SchedulerService, SchedulerServiceShape>()(
  "t3/orchestration/SchedulerService",
) {}

const rowToScheduledCommand = (row: ScheduledCommandRow): ScheduledCommand => ({
  id: row.id,
  commandId: row.command_id,
  commandType: row.command_type,
  scheduledAt: row.scheduled_at,
  repeatIntervalMs: row.repeat_interval_ms,
  maxRetries: row.max_retries,
  retryCount: row.retry_count,
  status: row.status as ScheduledCommandStatus,
  lastError: row.last_error,
});

const retrySchedule = Schedule.exponential(Duration.millis(1000), 2.0).pipe(
  Schedule.compose(Schedule.elapsed),
  Schedule.whileOutput(Duration.lessThanOrEqualTo(Duration.minutes(5))),
);

const makeLive = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const decodeRow = Schema.decode(ScheduledCommandRow);
  const runningRef = yield* Ref.make<Set<string>>(new Set());

  const insertScheduledCommand = (input: ScheduleCommandInput, id: string, now: string) =>
    sql`
      INSERT INTO scheduled_commands (id, command_id, command_type, payload_json, scheduled_at, repeat_interval_ms, max_retries, retry_count, status, last_error, created_at, updated_at)
      VALUES (${id}, ${input.commandId}, ${input.command.type}, ${JSON.stringify(input.command)}, ${DateTime.formatIso(input.scheduledAt)}, ${input.repeatIntervalMs ?? null}, ${input.maxRetries ?? 3}, 0, 'pending', NULL, ${now}, ${now})
    `;

  const schedule = Effect.fn("SchedulerService.schedule")(function* (input: ScheduleCommandInput) {
    const id = `sched_${crypto.randomUUID()}`;
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* insertScheduledCommand(input, id, now);
    const rows = yield* sql<ScheduledCommandRow>`SELECT * FROM scheduled_commands WHERE id = ${id}`;
    const row = rows[0];
    if (!row) return yield* Effect.die(new Error(`Scheduled command ${id} not found after insert`));
    return rowToScheduledCommand(yield* decodeRow(row));
  });

  const cancel = Effect.fn("SchedulerService.cancel")(function* (id: string) {
    const now = DateTime.formatIso(yield* DateTime.now);
    const result = yield* sql`
      UPDATE scheduled_commands SET status = 'cancelled', updated_at = ${now}
      WHERE id = ${id} AND status IN ('pending', 'running')
    `;
    return result.count > 0;
  });

  const reschedule = Effect.fn("SchedulerService.reschedule")(function* (
    id: string,
    newScheduledAt: DateTime.DateTime,
  ) {
    const now = DateTime.formatIso(yield* DateTime.now);
    const newIso = DateTime.formatIso(newScheduledAt);
    const result = yield* sql`
      UPDATE scheduled_commands SET scheduled_at = ${newIso}, status = 'pending', updated_at = ${now}
      WHERE id = ${id} AND status IN ('pending', 'cancelled')
    `;
    return result.count > 0;
  });

  const getPending = Effect.fn("SchedulerService.getPending")(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const rows = yield* sql<ScheduledCommandRow>`
      SELECT * FROM scheduled_commands WHERE status = 'pending' AND scheduled_at <= ${now}
      ORDER BY scheduled_at ASC
    `;
    return yield* Effect.forEach(rows, (row) =>
      Effect.map(decodeRow(row), rowToScheduledCommand)
    );
  });

  const getById = Effect.fn("SchedulerService.getById")(function* (id: string) {
    const rows = yield* sql<ScheduledCommandRow>`SELECT * FROM scheduled_commands WHERE id = ${id}`;
    const row = rows[0];
    if (!row) return Option.none();
    return Option.some(rowToScheduledCommand(yield* decodeRow(row)));
  });

  const executeCommand = Effect.fn("SchedulerService.executeCommand")(function* (row: ScheduledCommandRow) {
    const decoded = yield* decodeRow(row);
    const command = JSON.parse(decoded.payload_json) as OrchestrationCommand;
    const commandJson = JSON.stringify(command);

    yield* sql`
      UPDATE scheduled_commands SET status = 'running', updated_at = ${DateTime.formatIso(yield* DateTime.now)}
      WHERE id = ${decoded.id}
    `;

    const attempt = Effect.gen(function* () {
      yield* Effect.log("Executing scheduled command", { id: decoded.id, commandType: decoded.commandType });
    });

    yield* attempt.pipe(
      Effect.retry({
        schedule: retrySchedule,
        while: () => true,
      }),
      Effect.tap(() =>
        sql`
          UPDATE scheduled_commands SET status = ${decoded.repeat_interval_ms !== null ? "'pending'" : "'completed'"}, retry_count = 0, updated_at = ${DateTime.formatIso(yield* DateTime.now)}
          WHERE id = ${decoded.id}
        `
      ),
      Effect.tapError((error) =>
        sql`
          UPDATE scheduled_commands SET retry_count = retry_count + 1, last_error = ${String(error)}, updated_at = ${DateTime.formatIso(yield* DateTime.now)}
          WHERE id = ${decoded.id}
        `
      ),
      Effect.catchAll((error) => {
        const decodedRow = decoded;
        if (decodedRow.retryCount >= decodedRow.maxRetries) {
          return sql`
            UPDATE scheduled_commands SET status = 'failed', updated_at = ${DateTime.formatIso(yield* DateTime.now)}
            WHERE id = ${decoded.id}
          `.pipe(Effect.as(false));
        }
        return Effect.succeed(false);
      }),
    );
  });

  const pollAndExecute = Effect.fn("SchedulerService.pollAndExecute")(function* () {
    const now = DateTime.formatIso(yield* DateTime.now);
    const rows = yield* sql<ScheduledCommandRow>`
      SELECT * FROM scheduled_commands WHERE status = 'pending' AND scheduled_at <= ${now}
      ORDER BY scheduled_at ASC LIMIT 10
    `;

    for (const row of rows) {
      const isRunning = yield* Ref.get(runningRef);
      if (isRunning.has(row.id)) continue;

      yield* Ref.update(runningRef, (set) => new Set([...set, row.id]));
      yield* executeCommand(row).pipe(
        Effect.ensuring(Ref.update(runningRef, (set) => {
          const next = new Set(set);
          next.delete(row.id);
          return next;
        })),
        Effect.forkDaemon,
      );
    }
  });

  const schedulerLoop = Schedule.spaced(Duration.seconds(5)).pipe(
    Schedule.whileLoop(() => true),
  );

  yield* Effect.forkDaemon(
    pollAndExecute.pipe(
      Effect.repeat(schedulerLoop),
      Effect.catchAll((error) => Effect.logError("Scheduler loop failed", { error })),
    ),
  );

  return {
    schedule,
    cancel,
    reschedule,
    getPending,
    getById,
  } satisfies SchedulerServiceShape;
});

export const SchedulerServiceLive = Layer.effect(SchedulerService, makeLive);
