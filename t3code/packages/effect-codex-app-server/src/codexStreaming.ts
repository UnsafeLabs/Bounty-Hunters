/**
 * Codex Streaming - Effect.Stream-based streaming support for Codex integration.
 *
 * Provides streaming responses for long-running code generation tasks with:
 * - Backpressure handling (pauses when consumer is slower)
 * - Per-chunk timeouts (30s warning, 120s failure)
 * - Abort signal for cancellation
 * - Chunk ordering guarantees
 * - Memory-bounded buffering
 *
 * @module codexStreaming
 */
import * as Chunk from "effect/Chunk";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

export const CHUNK_WARNING_TIMEOUT_MS = 30_000; // 30 seconds
export const CHUNK_FAILURE_TIMEOUT_MS = 120_000; // 120 seconds
export const DEFAULT_BUFFER_SIZE = 16; // Bounded buffer for backpressure

export interface StreamChunk<A> {
  readonly data: A;
  readonly index: number;
  readonly timestamp: number;
}

export interface StreamWarning {
  readonly chunkIndex: number;
  readonly elapsedMs: number;
  readonly message: string;
}

export interface StreamError {
  readonly _tag: "StreamError";
  readonly cause: "timeout" | "abort" | "producer_error" | "consumer_error";
  readonly message: string;
  readonly chunkIndex?: number;
}

export const StreamError = (
  cause: StreamError["cause"],
  message: string,
  chunkIndex?: number,
): StreamError => ({
  _tag: "StreamError",
  cause,
  message,
  chunkIndex,
});

export interface StreamController<A> {
  readonly emit: (chunk: A) => Effect.Effect<void, StreamError>;
  readonly abort: (reason?: string) => Effect.Effect<void, never>;
  readonly isAborted: Effect.Effect<boolean, never>;
  readonly waitForCompletion: Effect.Effect<void, StreamError>;
}

export interface StreamingOptions {
  readonly bufferSize?: number;
  readonly chunkWarningTimeoutMs?: number;
  readonly chunkFailureTimeoutMs?: number;
  readonly onWarning?: (warning: StreamWarning) => Effect.Effect<void, never>;
}

/**
 * Create a streaming channel with backpressure and timeout handling.
 */
export const makeStreamingChannel = <A>(
  options: StreamingOptions = {},
): Effect.Effect<
  {
    readonly stream: Stream.Stream<StreamChunk<A>, StreamError>;
    readonly controller: StreamController<A>;
  },
  never
