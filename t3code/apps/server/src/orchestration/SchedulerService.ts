import type {
  CommandId,
  OrchestrationCommand,
  ScheduledCommand,
  ScheduledCommandStatus,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schedule from "effect/Schedule";

export interface ScheduledCommandRecord extends ScheduledCommand {
  readonly command: OrchestrationCommand;
  readonly status: ScheduledCommandStatus;
  readonly attempts: number;
  readonly updatedAt: string;
  readonly lastError?: string;
}

export interface SchedulerStore {
  readonly init: () => Promise<void>;
  readonly upsert: (record: ScheduledCommandRecord) => Promise<void>;
  readonly get: (commandId: CommandId) => Promise<ScheduledCommandRecord | undefined>;
  readonly listResumable: () => Promise<ReadonlyArray<ScheduledCommandRecord>>;
  readonly markStatus: (
    commandId: CommandId,
    status: ScheduledCommandStatus,
    patch?: Partial<Pick<ScheduledCommandRecord, "attempts" | "lastError" | "scheduledAt">>,
  ) => Promise<void>;
}

export interface SqliteLikeClient {
  readonly run: (sql: string, params?: ReadonlyArray<unknown>) => Promise<unknown>;
  readonly get: <T>(sql: string, params?: ReadonlyArray<unknown>) => Promise<T | undefined>;
  readonly all: <T>(sql: string, params?: ReadonlyArray<unknown>) => Promise<ReadonlyArray<T>>;
}

interface ScheduledCommandRow {
  readonly command_id: string;
  readonly command_json: string;
  readonly scheduled_at: string;
  readonly repeat_interval: string | null;
  readonly max_retries: number;
  readonly status: ScheduledCommandStatus;
  readonly attempts: number;
  readonly updated_at: string;
  readonly last_error: string | null;
}

const nowIso = () => new Date().toISOString();

const toRowRecord = (row: ScheduledCommandRow): ScheduledCommandRecord => ({
  commandId: row.command_id as CommandId,
  command: JSON.parse(row.command_json) as OrchestrationCommand,
  scheduledAt: row.scheduled_at,
  repeatInterval: row.repeat_interval ?? undefined,
  maxRetries: row.max_retries,
  status: row.status,
  attempts: row.attempts,
  updatedAt: row.updated_at,
  lastError: row.last_error ?? undefined,
});

export const createSqliteSchedulerStore = (db: SqliteLikeClient): SchedulerStore => ({
  init: async () => {
    await db.run(`
      CREATE TABLE IF NOT EXISTS scheduled_commands (
        command_id TEXT PRIMARY KEY,
        command_json TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        repeat_interval TEXT,
        max_retries INTEGER NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        last_error TEXT
      )
    `);
  },
  upsert: async (record) => {
    await db.run(
      `
      INSERT INTO scheduled_commands (
        command_id, command_json, scheduled_at, repeat_interval,
        max_retries, status, attempts, updated_at, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(command_id) DO UPDATE SET
        command_json = excluded.command_json,
        scheduled_at = excluded.scheduled_at,
        repeat_interval = excluded.repeat_interval,
        max_retries = excluded.max_retries,
        status = excluded.status,
        attempts = excluded.attempts,
        updated_at = excluded.updated_at,
        last_error = excluded.last_error
      `,
      [
        record.commandId,
        JSON.stringify(record.command),
        record.scheduledAt,
        record.repeatInterval ?? null,
        record.maxRetries,
        record.status,
        record.attempts,
        record.updatedAt,
        record.lastError ?? null,
      ],
    );
  },
  get: async (commandId) => {
    const row = await db.get<ScheduledCommandRow>(
      "SELECT * FROM scheduled_commands WHERE command_id = ?",
      [commandId],
    );
    return row ? toRowRecord(row) : undefined;
  },
  listResumable: async () => {
    const rows = await db.all<ScheduledCommandRow>(
      "SELECT * FROM scheduled_commands WHERE status IN ('pending', 'running')",
    );
    return rows.map(toRowRecord);
  },
  markStatus: async (commandId, status, patch = {}) => {
    await db.run(
      `
      UPDATE scheduled_commands
      SET status = ?, attempts = COALESCE(?, attempts), last_error = ?,
          scheduled_at = COALESCE(?, scheduled_at), updated_at = ?
      WHERE command_id = ?
      `,
      [
        status,
        patch.attempts ?? null,
        patch.lastError ?? null,
        patch.scheduledAt ?? null,
        nowIso(),
        commandId,
      ],
    );
  },
});

export class SchedulerService {
  private readonly activeFibers = new Map<CommandId, Fiber.Fiber<void, never>>();

  constructor(
    private readonly store: SchedulerStore,
    private readonly dispatchCommand: (
      command: OrchestrationCommand,
    ) => Promise<unknown> | Effect.Effect<unknown, unknown, never>,
  ) {}

  async start(): Promise<void> {
    await this.store.init();
    const pendingCommands = await this.store.listResumable();
    for (const command of pendingCommands) {
      this.arm(command);
    }
  }

  async schedule(command: OrchestrationCommand, schedule: ScheduledCommand): Promise<void> {
    const record: ScheduledCommandRecord = {
      ...schedule,
      command,
      status: "pending",
      attempts: 0,
      updatedAt: nowIso(),
    };
    await this.store.upsert(record);
    this.arm(record);
  }

  async cancel(commandId: CommandId): Promise<void> {
    this.clearTimer(commandId);
    await this.store.markStatus(commandId, "cancelled");
  }

  async reschedule(commandId: CommandId, scheduledAt: string): Promise<void> {
    const existing = await this.store.get(commandId);
    if (!existing) return;
    const next = {
      ...existing,
      status: "pending" as const,
      scheduledAt,
      updatedAt: nowIso(),
    };
    await this.store.upsert(next);
    this.arm(next);
  }

  private arm(record: ScheduledCommandRecord): void {
    if (record.status === "cancelled" || record.status === "completed") return;
    this.clearTimer(record.commandId);
    const delayMs = Math.max(0, Date.parse(record.scheduledAt) - Date.now());
    const program = Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.flatMap(() => Effect.promise(() => this.execute(record.commandId))),
      Effect.catchAllCause(() => Effect.void),
    );
    const fiber = Effect.runFork(program);
    this.activeFibers.set(record.commandId, fiber);
  }

  private async execute(commandId: CommandId): Promise<void> {
    const record = await this.store.get(commandId);
    if (!record || record.status === "cancelled") return;

    await this.store.markStatus(commandId, "running", { attempts: record.attempts + 1 });

    const retryPolicy = Schedule.exponential(Duration.seconds(1)).pipe(
      Schedule.compose(Schedule.recurs(record.maxRetries)),
    );

    const runDispatch = Effect.tryPromise({
      try: async () => {
        const result = this.dispatchCommand(record.command);
        if (Effect.isEffect(result)) {
          return await Effect.runPromise(result);
        }
        return await result;
      },
      catch: (error) => error,
    }).pipe(Effect.retry(retryPolicy));

    try {
      await Effect.runPromise(runDispatch);
      await this.completeOrRepeat(record);
    } catch (error) {
      await this.store.markStatus(commandId, "failed", {
        attempts: record.attempts + 1,
        lastError: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async completeOrRepeat(record: ScheduledCommandRecord): Promise<void> {
    if (!record.repeatInterval) {
      await this.store.markStatus(record.commandId, "completed");
      return;
    }

    const scheduledAt = new Date(Date.now() + parseRepeatIntervalMs(record.repeatInterval));
    const next = {
      ...record,
      status: "pending" as const,
      attempts: 0,
      scheduledAt: scheduledAt.toISOString(),
      updatedAt: nowIso(),
      lastError: undefined,
    };
    await this.store.upsert(next);
    this.arm(next);
  }

  private clearTimer(commandId: CommandId): void {
    const fiber = this.activeFibers.get(commandId);
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber).pipe(Effect.ignore));
    }
    this.activeFibers.delete(commandId);
  }
}

export const parseRepeatIntervalMs = (repeatInterval: string): number => {
  const isoSeconds = repeatInterval.match(/^PT(\d+)S$/);
  if (isoSeconds) return Number(isoSeconds[1]) * 1000;

  const shorthand = repeatInterval.match(/^(\d+)(ms|s|m|h)$/);
  if (shorthand) {
    const value = Number(shorthand[1]);
    const unit = shorthand[2];
    if (unit === "ms") return value;
    if (unit === "s") return value * 1000;
    if (unit === "m") return value * 60 * 1000;
    return value * 60 * 60 * 1000;
  }

  const cronEveryMinutes = repeatInterval.match(/^\*\/(\d+) \* \* \* \*$/);
  if (cronEveryMinutes) return Number(cronEveryMinutes[1]) * 60 * 1000;

  throw new Error(`Unsupported repeat interval: ${repeatInterval}`);
};
