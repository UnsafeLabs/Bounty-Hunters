import {
  CommandId,
  IsoDateTime,
  NonNegativeInt,
  OrchestrationCommand,
  ScheduledCommandStatus,
  TrimmedNonEmptyString,
  type ScheduledCommand,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  PersistenceDecodeError,
  PersistenceSqlError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
} from "../persistence/Errors.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";

const CommandFromJsonString = Schema.fromJsonString(OrchestrationCommand);

export const ScheduledCommandRecord = Schema.Struct({
  commandId: CommandId,
  command: CommandFromJsonString,
  scheduledAt: IsoDateTime,
  repeatInterval: Schema.NullOr(TrimmedNonEmptyString),
  maxRetries: NonNegativeInt,
  retryCount: NonNegativeInt,
  runCount: NonNegativeInt,
  status: ScheduledCommandStatus,
  lastError: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ScheduledCommandRecord = typeof ScheduledCommandRecord.Type;

const PersistScheduledCommandRequest = Schema.Struct({
  commandId: CommandId,
  command: CommandFromJsonString,
  scheduledAt: IsoDateTime,
  repeatInterval: Schema.NullOr(TrimmedNonEmptyString),
  maxRetries: NonNegativeInt,
  now: IsoDateTime,
});

const CommandIdRequest = Schema.Struct({
  commandId: CommandId,
});

const TimedCommandIdRequest = Schema.Struct({
  commandId: CommandId,
  now: IsoDateTime,
});

const RescheduleCommandRequest = Schema.Struct({
  commandId: CommandId,
  scheduledAt: IsoDateTime,
  now: IsoDateTime,
});

const RetryFailureRequest = Schema.Struct({
  commandId: CommandId,
  retryCount: NonNegativeInt,
  lastError: Schema.String,
  now: IsoDateTime,
});

const RecurringSuccessRequest = Schema.Struct({
  commandId: CommandId,
  scheduledAt: IsoDateTime,
  now: IsoDateTime,
});

export class SchedulerValidationError extends Schema.TaggedErrorClass<SchedulerValidationError>()(
  "SchedulerValidationError",
  {
    commandId: Schema.NullOr(CommandId),
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.commandId === null
      ? `Scheduler validation failed: ${this.detail}`
      : `Scheduler validation failed (${this.commandId}): ${this.detail}`;
  }
}

export type SchedulerPersistenceError = PersistenceSqlError | PersistenceDecodeError;
export type SchedulerServiceError = SchedulerPersistenceError | SchedulerValidationError;

export type ScheduleCommandInput = ScheduledCommand & {
  readonly command: OrchestrationCommand;
};

export interface RescheduleCommandInput {
  readonly commandId: CommandId;
  readonly scheduledAt: IsoDateTime;
}

export interface SchedulerServiceShape {
  readonly schedule: (
    input: ScheduleCommandInput,
  ) => Effect.Effect<ScheduledCommandRecord, SchedulerServiceError>;
  readonly cancel: (
    commandId: CommandId,
  ) => Effect.Effect<Option.Option<ScheduledCommandRecord>, SchedulerPersistenceError>;
  readonly reschedule: (
    input: RescheduleCommandInput,
  ) => Effect.Effect<Option.Option<ScheduledCommandRecord>, SchedulerServiceError>;
  readonly get: (
    commandId: CommandId,
  ) => Effect.Effect<Option.Option<ScheduledCommandRecord>, SchedulerPersistenceError>;
}

export class SchedulerService extends Context.Service<SchedulerService, SchedulerServiceShape>()(
  "t3/orchestration/SchedulerService",
) {}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const RETRY_BASE_DELAY = Duration.millis(100);

const toSchedulerPersistenceError =
  (sqlOperation: string, decodeOperation: string) =>
  (cause: unknown): SchedulerPersistenceError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause as Schema.SchemaError)
      : toPersistenceSqlError(sqlOperation)(cause);

function selectScheduledCommandColumns() {
  return [
    'command_id AS "commandId"',
    'command_json AS "command"',
    'scheduled_at AS "scheduledAt"',
    'repeat_interval AS "repeatInterval"',
    'max_retries AS "maxRetries"',
    'retry_count AS "retryCount"',
    'run_count AS "runCount"',
    "status",
    'last_error AS "lastError"',
    'created_at AS "createdAt"',
    'updated_at AS "updatedAt"',
  ].join(", ");
}

const rowColumns = selectScheduledCommandColumns();

function isoToEpochMillis(iso: string): number | null {
  return Option.match(DateTime.make(iso), {
    onNone: () => null,
    onSome: DateTime.toEpochMillis,
  });
}

function parsePositiveNumber(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDurationIntervalMillis(value: string): number | null {
  const match =
    /^(?<amount>\d+(?:\.\d+)?)\s*(?<unit>ms|millis?|milliseconds?|s|sec|secs|seconds?|m|mins?|minutes?|h|hours?)$/i.exec(
      value,
    );
  const amount = match?.groups?.amount ? parsePositiveNumber(match.groups.amount) : null;
  const unit = match?.groups?.unit?.toLowerCase();
  if (amount === null || unit === undefined) {
    return null;
  }

  if (unit === "ms" || unit.startsWith("milli")) {
    return amount;
  }
  if (unit === "s" || unit.startsWith("sec")) {
    return amount * 1_000;
  }
  if (unit === "m" || unit.startsWith("min")) {
    return amount * 60_000;
  }
  if (unit === "h" || unit.startsWith("hour")) {
    return amount * 3_600_000;
  }
  return null;
}

function parseIsoDurationIntervalMillis(value: string): number | null {
  const match =
    /^P(?:(?<days>\d+(?:\.\d+)?)D)?(?:T(?:(?<hours>\d+(?:\.\d+)?)H)?(?:(?<minutes>\d+(?:\.\d+)?)M)?(?:(?<seconds>\d+(?:\.\d+)?)S)?)?$/i.exec(
      value,
    );
  if (!match) {
    return null;
  }

  const days = match.groups?.days ? parsePositiveNumber(match.groups.days) : 0;
  const hours = match.groups?.hours ? parsePositiveNumber(match.groups.hours) : 0;
  const minutes = match.groups?.minutes ? parsePositiveNumber(match.groups.minutes) : 0;
  const seconds = match.groups?.seconds ? parsePositiveNumber(match.groups.seconds) : 0;
  if (days === null || hours === null || minutes === null || seconds === null) {
    return null;
  }
  const millis = days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + seconds * 1_000;
  return millis > 0 ? millis : null;
}

function parseCronLikeIntervalMillis(value: string): number | null {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) {
    return null;
  }
  if (parts.slice(1).some((part) => part !== "*")) {
    return null;
  }
  if (parts[0] === "*") {
    return parts.length === 6 ? 1_000 : 60_000;
  }
  const stepMatch = /^\*\/(?<step>\d+)$/.exec(parts[0] ?? "");
  if (!stepMatch?.groups?.step) {
    return null;
  }
  const step = parsePositiveNumber(stepMatch.groups.step);
  if (step === null || !Number.isInteger(step)) {
    return null;
  }
  return parts.length === 6 ? step * 1_000 : step * 60_000;
}

export function parseRepeatIntervalMillis(repeatInterval: string): number | null {
  const trimmed = repeatInterval.trim();
  const withoutEvery = trimmed
    .replace(/^@every\s+/i, "")
    .replace(/^every\s+/i, "")
    .trim();
  return (
    parseDurationIntervalMillis(withoutEvery) ??
    parseIsoDurationIntervalMillis(withoutEvery) ??
    parseCronLikeIntervalMillis(withoutEvery)
  );
}

function validateScheduledAt(commandId: CommandId, scheduledAt: IsoDateTime) {
  return Effect.gen(function* () {
    const scheduledAtMs = isoToEpochMillis(scheduledAt);
    if (scheduledAtMs === null) {
      return yield* new SchedulerValidationError({
        commandId,
        detail: `scheduledAt must be an ISO timestamp`,
      });
    }
    return scheduledAtMs;
  });
}

function validateRepeatInterval(commandId: CommandId, repeatInterval: string | null | undefined) {
  if (repeatInterval === null || repeatInterval === undefined) {
    return Effect.succeed(null);
  }
  const intervalMs = parseRepeatIntervalMillis(repeatInterval);
  if (intervalMs === null || intervalMs <= 0) {
    return Effect.fail(
      new SchedulerValidationError({
        commandId,
        detail:
          "repeatInterval must be a positive interval such as '30 seconds', 'PT5M', or '*/5 * * * *'",
      }),
    );
  }
  return Effect.succeed(intervalMs);
}

function commandForRun(row: ScheduledCommandRecord): OrchestrationCommand {
  if (row.repeatInterval === null || row.runCount === 0) {
    return row.command;
  }
  return {
    ...row.command,
    commandId: CommandId.make(`${row.commandId}:run:${row.runCount + 1}`),
  };
}

function errorDetail(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

const makeSchedulerService = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const activeFibersRef = yield* Ref.make(new Map<CommandId, Fiber.Fiber<void, never>>());
  const scope = yield* Effect.scope;

  const persistScheduledCommand = SqlSchema.findOne({
    Request: PersistScheduledCommandRequest,
    Result: ScheduledCommandRecord,
    execute: (request) =>
      sql`
        INSERT INTO scheduled_commands (
          command_id,
          command_json,
          scheduled_at,
          repeat_interval,
          max_retries,
          retry_count,
          run_count,
          status,
          last_error,
          created_at,
          updated_at
        )
        VALUES (
          ${request.commandId},
          ${request.command},
          ${request.scheduledAt},
          ${request.repeatInterval},
          ${request.maxRetries},
          0,
          0,
          'pending',
          NULL,
          ${request.now},
          ${request.now}
        )
        ON CONFLICT (command_id)
        DO UPDATE SET
          command_json = excluded.command_json,
          scheduled_at = excluded.scheduled_at,
          repeat_interval = excluded.repeat_interval,
          max_retries = excluded.max_retries,
          retry_count = 0,
          run_count = 0,
          status = 'pending',
          last_error = NULL,
          updated_at = excluded.updated_at
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const findByCommandId = SqlSchema.findOneOption({
    Request: CommandIdRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId }) =>
      sql`
        SELECT ${sql.unsafe(rowColumns)}
        FROM scheduled_commands
        WHERE command_id = ${commandId}
      `,
  });

  const findPendingCommands = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ScheduledCommandRecord,
    execute: () =>
      sql`
        SELECT ${sql.unsafe(rowColumns)}
        FROM scheduled_commands
        WHERE status = 'pending'
        ORDER BY scheduled_at ASC, command_id ASC
      `,
  });

  const markRunningAsPending = Effect.gen(function* () {
    const now = yield* nowIso;
    yield* sql`
      UPDATE scheduled_commands
      SET status = 'pending',
          updated_at = ${now}
      WHERE status = 'running'
    `;
  }).pipe(Effect.mapError(toPersistenceSqlError("SchedulerService.bootstrap:recoverRunning")));

  const markRunning = SqlSchema.findOneOption({
    Request: TimedCommandIdRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, now }) =>
      sql`
        UPDATE scheduled_commands
        SET status = 'running',
            updated_at = ${now}
        WHERE command_id = ${commandId}
          AND status = 'pending'
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const markRetryFailure = SqlSchema.void({
    Request: RetryFailureRequest,
    execute: ({ commandId, retryCount, lastError, now }) =>
      sql`
        UPDATE scheduled_commands
        SET retry_count = ${retryCount},
            last_error = ${lastError},
            updated_at = ${now}
        WHERE command_id = ${commandId}
      `,
  });

  const markCompleted = SqlSchema.findOneOption({
    Request: TimedCommandIdRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, now }) =>
      sql`
        UPDATE scheduled_commands
        SET status = 'completed',
            retry_count = 0,
            run_count = run_count + 1,
            last_error = NULL,
            updated_at = ${now}
        WHERE command_id = ${commandId}
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const markRecurringPending = SqlSchema.findOneOption({
    Request: RecurringSuccessRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, scheduledAt, now }) =>
      sql`
        UPDATE scheduled_commands
        SET status = 'pending',
            scheduled_at = ${scheduledAt},
            retry_count = 0,
            run_count = run_count + 1,
            last_error = NULL,
            updated_at = ${now}
        WHERE command_id = ${commandId}
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const markFailed = SqlSchema.findOneOption({
    Request: RetryFailureRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, retryCount, lastError, now }) =>
      sql`
        UPDATE scheduled_commands
        SET status = 'failed',
            retry_count = ${retryCount},
            last_error = ${lastError},
            updated_at = ${now}
        WHERE command_id = ${commandId}
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const markCancelled = SqlSchema.findOneOption({
    Request: TimedCommandIdRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, now }) =>
      sql`
        UPDATE scheduled_commands
        SET status = 'cancelled',
            updated_at = ${now}
        WHERE command_id = ${commandId}
          AND status IN ('pending', 'running', 'failed')
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const updateScheduledAt = SqlSchema.findOneOption({
    Request: RescheduleCommandRequest,
    Result: ScheduledCommandRecord,
    execute: ({ commandId, scheduledAt, now }) =>
      sql`
        UPDATE scheduled_commands
        SET scheduled_at = ${scheduledAt},
            status = 'pending',
            retry_count = 0,
            last_error = NULL,
            updated_at = ${now}
        WHERE command_id = ${commandId}
          AND status IN ('pending', 'running', 'failed')
        RETURNING ${sql.unsafe(rowColumns)}
      `,
  });

  const mapPersistenceError = <A, E, R>(
    effect: Effect.Effect<A, E, R>,
    sqlOperation: string,
    decodeOperation: string,
  ): Effect.Effect<A, SchedulerPersistenceError, R> =>
    effect.pipe(
      Effect.mapError((cause: E) =>
        toSchedulerPersistenceError(sqlOperation, decodeOperation)(cause),
      ),
    );

  const get: SchedulerServiceShape["get"] = (commandId) =>
    mapPersistenceError(
      findByCommandId({ commandId }),
      "SchedulerService.get:query",
      "SchedulerService.get:decode",
    );

  const interruptActiveFiber = Effect.fn("SchedulerService.interruptActiveFiber")(function* (
    commandId: CommandId,
  ) {
    const fiber = yield* Ref.modify(activeFibersRef, (activeFibers) => {
      const activeFiber = activeFibers.get(commandId) ?? null;
      if (activeFiber === null) {
        return [null, activeFibers] as const;
      }
      const nextActiveFibers = new Map(activeFibers);
      nextActiveFibers.delete(commandId);
      return [activeFiber, nextActiveFibers] as const;
    });
    if (fiber !== null) {
      yield* Fiber.interrupt(fiber).pipe(Effect.ignore);
    }
  });

  const unregisterFiber = Effect.fn("SchedulerService.unregisterFiber")(function* (
    commandId: CommandId,
  ) {
    yield* Ref.update(activeFibersRef, (activeFibers) => {
      const nextActiveFibers = new Map(activeFibers);
      nextActiveFibers.delete(commandId);
      return nextActiveFibers;
    });
  });

  const waitUntilScheduledAt = (row: ScheduledCommandRecord) =>
    Effect.gen(function* () {
      const scheduledAtMs = yield* validateScheduledAt(row.commandId, row.scheduledAt);
      const nowMs = yield* Clock.currentTimeMillis;
      yield* Effect.sleep(Duration.millis(Math.max(0, scheduledAtMs - nowMs)));
    });

  const dispatchWithRetry = Effect.fn("SchedulerService.dispatchWithRetry")(function* (
    row: ScheduledCommandRecord,
    command: OrchestrationCommand,
  ) {
    const retryCountRef = yield* Ref.make(row.retryCount);
    const dispatch = orchestrationEngine.dispatch(command).pipe(
      Effect.tapError((cause) =>
        Effect.gen(function* () {
          const retryCount = yield* Ref.updateAndGet(retryCountRef, (count) => count + 1);
          yield* mapPersistenceError(
            markRetryFailure({
              commandId: row.commandId,
              retryCount,
              lastError: errorDetail(cause),
              now: yield* nowIso,
            }),
            "SchedulerService.dispatchWithRetry:updateFailure",
            "SchedulerService.dispatchWithRetry:decodeFailure",
          );
        }),
      ),
    );

    const retryPolicy = Schedule.exponential(RETRY_BASE_DELAY).pipe(Schedule.take(row.maxRetries));
    yield* dispatch.pipe(Effect.retry(retryPolicy));
    return yield* Ref.get(retryCountRef);
  });

  const executeDueCommand = Effect.fn("SchedulerService.executeDueCommand")(function* (
    commandId: CommandId,
  ) {
    const runningRow = yield* mapPersistenceError(
      markRunning({ commandId, now: yield* nowIso }),
      "SchedulerService.executeDueCommand:markRunning",
      "SchedulerService.executeDueCommand:decodeRunning",
    );
    if (Option.isNone(runningRow)) {
      return;
    }

    const row = runningRow.value;
    const command = commandForRun(row);
    const exit = yield* dispatchWithRetry(row, command).pipe(Effect.exit);
    if (Exit.isFailure(exit)) {
      const current = yield* get(commandId);
      const retryCount = Option.match(current, {
        onNone: () => row.retryCount,
        onSome: (value) => value.retryCount,
      });
      yield* mapPersistenceError(
        markFailed({
          commandId,
          retryCount,
          lastError: exit.cause.toString(),
          now: yield* nowIso,
        }),
        "SchedulerService.executeDueCommand:markFailed",
        "SchedulerService.executeDueCommand:decodeFailed",
      );
      return yield* Effect.failCause(exit.cause);
    }

    if (row.repeatInterval === null) {
      yield* mapPersistenceError(
        markCompleted({ commandId, now: yield* nowIso }),
        "SchedulerService.executeDueCommand:markCompleted",
        "SchedulerService.executeDueCommand:decodeCompleted",
      );
      return;
    }

    const intervalMs = yield* validateRepeatInterval(row.commandId, row.repeatInterval);
    if (intervalMs === null) {
      return yield* new SchedulerValidationError({
        commandId: row.commandId,
        detail: "repeatInterval is required for recurring scheduled commands",
      });
    }
    const currentTimeMs = yield* Clock.currentTimeMillis;
    const nextScheduledAt = DateTime.formatIso(DateTime.makeUnsafe(currentTimeMs + intervalMs));
    yield* mapPersistenceError(
      markRecurringPending({
        commandId,
        scheduledAt: nextScheduledAt,
        now: yield* nowIso,
      }),
      "SchedulerService.executeDueCommand:markRecurringPending",
      "SchedulerService.executeDueCommand:decodeRecurringPending",
    );
  });

  const runScheduledCommand = (row: ScheduledCommandRecord) =>
    Effect.gen(function* () {
      yield* waitUntilScheduledAt(row);
      if (row.repeatInterval === null) {
        yield* executeDueCommand(row.commandId);
        return;
      }

      const intervalMs = yield* validateRepeatInterval(row.commandId, row.repeatInterval);
      if (intervalMs === null) {
        return yield* new SchedulerValidationError({
          commandId: row.commandId,
          detail: "repeatInterval is required for recurring scheduled commands",
        });
      }
      yield* executeDueCommand(row.commandId);
      yield* Effect.sleep(Duration.millis(intervalMs));
      yield* executeDueCommand(row.commandId).pipe(
        Effect.repeat(Schedule.spaced(Duration.millis(intervalMs))),
      );
    }).pipe(
      Effect.catch((error) =>
        Effect.logWarning("scheduled command worker stopped", {
          commandId: row.commandId,
          detail: error.message,
        }),
      ),
      Effect.catchDefect((defect) =>
        Effect.logWarning("scheduled command worker defect", {
          commandId: row.commandId,
          defect,
        }),
      ),
      Effect.ensuring(unregisterFiber(row.commandId)),
    );

  const startFiber = Effect.fn("SchedulerService.startFiber")(function* (
    row: ScheduledCommandRecord,
  ) {
    if (row.status !== "pending") {
      return;
    }
    yield* interruptActiveFiber(row.commandId);
    const fiber = yield* runScheduledCommand(row).pipe(Effect.forkIn(scope));
    yield* Ref.update(activeFibersRef, (activeFibers) => {
      const nextActiveFibers = new Map(activeFibers);
      nextActiveFibers.set(row.commandId, fiber);
      return nextActiveFibers;
    });
  });

  const schedule: SchedulerServiceShape["schedule"] = (input) =>
    Effect.gen(function* () {
      if (input.commandId !== input.command.commandId) {
        return yield* new SchedulerValidationError({
          commandId: input.commandId,
          detail: "scheduled commandId must match command.commandId",
        });
      }
      yield* validateScheduledAt(input.commandId, input.scheduledAt);
      yield* validateRepeatInterval(input.commandId, input.repeatInterval);
      const row = yield* mapPersistenceError(
        persistScheduledCommand({
          commandId: input.commandId,
          command: input.command,
          scheduledAt: input.scheduledAt,
          repeatInterval: input.repeatInterval ?? null,
          maxRetries: input.maxRetries,
          now: yield* nowIso,
        }),
        "SchedulerService.schedule:upsert",
        "SchedulerService.schedule:decode",
      );
      yield* startFiber(row);
      return row;
    });

  const cancel: SchedulerServiceShape["cancel"] = (commandId) =>
    Effect.gen(function* () {
      const row = yield* mapPersistenceError(
        markCancelled({ commandId, now: yield* nowIso }),
        "SchedulerService.cancel:update",
        "SchedulerService.cancel:decode",
      );
      yield* interruptActiveFiber(commandId);
      return row;
    });

  const reschedule: SchedulerServiceShape["reschedule"] = (input) =>
    Effect.gen(function* () {
      yield* validateScheduledAt(input.commandId, input.scheduledAt);
      const row = yield* mapPersistenceError(
        updateScheduledAt({
          commandId: input.commandId,
          scheduledAt: input.scheduledAt,
          now: yield* nowIso,
        }),
        "SchedulerService.reschedule:update",
        "SchedulerService.reschedule:decode",
      );
      if (Option.isSome(row)) {
        yield* startFiber(row.value);
      }
      return row;
    });

  yield* markRunningAsPending;
  const pendingRows = yield* mapPersistenceError(
    findPendingCommands({}),
    "SchedulerService.bootstrap:findPending",
    "SchedulerService.bootstrap:decodePending",
  );
  yield* Effect.forEach(pendingRows, startFiber, { discard: true });

  return {
    schedule,
    cancel,
    reschedule,
    get,
  } satisfies SchedulerServiceShape;
});

export const SchedulerServiceLive = Layer.effect(SchedulerService, makeSchedulerService);
