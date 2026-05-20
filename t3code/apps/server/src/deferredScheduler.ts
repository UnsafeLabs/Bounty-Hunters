import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export type ScheduleType = "delay" | "cron" | "interval";

export interface DelayConfig {
  readonly _tag: "delay";
  readonly delayMs: number;
}

export interface CronConfig {
  readonly _tag: "cron";
  readonly cronExpr: string;
}

export interface IntervalConfig {
  readonly _tag: "interval";
  readonly intervalMs: number;
}

export type ScheduleConfig = DelayConfig | CronConfig | IntervalConfig;

export interface ScheduledCommand {
  readonly id: string;
  readonly commandType: string;
  readonly payloadJson: string;
  readonly scheduleType: ScheduleType;
  readonly scheduleConfig: string;
  readonly status: string;
  readonly createdAt: string;
  readonly nextRunAt: string | null;
  readonly lastError: string | null;
  readonly runCount: number;
}

class SchedulePersistenceError extends Data.TaggedError("SchedulePersistenceError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

class ScheduleExecutionError extends Data.TaggedError("ScheduleExecutionError")<{
  readonly id: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface DeferredSchedulerShape {
  readonly schedule: (input: {
    readonly id: string;
    readonly commandType: string;
    readonly payload: unknown;
    readonly schedule: ScheduleConfig;
  }) => Effect.Effect<void, SchedulePersistenceError, SqlClient.SqlClient>;
  readonly cancel: (id: string) => Effect.Effect<boolean, SchedulePersistenceError, SqlClient.SqlClient>;
  readonly list: () => Effect.Effect<ReadonlyArray<ScheduledCommand>, never, SqlClient.SqlClient>;
  readonly start: () => Effect.Effect<void, never, SqlClient.SqlClient | Scope.Scope>;
}

export class DeferredScheduler extends Context.Service<
  DeferredScheduler,
  DeferredSchedulerShape
>()("t3/deferredScheduler") {}

const parseScheduleConfig = (raw: string): ScheduleConfig => {
  const parsed = JSON.parse(raw) as { _tag: string; delayMs?: number; cronExpr?: string; intervalMs?: number };
  if (parsed._tag === "delay" && typeof parsed.delayMs === "number") {
    return { _tag: "delay", delayMs: parsed.delayMs };
  }
  if (parsed._tag === "cron" && typeof parsed.cronExpr === "string") {
    return { _tag: "cron", cronExpr: parsed.cronExpr };
  }
  if (parsed._tag === "interval" && typeof parsed.intervalMs === "number") {
    return { _tag: "interval", intervalMs: parsed.intervalMs };
  }
  throw new Error(`Invalid schedule config: ${raw}`);
};

const execCommand = (
  commandType: string,
  payloadJson: string,
): Effect.Effect<void, ScheduleExecutionError> =>
  Effect.logInfo("deferredScheduler.command.executed", { commandType, payloadJson });

const scheduleFiber = Effect.fn("deferredScheduler.scheduleFiber")(function* (
  id: string,
  commandType: string,
  payloadJson: string,
  config: ScheduleConfig,
): Effect.fn.Return<void, never, SqlClient.SqlClient | Scope.Scope> {
  const sql = yield* SqlClient.SqlClient;

  const runAndUpdate = Effect.gen(function* () {
    yield* execCommand(commandType, payloadJson).pipe(
      Effect.catch((error) =>
        Effect.logWarning("deferredScheduler.command.failed", {
          id,
          commandType,
          message: error.message,
        }),
      ),
    );
    yield* sql`
      UPDATE deferred_scheduler_commands
      SET run_count = run_count + 1, status = 'completed'
      WHERE id = ${id}
    `.pipe(Effect.ignore);
  });

  switch (config._tag) {
    case "delay": {
      yield* Effect.forkScoped(
        Effect.delay(runAndUpdate, Duration.millis(config.delayMs)),
      );
      break;
    }
    case "cron": {
      yield* Effect.forkScoped(
        runAndUpdate.pipe(
          Effect.repeat(Schedule.cron(config.cronExpr)),
        ),
      );
      break;
    }
    case "interval": {
      yield* Effect.forkScoped(
        runAndUpdate.pipe(
          Effect.repeat(Schedule.spaced(Duration.millis(config.intervalMs))),
        ),
      );
      break;
    }
  }
});

const loadPendingAndSchedule = Effect.fn("deferredScheduler.loadPendingAndSchedule")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const rows = yield* sql<{
    id: string;
    command_type: string;
    payload_json: string;
    schedule_type: string;
    schedule_config: string;
    status: string;
  }>`
    SELECT id, command_type, payload_json, schedule_type, schedule_config, status
    FROM deferred_scheduler_commands
    WHERE status = 'pending'
  `;

  for (const row of rows) {
    const config = parseScheduleConfig(row.schedule_config);
    yield* Effect.forkScoped(
      scheduleFiber(
        row.id,
        row.command_type,
        row.payload_json,
        config,
      ).pipe(
        Effect.catch((error) =>
          Effect.logWarning("deferredScheduler.recovery.failed", {
            id: row.id,
            commandType: row.command_type,
            cause: error,
          }),
        ),
        Effect.provide(DeferredSchedulerLive),
      ),
    ).pipe(Effect.ignore);
  }

  if (rows.length > 0) {
    yield* Effect.logInfo("deferredScheduler.recovery.complete", {
      recoveredCount: rows.length,
    });
  }
});

