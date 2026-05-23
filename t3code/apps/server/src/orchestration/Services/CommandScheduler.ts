import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Context from "effect/Context";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface ScheduledCommand {
  readonly id: string;
  readonly command: string;
  readonly args: Record<string, unknown>;
  readonly scheduledAt: number;
  readonly executeAt: number;
  readonly maxRetries: number;
  readonly retryCount: number;
  readonly status: "pending" | "running" | "completed" | "failed";
}

export interface CommandSchedulerShape {
  readonly schedule: (input: {
    command: string;
    args?: Record<string, unknown>;
    executeAt: number;
    maxRetries?: number;
  }) => Effect.Effect<string, never>;
  readonly cancel: (id: string) => Effect.Effect<boolean, never>;
  readonly listPending: () => Effect.Effect<ScheduledCommand[], never>;
  readonly processDue: () => Effect.Effect<number, never>;
}

export class CommandScheduler extends Context.Service<CommandScheduler, CommandSchedulerShape>()(
  "t3/orchestration/CommandScheduler",
) {}

export const makeCommandScheduler = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  // Ensure table exists
  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_commands (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      args TEXT DEFAULT '{}',
      scheduled_at INTEGER NOT NULL,
      execute_at INTEGER NOT NULL,
      max_retries INTEGER DEFAULT 3,
      retry_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending'
    )
  `;

  const schedule: CommandSchedulerShape["schedule"] = (input) =>
    Effect.gen(function* () {
      const id = crypto.randomUUID();
      yield* sql`
        INSERT INTO scheduled_commands (id, command, args, scheduled_at, execute_at, max_retries)
        VALUES (${id}, ${input.command}, ${JSON.stringify(input.args || {})}, ${Date.now()}, ${input.executeAt}, ${input.maxRetries ?? 3})
      `;
      return id;
    });

  const cancel: CommandSchedulerShape["cancel"] = (id) =>
    Effect.gen(function* () {
      yield* sql`DELETE FROM scheduled_commands WHERE id = ${id} AND status = 'pending'`;
      return true;
    });

  const listPending: CommandSchedulerShape["listPending"] = () =>
    Effect.gen(function* () {
      const rows = yield* sql.all(
        sql`SELECT * FROM scheduled_commands WHERE status = 'pending' ORDER BY execute_at ASC`,
      );
      return rows.map((r: any) => ({
        id: r.id,
        command: r.command,
        args: JSON.parse(r.args),
        scheduledAt: r.scheduled_at,
        executeAt: r.execute_at,
        maxRetries: r.max_retries,
        retryCount: r.retry_count,
        status: r.status,
      }));
    });

  const processDue: CommandSchedulerShape["processDue"] = () =>
    Effect.gen(function* () {
      const now = Date.now();
      const due = yield* sql.all(
        sql`SELECT * FROM scheduled_commands WHERE status = 'pending' AND execute_at <= ${now}`,
      );

      let processed = 0;
      for (const row of due) {
        yield* sql`UPDATE scheduled_commands SET status = 'running' WHERE id = ${row.id}`;
        // Execute command (simplified)
        yield* sql`UPDATE scheduled_commands SET status = 'completed' WHERE id = ${row.id}`;
        processed++;
      }

      return processed;
    });

  return { schedule, cancel, listPending, processDue } satisfies CommandSchedulerShape;
});
