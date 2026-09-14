import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

/**
 * Connection state of the desktop backend link as observed by the IPC layer.
 *
 * - `connected`: backend is reachable; RPC calls bypass the queue.
 * - `disconnected`: backend is unreachable; outgoing RPC calls are buffered.
 * - `reconnecting`: a restart/reconnect is in progress; calls stay buffered
 *   until the queue has been flushed.
 */
export type IpcConnectionState = "connected" | "disconnected" | "reconnecting";

/** Default bound for buffered IPC messages (spec: 100 messages, FIFO). */
export const DEFAULT_IPC_MESSAGE_QUEUE_MAX_SIZE = 100;

/** Default TTL for a buffered IPC message (spec: 30 seconds). */
export const DEFAULT_IPC_MESSAGE_TTL = Duration.seconds(30);

export type IpcMessageQueueOverflowPolicy = "drop-oldest";

export interface IpcMessageQueueOptions {
  readonly maxSize?: number | undefined;
  readonly messageTtl?: Duration.Duration | undefined;
  readonly overflowPolicy?: IpcMessageQueueOverflowPolicy | undefined;
}

export type IpcMessageExpiryReason = "expired" | "overflow";

/**
 * Typed failure delivered to callers whose queued RPC call either waited
 * longer than the queue TTL or was dropped to respect the max queue size.
 */
export class IpcTimeoutError extends Data.TaggedError("TimeoutError")<{
  readonly channel: string;
  readonly ageMillis: number;
  readonly reason: IpcMessageExpiryReason;
}> {
  override get message(): string {
    return `IPC message on channel "${this.channel}" timed out after ${this.ageMillis}ms (${this.reason}).`;
  }
}

export interface QueuedIpcMessageSnapshot {
  readonly id: number;
  readonly channel: string;
  readonly enqueuedAtMillis: number;
}

interface PendingIpcMessage {
  readonly id: number;
  readonly channel: string;
  readonly enqueuedAtMillis: number;
  readonly deferred: Deferred.Deferred<unknown, unknown>;
  readonly run: Effect.Effect<unknown, unknown>;
}

export type IpcConnectionStateListener = (state: IpcConnectionState) => void;

/**
 * Bounded FIFO queue that buffers outgoing backend RPC calls while the
 * backend connection is lost and replays them in order on reconnect.
 *
 * The queue is intentionally constructible without an Effect environment so
 * `DesktopIpc.make` can own one synchronously; every operation that touches
 * the clock or caller fibers is exposed as an Effect value.
 */
export class IpcMessageQueue {
  private pending: Array<PendingIpcMessage> = [];
  private connectionStateValue: IpcConnectionState = "connected";
  private readonly listeners = new Set<IpcConnectionStateListener>();
  private nextMessageId = 1;
  private draining = false;
  private readonly maxSize: number;
  private readonly messageTtl: Duration.Duration;

  constructor(options?: IpcMessageQueueOptions) {
    const requestedMaxSize = options?.maxSize ?? DEFAULT_IPC_MESSAGE_QUEUE_MAX_SIZE;
    this.maxSize =
      Number.isFinite(requestedMaxSize) && requestedMaxSize > 0
        ? Math.floor(requestedMaxSize)
        : DEFAULT_IPC_MESSAGE_QUEUE_MAX_SIZE;
    this.messageTtl = options?.messageTtl ?? DEFAULT_IPC_MESSAGE_TTL;
  }

  /** Current connection state (synchronous read, for non-Effect call sites). */
  getConnectionStateSync(): IpcConnectionState {
    return this.connectionStateValue;
  }

  /** Number of buffered messages (synchronous read). */
  getSizeSync(): number {
    return this.pending.length;
  }

  /** Whether a flush is currently replaying buffered messages. */
  isDrainingSync(): boolean {
    return this.draining;
  }

