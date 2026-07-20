/**
 * Periodic backend health checks + auto-restart (issue #820).
 */

export const HEALTH_INTERVAL_MS = 15_000;
export const FAILURES_BEFORE_RESTART = 3;
export const MAX_RESTART_ATTEMPTS = 3;

export type HealthStatus = "healthy" | "unhealthy" | "restarting" | "failed";

export interface HealthMonitorOptions {
  /** Probe backend; return true if healthy. */
  ping: () => Promise<boolean>;
  /** Restart backend process. */
  restart: () => Promise<void>;
  /** Non-blocking user notification. */
  notify?: (message: string) => void;
  /** Hard error dialog after max restarts. */
  showErrorDialog?: (message: string) => void;
  /** Log line. */
  log?: (message: string, meta?: Record<string, unknown>) => void;
  /** Interval ms (default 15s). */
  intervalMs?: number;
  /** Jitter fraction 0-1 applied to interval (default 0.1). */
  jitter?: number;
  now?: () => number;
  random?: () => number;
}

export class BackendHealthMonitor {
  private consecutiveFailures = 0;
  private restartAttempts = 0;
  private status: HealthStatus = "healthy";
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private readonly opts: Required<
    Pick<HealthMonitorOptions, "ping" | "restart">
  > &
    HealthMonitorOptions;

  constructor(opts: HealthMonitorOptions) {
    this.opts = opts;
  }

  getStatus(): HealthStatus {
    return this.status;
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  getRestartAttempts(): number {
    return this.restartAttempts;
  }

  /** Compute next interval with jitter (Effect.Schedule.spaced + jitter parity). */
  nextIntervalMs(): number {
    const base = this.opts.intervalMs ?? HEALTH_INTERVAL_MS;
    const jitter = this.opts.jitter ?? 0.1;
    const r = (this.opts.random ?? Math.random)();
    const factor = 1 + (r * 2 - 1) * jitter;
    return Math.max(100, Math.round(base * factor));
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleNext();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    const ms = this.nextIntervalMs();
    this.timer = setTimeout(() => {
      void this.tick();
    }, ms);
  }

  /** Exposed for tests: run one health cycle. */
  async tick(): Promise<void> {
    if (this.stopped || this.status === "restarting" || this.status === "failed") {
      if (!this.stopped && this.status !== "failed") this.scheduleNext();
      return;
    }

    let ok = false;
    try {
      ok = await this.opts.ping();
    } catch (err) {
      this.opts.log?.("health check threw", { err: String(err) });
      ok = false;
    }

    if (ok) {
      this.consecutiveFailures = 0;
      this.status = "healthy";
      this.scheduleNext();
      return;
    }

    this.consecutiveFailures += 1;
    this.opts.log?.("health check failed", {
      consecutiveFailures: this.consecutiveFailures,
    });
    this.status = "unhealthy";

    if (this.consecutiveFailures >= FAILURES_BEFORE_RESTART) {
      await this.attemptRestart();
    }
    this.scheduleNext();
  }

  private async attemptRestart(): Promise<void> {
    if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
      this.status = "failed";
      this.opts.showErrorDialog?.(
        "Backend failed to restart after 3 attempts. Quit or retry manually.",
      );
      this.opts.log?.("restart permanently failed", {
        restartAttempts: this.restartAttempts,
      });
      return;
    }

    this.status = "restarting";
    this.restartAttempts += 1;
    this.opts.notify?.("Backend is restarting…");
    this.opts.log?.("restarting backend", { attempt: this.restartAttempts });

    try {
      await this.opts.restart();
      this.consecutiveFailures = 0;
      this.status = "healthy";
      this.opts.log?.("restart succeeded", { attempt: this.restartAttempts });
    } catch (err) {
      this.status = "unhealthy";
      this.opts.log?.("restart failed", { err: String(err) });
      if (this.restartAttempts >= MAX_RESTART_ATTEMPTS) {
        this.status = "failed";
        this.opts.showErrorDialog?.(
          "Backend failed to restart after 3 attempts. Quit or retry manually.",
        );
      }
    }
  }

  /** Manual retry after permanent failure. */
  async retryManual(): Promise<void> {
    this.restartAttempts = 0;
    this.consecutiveFailures = 0;
    this.status = "unhealthy";
    this.stopped = false;
    await this.attemptRestart();
    this.scheduleNext();
  }
}
