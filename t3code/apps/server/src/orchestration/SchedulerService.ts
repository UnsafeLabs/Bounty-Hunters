/**
 * Deferred command scheduler with SQLite-style persistence (issue #851).
 */

export type ScheduleStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface ScheduledCommand {
  commandId: string;
  scheduledAt: string; // ISO
  repeatIntervalMs?: number | null;
  maxRetries: number;
  status: ScheduleStatus;
  attempts: number;
  lastError?: string | null;
  payload?: unknown;
}

export interface SchedulerStore {
  list(): ScheduledCommand[] | Promise<ScheduledCommand[]>;
  upsert(cmd: ScheduledCommand): void | Promise<void>;
  get(commandId: string): ScheduledCommand | undefined | Promise<ScheduledCommand | undefined>;
}

export class InMemorySchedulerStore implements SchedulerStore {
  private rows = new Map<string, ScheduledCommand>();

  list(): ScheduledCommand[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }

  upsert(cmd: ScheduledCommand): void {
    this.rows.set(cmd.commandId, { ...cmd });
  }

  get(commandId: string): ScheduledCommand | undefined {
    const r = this.rows.get(commandId);
    return r ? { ...r } : undefined;
  }

  /** Simulate boot load of pending rows. */
  loadPending(): ScheduledCommand[] {
    return this.list().filter((c) => c.status === "pending" || c.status === "running");
  }
}

export function backoffMs(attempt: number): number {
  // attempt 1 -> 1s, 2 -> 2s, 3 -> 4s ...
  return Math.min(60_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

export class SchedulerService {
  private store: SchedulerStore;
  private execute: (cmd: ScheduledCommand) => Promise<void>;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;

  constructor(options: {
    store: SchedulerStore;
    execute: (cmd: ScheduledCommand) => Promise<void>;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.store = options.store;
    this.execute = options.execute;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async schedule(input: {
    commandId: string;
    scheduledAt: string;
    repeatIntervalMs?: number | null;
    maxRetries?: number;
    payload?: unknown;
  }): Promise<ScheduledCommand> {
    const cmd: ScheduledCommand = {
      commandId: input.commandId,
      scheduledAt: input.scheduledAt,
      repeatIntervalMs: input.repeatIntervalMs ?? null,
      maxRetries: input.maxRetries ?? 3,
      status: "pending",
      attempts: 0,
      lastError: null,
      payload: input.payload,
    };
    await this.store.upsert(cmd);
    return cmd;
  }

  async cancel(commandId: string): Promise<ScheduledCommand | undefined> {
    const cmd = await this.store.get(commandId);
    if (!cmd) return undefined;
    if (cmd.status === "completed" || cmd.status === "cancelled") return cmd;
    const next = { ...cmd, status: "cancelled" as const };
    await this.store.upsert(next);
    return next;
  }

  async reschedule(commandId: string, scheduledAt: string): Promise<ScheduledCommand | undefined> {
    const cmd = await this.store.get(commandId);
    if (!cmd) return undefined;
    const next: ScheduledCommand = {
      ...cmd,
      scheduledAt,
      status: cmd.status === "cancelled" ? "pending" : cmd.status === "completed" ? "pending" : "pending",
      lastError: null,
    };
    // do not create duplicate: same commandId upsert
    await this.store.upsert(next);
    return next;
  }

  /** Due commands at current time. */
  async due(nowMs?: number): Promise<ScheduledCommand[]> {
    const t = nowMs ?? this.now();
    const all = await this.store.list();
    return all.filter(
      (c) => c.status === "pending" && Date.parse(c.scheduledAt) <= t,
    );
  }

  /**
   * Run one due command with retries / recurrence.
   * Uses TestClock-friendly now/sleep injection.
   */
  async tick(nowMs?: number): Promise<ScheduledCommand[]> {
    const due = await this.due(nowMs);
    const results: ScheduledCommand[] = [];
    for (const cmd of due) {
      results.push(await this.runOne(cmd));
    }
    return results;
  }

  private async runOne(cmd: ScheduledCommand): Promise<ScheduledCommand> {
    let current: ScheduledCommand = { ...cmd, status: "running" };
    await this.store.upsert(current);

    while (true) {
      current = { ...current, attempts: current.attempts + 1 };
      try {
        await this.execute(current);
        if (current.repeatIntervalMs && current.repeatIntervalMs > 0) {
          const nextAt = new Date(
            Date.parse(current.scheduledAt) + current.repeatIntervalMs,
          ).toISOString();
          // if interval from now is preferred when late:
          const base = Math.max(Date.parse(current.scheduledAt), this.now());
          const nextAt2 = new Date(base + current.repeatIntervalMs).toISOString();
          current = {
            ...current,
            status: "pending",
            scheduledAt: nextAt2,
            lastError: null,
          };
        } else {
          current = { ...current, status: "completed", lastError: null };
        }
        await this.store.upsert(current);
        return current;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (current.attempts < current.maxRetries) {
          await this.sleep(backoffMs(current.attempts));
          current = { ...current, lastError: message, status: "running" };
          await this.store.upsert(current);
          continue;
        }
        current = { ...current, status: "failed", lastError: message };
        await this.store.upsert(current);
        return current;
      }
    }
  }

  /** Boot: reload pending/running as pending for recovery. */
  async recoverOnBoot(): Promise<number> {
    const all = await this.store.list();
    let n = 0;
    for (const c of all) {
      if (c.status === "running") {
        await this.store.upsert({ ...c, status: "pending" });
        n += 1;
      } else if (c.status === "pending") {
        n += 1;
      }
    }
    return n;
  }
}