> =>
  Effect.gen(function* () {
    const bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
    const warningTimeout = options.chunkWarningTimeoutMs ?? CHUNK_WARNING_TIMEOUT_MS;
    const failureTimeout = options.chunkFailureTimeoutMs ?? CHUNK_FAILURE_TIMEOUT_MS;

    const queue = yield* Queue.bounded<Exit.Exit<StreamChunk<A>, StreamError>>(bufferSize);
    const abortedRef = yield* Ref.make(false);
    const abortReasonRef = yield* Ref.make<Option.Option<string>>(Option.none());
    const chunkIndexRef = yield* Ref.make(0);
    const lastChunkTimeRef = yield* Ref.make(Date.now());
    const completionDeferred = yield* Deferred.make<void, StreamError>();

    const checkTimeout = Effect.gen(function* () {
      const lastTime = yield* Ref.get(lastChunkTimeRef);
      const now = Date.now();
      const elapsed = now - lastTime;
      const currentIndex = yield* Ref.get(chunkIndexRef);

      if (elapsed >= failureTimeout) {
        const error = StreamError(
          "timeout",
          `No chunk received for ${failureTimeout}ms (last chunk: ${currentIndex})`,
          currentIndex,
        );
        yield* Deferred.fail(completionDeferred, error);
        yield* Queue.shutdown(queue);
        return yield* Effect.fail(error);
      }

      if (elapsed >= warningTimeout) {
        const warning: StreamWarning = {
          chunkIndex: currentIndex,
          elapsedMs: elapsed,
          message: `No chunk received for ${elapsed}ms (warning threshold: ${warningTimeout}ms)`,
        };
        yield* options.onWarning?.(warning) ?? Effect.void;
      }

      return yield* Effect.void;
    });

    const timeoutChecker = Effect.forever(
      Effect.sleep(1000).pipe(
        Effect.andThen(checkTimeout),
        Effect.catchAll(() => Effect.void),
      ),
    );

    yield* Effect.forkScoped(timeoutChecker);

    const emit = (chunk: A): Effect.Effect<void, StreamError> =>
      Effect.gen(function* () {
        const isAborted = yield* Ref.get(abortedRef);
        if (isAborted) {
          const reason = yield* Ref.get(abortReasonRef);
          return yield* Effect.fail(
            StreamError("abort", Option.getOrElse(reason, () => "Stream aborted")),
          );
        }

        const index = yield* Ref.getAndUpdate(chunkIndexRef, (n) => n + 1);
        const streamChunk: StreamChunk<A> = {
          data: chunk,
          index,
          timestamp: Date.now(),
        };

        yield* Ref.set(lastChunkTimeRef, Date.now());
        yield* Queue.offer(queue, Exit.succeed(streamChunk));
      });

    const abort = (reason?: string): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        yield* Ref.set(abortedRef, true);
        yield* Ref.set(abortReasonRef, Option.fromNullable(reason));
        const error = StreamError("abort", reason ?? "Stream aborted by user");
        yield* Queue.offer(queue, Exit.fail(error));
        yield* Deferred.fail(completionDeferred, error).pipe(Effect.ignore);
      });

    const isAborted = Ref.get(abortedRef);

    const waitForCompletion = Deferred.await(completionDeferred);

    const stream = Stream.fromQueue(queue).pipe(
      Stream.mapWhile((exit) => Exit.isSuccess(exit)),
      Stream.map((exit) => exit as Exit.Exit<StreamChunk<A>, StreamError>),
      Stream.mapEffect((exit) =>
        Exit.match(exit, {
          onFailure: (error) => Effect.fail(error),
          onSuccess: (chunk) => Effect.succeed(chunk),
        }),
      ),
      Stream.ensuring(
        Effect.gen(function* () {
          const isAbortedValue = yield* Ref.get(abortedRef);
          if (!isAbortedValue) {
            yield* Deferred.succeed(completionDeferred, void 0).pipe(Effect.ignore);
          }
        }),
      ),
    );

    const controller: StreamController<A> = {
      emit,
      abort,
      isAborted,
      waitForCompletion,
    };

    return { stream, controller };
  });

/**
 * Create a streaming wrapper around a producer function.
 */
export const fromProducer = <A, E>(
  producer: (controller: StreamController<A>) => Effect.Effect<void, E>,
  options: StreamingOptions = {},
): Stream.Stream<StreamChunk<A>, StreamError | E> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const { stream, controller } = yield* makeStreamingChannel<A>(options);

      yield* Effect.forkScoped(
        producer(controller).pipe(
          Effect.catchAll((error) =>
            controller.abort(`Producer error: ${String(error)}`),
          ),
        ),
      );

      return stream;
    }),
  );

/**
 * Collect all chunks from a stream into an array.
 */
export const collectChunks = <A, E>(
  stream: Stream.Stream<StreamChunk<A>, E>,
): Effect.Effect<ReadonlyArray<A>, E> =>
  stream.pipe(
    Stream.runCollect,
    Effect.map((chunk) => Chunk.toReadonlyArray(chunk).map((c) => c.data)),
  );

/**
 * Create a stream with automatic abort on scope close.
 */
export const scoped = <A>(
  options: StreamingOptions = {},
): Effect.Effect<
  {
    readonly stream: Stream.Stream<StreamChunk<A>, StreamError>;
    readonly controller: StreamController<A>;
  },
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const result = yield* makeStreamingChannel<A>(options);

    yield* Effect.addFinalizer(() =>
      result.controller.abort("Scope closed").pipe(Effect.ignore),
    );

    return result;
  });

import * as Scope from "effect/Scope";
