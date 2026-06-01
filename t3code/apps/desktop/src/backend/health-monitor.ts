/**
 * Backend health monitoring and auto-restart.
 * Monitors server process and restarts on failure.
 */

import { EventEmitter } from "events";
import { ChildProcess, spawn } from "child_process";

interface HealthConfig {
  checkIntervalMs?: number;
  maxFailures?: number;
  restartDelayMs?: number;
  healthEndpoint?: string;
}

export class BackendHealthMonitor extends EventEmitter {
  private process: ChildProcess | null = null;
  private failures = 0;
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private config: Required<HealthConfig>;
  private restarting = false;

  constructor(config: HealthConfig = {}) {
    super();
    this.config = {
      checkIntervalMs: config.checkIntervalMs || 10000,
      maxFailures: config.maxFailures || 3,
      restartDelayMs: config.restartDelayMs || 2000,
      healthEndpoint: config.healthEndpoint || "http://localhost:3000/health",
    };
  }

  start(command: string, args: string[] = []): void {
    this.process = spawn(command, args, { stdio: "pipe" });

    this.process.on("exit", (code) => {
      this.emit("exit", code);
      if (!this.restarting) {
        this.failures++;
        if (this.failures >= this.config.maxFailures) {
          this.emit("maxFailures", this.failures);
          this.scheduleRestart(command, args);
        }
      }
    });

    this.startHealthCheck();
  }

  private startHealthCheck(): void {
    this.checkTimer = setInterval(async () => {
      try {
        const res = await fetch(this.config.healthEndpoint, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          this.failures = 0;
          this.emit("healthy");
        } else {
          this.failures++;
          this.emit("unhealthy", res.status);
        }
      } catch {
        this.failures++;
        this.emit("unreachable");
      }
    }, this.config.checkIntervalMs);
  }

  private scheduleRestart(command: string, args: string[]): void {
    this.restarting = true;
    setTimeout(() => {
      this.restarting = false;
      this.failures = 0;
      this.start(command, args);
      this.emit("restarted");
    }, this.config.restartDelayMs);
  }

  stop(): void {
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.process) this.process.kill();
  }

  isHealthy(): boolean { return this.failures === 0; }
}
