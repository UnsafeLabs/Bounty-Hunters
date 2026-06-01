/**
 * Deferred command scheduler with Effect.Schedule and SQLite persistence.
 * Allows scheduling commands for future execution.
 */

import { Effect, Schedule, Duration, pipe } from "effect";
import Database from "better-sqlite3";

interface ScheduledCommand {
  id: string;
  command: string;
  args: Record<string, unknown>;
  scheduledAt: number;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * SQLite-backed command scheduler
 */
export class CommandScheduler {
  private db: Database.Database;
  private checkInterval: ReturnType<typeof setInterval> | null = null;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this._initSchema();
  }

  private _initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_commands (
        id TEXT PRIMARY KEY,
        command TEXT NOT NULL,
        args TEXT DEFAULT '{}',
        scheduled_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        result TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status ON scheduled_commands(status);
      CREATE INDEX IF NOT EXISTS idx_scheduled ON scheduled_commands(scheduled_at);
    `);
  }

  /**
   * Schedule a command for future execution.
   */
  schedule(
    command: string,
    args: Record<string, unknown> = {},
    scheduledAt: Date | number
  ): string {
    const id = crypto.randomUUID();
    const now = Date.now();
    const timestamp = typeof scheduledAt === "number" ? scheduledAt : scheduledAt.getTime();

    this.db.prepare(`
      INSERT INTO scheduled_commands (id, command, args, scheduled_at, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, command, JSON.stringify(args), timestamp, now, now);

    return id;
  }

  /**
   * Schedule a command with a delay.
   */
  scheduleWithDelay(
    command: string,
    args: Record<string, unknown> = {},
    delayMs: number
  ): string {
    return this.schedule(command, args, Date.now() + delayMs);
  }

  /**
   * Schedule a recurring command with Effect.Schedule.
   */
  scheduleRecurring(
    command: string,
    args: Record<string, unknown> = {},
    intervalMs: number,
    maxOccurrences?: number
  ): string[] {
    const ids: string[] = [];
    const now = Date.now();
    let schedule = Schedule.spaced(Duration.millis(intervalMs));

    if (maxOccurrences) {
      schedule = Schedule.compose(schedule, Schedule.recurs(maxOccurrences));
    }

    // For simplicity, schedule next N occurrences
    const count = maxOccurrences || 10;
    for (let i = 0; i < count; i++) {
      const id = this.schedule(command, args, now + intervalMs * (i + 1));
      ids.push(id);
    }

    return ids;
  }

  /**
   * Get pending commands that are due.
   */
  getDueCommands(): ScheduledCommand[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_commands
      WHERE status = 'pending' AND scheduled_at <= ?
      ORDER BY scheduled_at ASC
    `).all(now) as any[];

    return rows.map((row) => ({
      ...row,
      args: JSON.parse(row.args || "{}"),
      result: row.result ? JSON.parse(row.result) : undefined,
    }));
  }

  /**
   * Mark command as completed with result.
   */
  complete(id: string, result: unknown): void {
    this.db.prepare(`
      UPDATE scheduled_commands
      SET status = 'completed', result = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result), Date.now(), id);
  }

  /**
   * Mark command as failed with error.
   */
  fail(id: string, error: string): void {
    this.db.prepare(`
      UPDATE scheduled_commands
      SET status = 'failed', error = ?, updated_at = ?
      WHERE id = ?
    `).run(error, Date.now(), id);
  }

  /**
   * Cancel a pending command.
   */
  cancel(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE scheduled_commands
      SET status = 'failed', error = 'Cancelled', updated_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(Date.now(), id);
    return result.changes > 0;
  }

  /**
   * Get command by ID.
   */
  getCommand(id: string): ScheduledCommand | null {
    const row = this.db.prepare(`SELECT * FROM scheduled_commands WHERE id = ?`).get(id) as any;
    if (!row) return null;
    return { ...row, args: JSON.parse(row.args || "{}"), result: row.result ? JSON.parse(row.result) : undefined };
  }

  /**
   * Start background polling for due commands.
   */
  start(intervalMs: number = 1000): void {
    this.checkInterval = setInterval(() => {
      const due = this.getDueCommands();
      for (const cmd of due) {
        this.db.prepare(`UPDATE scheduled_commands SET status = 'running', updated_at = ? WHERE id = ?`).run(Date.now(), cmd.id);
      }
    }, intervalMs);
  }

  /**
   * Stop background polling.
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  /**
   * Cleanup old completed/failed commands.
   */
  cleanup(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - olderThanMs;
    const result = this.db.prepare(`
      DELETE FROM scheduled_commands
      WHERE status IN ('completed', 'failed') AND updated_at < ?
    `).run(cutoff);
    return result.changes;
  }
}
