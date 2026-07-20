/**
 * SSH tunnel keepalive + reconnect with exponential backoff (issue #832).
 */

export const SERVER_ALIVE_INTERVAL = 15;
export const SERVER_ALIVE_COUNT_MAX = 3;
export const BACKOFF_SCHEDULE_MS = [1000, 4000, 16000, 60000] as const;
export const MAX_RECONNECT_ATTEMPTS = 5;

export type TunnelState = "connecting" | "connected" | "reconnecting" | "failed" | "disconnected";

export interface TunnelSshOptions {
  ServerAliveInterval: number;
  ServerAliveCountMax: number;
}

export function sshKeepaliveConfig(): TunnelSshOptions {
  return {
    ServerAliveInterval: SERVER_ALIVE_INTERVAL,
    ServerAliveCountMax: SERVER_ALIVE_COUNT_MAX,
  };
}

export function nextBackoffMs(attemptIndex: number): number {
  // attemptIndex 0..n maps to schedule, capped at last
  const i = Math.min(attemptIndex, BACKOFF_SCHEDULE_MS.length - 1);
  return BACKOFF_SCHEDULE_MS[i]!;
}

export type StateListener = (state: TunnelState, meta?: Record<string, unknown>) => void;

export class TunnelConnectionManager {
  private state: TunnelState = "disconnected";
  private reconnectAttempts = 0;
  private manualDisconnect = false;
  private listeners = new Set<StateListener>();
  private readonly connectFn: () => Promise<void>;
  private readonly probeFn: () => Promise<boolean>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: {
    connect: () => Promise<void>;
    probe?: () => Promise<boolean>;
    sleep?: (ms: number) => Promise<void>;
  }) {
    this.connectFn = options.connect;
    this.probeFn = options.probe ?? (async () => true);
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  getState(): TunnelState {
    return this.state;
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private setState(next: TunnelState, meta?: Record<string, unknown>): void {
    this.state = next;
    for (const l of this.listeners) l(next, meta);
  }

  async connect(): Promise<void> {
    this.manualDisconnect = false;
    this.setState("connecting");
    await this.connectFn();
    this.reconnectAttempts = 0;
    this.setState("connected");
  }

  /** Manual disconnect: no auto-reconnect. */
  disconnect(): void {
    this.manualDisconnect = true;
    this.setState("disconnected");
  }

  /** Called when keepalive / TCP probe detects drop. */
  async onTunnelDrop(): Promise<void> {
    if (this.manualDisconnect) return;
    if (this.state === "failed" || this.state === "reconnecting") return;

    while (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && !this.manualDisconnect) {
      this.setState("reconnecting", { attempt: this.reconnectAttempts + 1 });
      const delay = nextBackoffMs(this.reconnectAttempts);
      await this.sleep(delay);
      if (this.manualDisconnect) return;
      try {
        await this.connectFn();
        this.reconnectAttempts = 0;
        this.setState("connected");
        return;
      } catch {
        this.reconnectAttempts += 1;
      }
    }
    this.setState("failed", { attempts: this.reconnectAttempts });
  }

  /** Periodic TCP probe through tunnel. */
  async healthProbe(): Promise<boolean> {
    if (this.state !== "connected") return false;
    try {
      const ok = await this.probeFn();
      if (!ok) await this.onTunnelDrop();
      return ok;
    } catch {
      await this.onTunnelDrop();
      return false;
    }
  }
}
