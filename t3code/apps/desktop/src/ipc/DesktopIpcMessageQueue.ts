import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

const DEFAULT_QUEUE_CAPACITY = 100;
const DEFAULT_MESSAGE_TTL = Duration.seconds(30);

/**
 * Lifecycle of the backend connection that desktop IPC invokes depend on.
 *
 * While the connection is anything other than `connected`, invoke messages are
 * buffered instead of failing, so a transient backend restart does not surface
 * as an error to the renderer.
 */
export type IpcConnectionState = "connected" | "disconnected" | "reconnecting";

export class IpcMessageTimeoutError extends Data.TaggedError("IpcMessageTimeoutError")<{
  readonly channel: string;
  readonly timeoutMillis: number;
}> {
  override get message() {
    return `IPC message on channel ${this.channel} timed out after ${this.timeoutMillis}ms while the backend was disconnected.`;
  }
}

export class IpcMessageQueueOverflowError extends Data.TaggedError("IpcMessageQueueOverflowError")<{
  readonly channel: string;
  readonly capacity: number;
}> {
  override get message() {
    return `IPC message queue is full (capacity ${this.capacity}); dropped the oldest message on channel ${this.channel} while the backend was disconnected.`;
  }
}

export interface DesktopIpcMessageQueueShape {
  /**
   * Run `message` when the backend is connected, otherwise buffer it until the
   * connection is restored. Buffered messages fail with {@link IpcMessageTimeoutError}
   * once the per-message timeout elapses. When the queue is already at capacity,
   * the oldest buffered message is dropped to make room for the newest one, and
   * that dropped message fails with {@link IpcMessageQueueOverflowError}.
   */
  readonly enqueue: <A, E, R>(
    channel: string,
    message: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E | IpcMessageTimeoutError | IpcMessageQueueOverflowError, R>;
  readonly connectionState: Effect.Effect<IpcConnectionState>;
  readonly setConnectionState: (state: IpcConnectionState) => Effect.Effect<void>;
  readonly subscribe: (
    onChange: (state: IpcConnectionState) => void,
  ) => Effect.Effect<() => void>;
  readonly size: Effect.Effect<number>;
}

export interface DesktopIpcMessageQueueOptions {
  readonly capacity?: number;
  readonly messageTtl?: Duration.Duration;
  readonly initialConnectionState?: IpcConnectionState;
}

interface QueuedMessage {
  readonly channel: string;
  readonly deferred: Deferred.Deferred<void, IpcMessageTimeoutError | IpcMessageQueueOverflowError>;
}

interface QueueState {
  readonly connection: IpcConnectionState;
  readonly queued: ReadonlyArray<QueuedMessage>;
}

const normalizeCapacity = (capacity: number | undefined): number =>
  capacity !== undefined && Number.isInteger(capacity) && capacity >= 1
    ? capacity
    : DEFAULT_QUEUE_CAPACITY;

export const make = Effect.fn("desktop.ipc.messageQueue.make")(function* (
  options: DesktopIpcMessageQueueOptions = {},
) {
  const capacity = normalizeCapacity(options.capacity);
  const messageTtl = options.messageTtl ?? DEFAULT_MESSAGE_TTL;
  const timeoutMillis = Duration.toMillis(messageTtl);
  const subscribers = new Set<(state: IpcConnectionState) => void>();
  const stateRef = yield* Ref.make<QueueState>({
    connection: options.initialConnectionState ?? "disconnected",
    queued: [],
  });

  const notify = (state: IpcConnectionState): Effect.Effect<void> =>
    Effect.sync(() => {
      for (const subscriber of subscribers) {
        subscriber(state);
      }
    });

  const removeQueued = (entry: QueuedMessage): Effect.Effect<void> =>
    Ref.update(stateRef, (state) => ({
      ...state,
      queued: state.queued.filter((queued) => queued !== entry),
    }));

  const setConnectionState = (next: IpcConnectionState): Effect.Effect<void> =>
    Effect.gen(function* () {
      const { changed, flushed } = yield* Ref.modify(stateRef, (state) => {
        const changed = state.connection !== next;
        if (next === "connected") {
          return [
            { changed, flushed: state.queued },
            { connection: next, queued: [] as ReadonlyArray<QueuedMessage> },
          ] as const;
        }
        return [
          { changed, flushed: [] as ReadonlyArray<QueuedMessage> },
          { ...state, connection: next },
        ] as const;
      });

      if (changed) {
        yield* notify(next);
      }
      yield* Effect.forEach(flushed, (entry) => Deferred.succeed(entry.deferred, void 0), {
        discard: true,
      });
    });

  const enqueue = <A, E, R>(
    channel: string,
    message: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | IpcMessageTimeoutError | IpcMessageQueueOverflowError, R> =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<
        void,
        IpcMessageTimeoutError | IpcMessageQueueOverflowError
      >();
      const entry: QueuedMessage = { channel, deferred };

      const decision = yield* Ref.modify(stateRef, (state) => {
        if (state.connection === "connected") {
          return [{ run: true, evicted: Option.none<QueuedMessage>() }, state] as const;
        }
        // Buffer the message. When the queue is full, drop the oldest message so
        // the newest one is admitted (FIFO eviction) per "drops oldest when full".
        if (state.queued.length >= capacity) {
          const [oldest, ...rest] = state.queued;
          return [
            { run: false, evicted: Option.fromNullishOr(oldest) },
            { ...state, queued: [...rest, entry] },
          ] as const;
        }
        return [
          { run: false, evicted: Option.none<QueuedMessage>() },
          { ...state, queued: [...state.queued, entry] },
        ] as const;
      });

      if (decision.run) {
        return yield* message;
      }
      if (Option.isSome(decision.evicted)) {
        const dropped = decision.evicted.value;
        yield* Deferred.fail(
          dropped.deferred,
          new IpcMessageQueueOverflowError({ channel: dropped.channel, capacity }),
        );
      }

      const released = yield* Deferred.await(deferred).pipe(
        Effect.timeoutOption(messageTtl),
        Effect.ensuring(removeQueued(entry)),
      );
      if (Option.isNone(released)) {
        return yield* new IpcMessageTimeoutError({ channel, timeoutMillis });
      }
      return yield* message;
    });

  const subscribe = (onChange: (state: IpcConnectionState) => void): Effect.Effect<() => void> =>
    Effect.sync(() => {
      subscribers.add(onChange);
      return () => {
        subscribers.delete(onChange);
      };
    });

  yield* Effect.addFinalizer(() =>
    Ref.modify(stateRef, (state) => [
      state.queued,
      { ...state, queued: [] as ReadonlyArray<QueuedMessage> },
    ]).pipe(
      Effect.flatMap((pending) =>
        Effect.forEach(
          pending,
          (entry) =>
            Deferred.fail(
              entry.deferred,
              new IpcMessageTimeoutError({ channel: entry.channel, timeoutMillis }),
            ),
          { discard: true },
        ),
      ),
      Effect.asVoid,
    ),
  );

  return {
    enqueue,
    connectionState: Ref.get(stateRef).pipe(Effect.map((state) => state.connection)),
    setConnectionState,
    subscribe,
    size: Ref.get(stateRef).pipe(Effect.map((state) => state.queued.length)),
  } satisfies DesktopIpcMessageQueueShape;
});