  /**
   * Subscribe to connection-state transitions. The listener is invoked
   * immediately with the current state and then on every transition.
   * Returns an unsubscribe function for the web-UI bridge.
   */
  subscribe(listener: IpcConnectionStateListener): () => void {
    this.listeners.add(listener);
    listener(this.connectionStateValue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Current connection state as an Effect (for Effect call sites). */
  readonly connectionState: Effect.Effect<IpcConnectionState> = Effect.sync(() =>
    this.getConnectionStateSync(),
  );

  /** Number of buffered messages as an Effect. */
  readonly size: Effect.Effect<number> = Effect.sync(() => this.getSizeSync());

  /** FIFO snapshot of buffered messages (oldest first) as an Effect. */
  readonly snapshot: Effect.Effect<readonly QueuedIpcMessageSnapshot[]> = Effect.sync(() =>
    this.pending.map((entry) => ({
      id: entry.id,
      channel: entry.channel,
      enqueuedAtMillis: entry.enqueuedAtMillis,
    })),
  );

  /** Subscribe to connection-state transitions as an Effect. */
  subscribeEffect(listener: IpcConnectionStateListener): Effect.Effect<() => void> {
    return Effect.sync(() => this.subscribe(listener));
  }

  setConnectionState(state: IpcConnectionState): Effect.Effect<void> {
    return Effect.sync(() => {
      this.emit(state);
    }).pipe(Effect.withSpan("desktop.ipc.queue.setConnectionState"));
  }

  markDisconnected(): Effect.Effect<void> {
    return this.setConnectionState("disconnected");
  }

  markReconnecting(): Effect.Effect<void> {
    return this.setConnectionState("reconnecting");
  }

  markConnected(): Effect.Effect<void> {
    return this.setConnectionState("connected");
  }

  /**
   * Send an RPC call, buffering it while the backend is unavailable.
   *
   * Healthy path: when the connection is `connected` and no messages are
   * buffered (and no flush is running), `send` executes directly.
   *
   * Degraded path: the call is appended to the bounded FIFO and the caller's
   * fiber waits until `flush()` replays it, the TTL elapses (typed
   * `IpcTimeoutError` with reason `expired`), or it is dropped to respect
   * `maxSize` (typed `IpcTimeoutError` with reason `overflow`).
   */
  call<A, E>(
    channel: string,
    send: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | IpcTimeoutError> {
    const self = this;
    const run = Effect.gen(function* () {
      if (self.shouldBypassQueue()) {
        return yield* send;
      }

      const enqueuedAtMillis = yield* Clock.currentTimeMillis;
      const deferred = yield* Deferred.make<unknown, unknown>();
      const entry: PendingIpcMessage = {
        id: self.nextMessageId++,
        channel,
        enqueuedAtMillis,
        deferred,
        run: send as unknown as Effect.Effect<unknown, unknown>,
      };
      self.pending.push(entry);
      yield* self.enforceBounds(enqueuedAtMillis);

      if (!self.isQueued(entry.id)) {
        // The new entry itself was dropped (defensive; only possible with a
        // degenerate capacity). Fail fast instead of waiting for the TTL.
        return yield* Effect.fail(
          new IpcTimeoutError({ channel, ageMillis: 0, reason: "overflow" }),
        );
      }

      const outcome = yield* Deferred.await(deferred).pipe(
        Effect.map((value) => ({ _tag: "delivered" as const, value })),
        Effect.raceFirst(
          Effect.sleep(self.messageTtl).pipe(Effect.map(() => ({ _tag: "expired" as const }))),
        ),
      );

      if (outcome._tag === "expired") {
        self.removeById(entry.id);
        return yield* Effect.fail(
          new IpcTimeoutError({
            channel,
            ageMillis: Duration.toMillis(self.messageTtl),
            reason: "expired",
          }),
        );
      }

      return outcome.value as A;
    }).pipe(
      Effect.annotateLogs({ channel }),
      Effect.withSpan("desktop.ipc.queue.call"),
    );
    return run as unknown as Effect.Effect<A, E | IpcTimeoutError>;
  }

  /**
   * Replay buffered messages in FIFO order. Normally invoked after the
   * backend reconnects. Each message's captured `send` effect is executed
   * sequentially so ordering is preserved; a single message failure only
   * fails its own caller. Stale messages fail with `IpcTimeoutError`.
   *
   * Returns the number of messages replayed (expired messages are not
   * counted). The drain loop keeps running while new messages arrive during
   * the flush, so the queue is completely drained before direct sends resume.
   */
  flush(): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      if (self.draining) {
        return 0;
      }
      self.draining = true;
      try {
        let delivered = 0;
        while (self.pending.length > 0) {
          const batch = self.pending.splice(0, self.pending.length);
          const now = yield* Clock.currentTimeMillis;
          const ttlMillis = Duration.toMillis(self.messageTtl);
          for (const entry of batch) {
            const ageMillis = now - entry.enqueuedAtMillis;
            if (ageMillis >= ttlMillis) {
              yield* Deferred.fail(
                entry.deferred,
                new IpcTimeoutError({ channel: entry.channel, ageMillis, reason: "expired" }),
              ).pipe(Effect.ignore);
              continue;
            }
            const exit = yield* Effect.exit(entry.run);
            yield* Deferred.done(
              entry.deferred,
              exit as unknown as Exit.Exit<unknown, unknown>,
            ).pipe(Effect.ignore);
            delivered += 1;
          }
        }
        return delivered;
      } finally {
        self.draining = false;
      }
    }).pipe(Effect.withSpan("desktop.ipc.queue.flush"));
  }

