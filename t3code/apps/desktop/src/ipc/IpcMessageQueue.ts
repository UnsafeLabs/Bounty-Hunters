/**
 * IPC message queue for backend disconnect resilience (issue #826).
 */

export const DEFAULT_MAX_QUEUE = 100;
export const DEFAULT_TTL_MS = 30_000;

export type ConnectionState = "connected" | "disconnected" | "reconnecting";

export class TimeoutError extends Error {
  readonly _tag = "TimeoutError" as const;
  constructor(message = "IPC message expired in queue") {
    super(message);
    this.name = "TimeoutError";
  }
}

export interface QueuedMessage<T = unknown> {
  id: string;
  payload: T;
  enqueuedAt: number;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export type StateListener = (state: ConnectionState) => void;

export class IpcMessageQueue<TPayload = unknown, TResult = unknown> {
  private queue: QueuedMessage<TPayload>[] = [];
  private state: ConnectionState = "disconnected";
  private listeners = new Set<StateListener>();
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private now: () => number;
  private sendFn: (payload: TPayload) => Promise<TResult>;
  private flushing = false;

  constructor(options: {
    send: (payload: TPayload) => Promise<TResult>;
    maxSize?: number;
    ttlMs?: number;
    now?: () => number;
    initialState?: ConnectionState;
  }) {
    this.sendFn = options.send;
    this.maxSize = options.maxSize ?? DEFAULT_MAX_QUEUE;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
    this.state = options.initialState ?? "disconnected";
  }

  get connectionState(): ConnectionState {
    return this.state;
  }

  get size(): number {
    return this.queue.length;
  }

  /** Observable-style subscription for UI connection status. */
  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  setConnectionState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const l of this.listeners) l(next);
    if (next === "connected") {
      void this.flush();
    }
  }

  /**
   * RPC call: bypass queue when healthy; otherwise enqueue.
   */
  async call(payload: TPayload): Promise<TResult> {
    this.expireOld();
    if (this.state === "connected" && !this.flushing && this.queue.length === 0) {
      return this.sendFn(payload);
    }
    return this.enqueue(payload);
  }

  private enqueue(payload: TPayload): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      // Drop oldest when full
      while (this.queue.length >= this.maxSize) {
        const old = this.queue.shift();
        if (old) old.reject(new TimeoutError("IPC queue overflow: dropped oldest message"));
      }
      const msg: QueuedMessage<TPayload> = {
        id: `m_${this.now()}_${Math.random().toString(36).slice(2, 8)}`,
        payload,
        enqueuedAt: this.now(),
        resolve: resolve as (v: unknown) => void,
        reject,
      };
      this.queue.push(msg);
    });
  }

  private expireOld(): void {
    const now = this.now();
    const keep: QueuedMessage<TPayload>[] = [];
    for (const m of this.queue) {
      if (now - m.enqueuedAt > this.ttlMs) {
        m.reject(new TimeoutError());
      } else {
        keep.push(m);
      }
    }
    this.queue = keep;
  }

  /** Flush queue FIFO on reconnect; drain completely before direct sends. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      this.expireOld();
      while (this.queue.length > 0 && this.state === "connected") {
        const m = this.queue.shift()!;
        if (this.now() - m.enqueuedAt > this.ttlMs) {
          m.reject(new TimeoutError());
          continue;
        }
        try {
          const result = await this.sendFn(m.payload);
          m.resolve(result);
        } catch (err) {
          m.reject(err);
        }
      }
    } finally {
      this.flushing = false;
    }
  }
}