export const DeferredSchedulerLive: Layer.Layer<DeferredScheduler, never, SqlClient.SqlClient | Scope.Scope> =
  Layer.effect(
    DeferredScheduler,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const start = Effect.fn("deferredScheduler.start")(function* () {
        yield* Effect.logInfo("deferredScheduler.starting");
        yield* loadPendingAndSchedule();
        yield* Effect.logInfo("deferredScheduler.started");
      });

      return {
        schedule: (input) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const scheduleJson = JSON.stringify(input.schedule);
            const nextRunAt = input.schedule._tag === "delay"
              ? new Date(now + input.schedule.delayMs).toISOString()
              : new Date(now).toISOString();

            yield* sql`
              INSERT INTO deferred_scheduler_commands (
                id, command_type, payload_json, schedule_type, schedule_config, status, created_at, next_run_at, run_count
              ) VALUES (
                ${input.id}, ${input.commandType}, ${JSON.stringify(input.payload)},
                ${input.schedule._tag}, ${scheduleJson}, 'pending',
                ${new Date(now).toISOString()}, ${nextRunAt}, 0
              )
            `.pipe(
              Effect.catch((cause) =>
                new SchedulePersistenceError({
                  message: `Failed to persist scheduled command: ${input.id}`,
                  cause,
                }),
              ),
            );

            yield* scheduleFiber(
              input.id,
              input.commandType,
              JSON.stringify(input.payload),
              input.schedule,
            ).pipe(
              Effect.catch((error) =>
                Effect.logWarning("deferredScheduler.scheduleFiberFailed", {
                  id: input.id,
                  message: error.message,
                }),
              ),
            );
          }),

        cancel: (id) =>
          Effect.gen(function* () {
            const result = yield* sql`
              UPDATE deferred_scheduler_commands
              SET status = 'cancelled'
              WHERE id = ${id} AND status = 'pending'
            `.pipe(
              Effect.catch((cause) =>
                new SchedulePersistenceError({
                  message: `Failed to cancel scheduled command: ${id}`,
                  cause,
                }),
              ),
            );
            return result.rowsAffected > 0;
          }),

        list: () =>
          Effect.gen(function* () {
            const rows = yield* sql<ScheduledCommand>`
              SELECT id, command_type AS commandType, payload_json AS payloadJson,
                     schedule_type AS scheduleType, schedule_config AS scheduleConfig,
                     status, created_at AS createdAt, next_run_at AS nextRunAt,
                     last_error AS lastError, run_count AS runCount
              FROM deferred_scheduler_commands
              ORDER BY created_at DESC
              LIMIT 100
            `.pipe(
              Effect.catch(() => Effect.succeed([] as Array<ScheduledCommand>)),
            );
            return rows as ReadonlyArray<ScheduledCommand>;
          }),

        start,
      };
    }),
  );