  /**
   * Fail buffered messages older than the TTL with `IpcTimeoutError`.
   * Returns the number of expired messages. Waiting caller fibers observe the
   * typed error; `call()` additionally enforces the TTL per waiter, so this
   * is both a deterministic hook for tests and a sweeper for entries whose
   * waiter was interrupted.
   */
  sweepExpired(): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const ttlMillis = Duration.toMillis(self.messageTtl);
      let expired = 0;
      const remaining: Array<PendingIpcMessage> = [];
      for (const entry of self.pending) {
        const ageMillis = now - entry.enqueuedAtMillis;
        if (ageMillis >= ttlMillis) {
          yield* Deferred.fail(
            entry.deferred,
            new IpcTimeoutError({ channel: entry.channel, ageMillis, reason: "expired" }),
          ).pipe(Effect.ignore);
          expired += 1;
        } else {
          remaining.push(entry);
        }
      }
      self.pending = remaining;
      return expired;
    }).pipe(Effect.withSpan("desktop.ipc.queue.sweepExpired"));
  }

  /**
   * Mark the connection `connected` and flush buffered messages in FIFO
   * order. Returns the number of replayed messages.
   */
  reconnect(): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      self.emit("connected");
      return yield* self.flush();
    }).pipe(Effect.withSpan("desktop.ipc.queue.reconnect"));
  }

  private shouldBypassQueue(): boolean {
    return (
      this.connectionStateValue === "connected" && !this.draining && this.pending.length === 0
    );
  }

  private isQueued(id: number): boolean {
    return this.pending.some((entry) => entry.id === id);
  }

  private removeById(id: number): boolean {
    const index = this.pending.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return false;
    }
    this.pending.splice(index, 1);
    return true;
  }

  private enforceBounds(nowMillis: number): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      while (self.pending.length > self.maxSize) {
        const dropped = self.pending.shift();
        if (dropped === undefined) {
          return;
        }
        yield* Deferred.fail(
          dropped.deferred,
          new IpcTimeoutError({
            channel: dropped.channel,
            ageMillis: Math.max(0, nowMillis - dropped.enqueuedAtMillis),
            reason: "overflow",
          }),
        ).pipe(Effect.ignore);
      }
    });
  }

  private emit(state: IpcConnectionState): void {
    this.connectionStateValue = state;
    for (const listener of [...this.listeners]) {
      try {
        listener(state);
      } catch {
        // Observer failures must not break state transitions.
      }
    }
  }
}
