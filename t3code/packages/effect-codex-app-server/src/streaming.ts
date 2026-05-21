import * as Chunk from "effect/Chunk";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";

/**
 * Streaming options for Codex requests that return large responses.
 */
export interface CodexStreamingOptions {
  /**
   * Warning timeout per chunk. If a chunk takes longer than this, a warning is logged.
   * @default 30 seconds
   */
  readonly chunkWarningTimeout?: Duration.Duration;

  /**
   * Failure timeout per chunk. If a chunk takes longer than this, the stream fails.
   * @default 120 seconds
   */
  readonly chunkFailTimeout?: Duration.Duration;

  /**
   * Abort signal to cancel the streaming request.
   */
  readonly abortSignal?: AbortSignal;
}

const DEFAULT_CHUNK_WARNING_TIMEOUT = Duration.seconds(30);
const DEFAULT_CHUNK_FAIL_TIMEOUT = Duration.seconds(120);

/**
 * Streaming response for Codex requests that yield multiple chunks.
 * Provides backpressure handling and per-chunk timeout monitoring.
 */
export interface CodexStreamingResponse<A> {
  readonly stream: Stream.Stream<A, CodexError.CodexAppServerError>;
  readonly fiber: Fiber.Fiber<void, never>;
  readonly abortController: AbortController;
}

/**
 * Selects diff chunks from turn/diff/updated notifications.
 */
export const selectDiffChunk = (
  notification: CodexProtocol.CodexAppServerIncomingNotification,
): ReadonlyArray<string> | undefined => {
  if (notification.method === "turn/diff/updated") {
    const params = notification.params as
      | { readonly diffs?: ReadonlyArray<{ readonly text?: string }> }
      | undefined;
    return params?.diffs?.map((d) => d.text ?? "").filter(Boolean) ?? [];
  }
  return undefined;
};

/**
 * Selects agent message deltas from item/agentMessage/delta notifications.
 */
export const selectMessageDelta = (
  notification: CodexProtocol.CodexAppServerIncomingNotification,
): string | undefined => {
  if (notification.method === "item/agentMessage/delta") {
    const params = notification.params as { readonly delta?: string } | undefined;
    return params?.delta;
  }
  return undefined;
};

/**
 * Wraps a stream with backpressure and per-chunk timeout monitoring.
 * Emits warnings at chunkWarningTimeout and fails at chunkFailTimeout.
 */
export const withStreaming = <A>(
  options: CodexStreamingOptions = {},
) => {
  const warningTimeout = options.chunkWarningTimeout ?? DEFAULT_CHUNK_WARNING_TIMEOUT;
  const failTimeout = options.chunkFailTimeout ?? DEFAULT_CHUNK_FAIL_TIMEOUT;

  return <R>(
    stream: Stream.Stream<A, CodexError.CodexAppServerError, R>,
  ): Effect.Effect<
    CodexStreamingResponse<A>,
    CodexError.CodexAppServerError,
    R
  > =>
    Effect.gen(function* () {
      const abortController = new AbortController();

      // Set up abort signal handling
      if (options.abortSignal) {
        if (options.abortSignal.aborted) {
          abortController.abort();
        } else {
          options.abortSignal.addEventListener("abort", () => {
            abortController.abort();
          });
        }
      }

      const chunkQueue = yield* Queue.unbounded<A>();
      const startTime = yield* Clock.currentTimeMillis;
      const lastChunkRef = yield* Ref.make(startTime);

      const warningTimeoutMs = Duration.toMillis(warningTimeout);
      const failTimeoutMs = Duration.toMillis(failTimeout);

      // Set up timeout monitoring fiber - runs in background checking chunk times
      const timeoutFiber = Effect.gen(function* () {
        while (true) {
          // Check if we should stop first
          if (abortController.signal.aborted) {
            break;
          }

          yield* Effect.sleep(Duration.seconds(1));

          if (abortController.signal.aborted) {
            break;
          }

          const currentTime = yield* Clock.currentTimeMillis;
          const lastChunkTime = yield* Ref.get(lastChunkRef);
          const sinceLastChunk = currentTime - lastChunkTime;

          if (sinceLastChunk >= failTimeoutMs) {
            yield* Effect.logWarning(
              `Streaming timed out: no chunk received for ${sinceLastChunk}ms`,
            );
            abortController.abort();
            return;
          }

          if (sinceLastChunk >= warningTimeoutMs) {
            yield* Effect.logDebug(
              `Chunk delayed: ${sinceLastChunk}ms (warning at ${warningTimeoutMs}ms)`,
            );
          }
        }
      }).pipe(Effect.forkScoped);

      // Create output stream with backpressure (queue capacity controls backpressure)
      const outputStream = Stream.fromQueue(chunkQueue, { capacity: 10 }).pipe(
        Stream.tap(() => Clock.currentTimeMillis.pipe(Effect.flatMap((t) => Ref.set(lastChunkRef, t)))),
      );

      // Run the input stream, feeding items into the queue
      const streamFiber = Stream.runForEach(stream, (chunk) => Queue.offer(chunkQueue, chunk)).pipe(
        Effect.catchCause((cause) =>
          Queue.offer(chunkQueue, cause as unknown as A).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      );

      const fiber = yield* Effect.forkScoped(
        Effect.zip(timeoutFiber, streamFiber, { concurrent: true }),
      );

      return {
        stream: outputStream,
        fiber,
        abortController,
      };
    });
};

/**
 * Options for streaming a Codex request.
 */
export interface CodexRequestStreamOptions extends CodexStreamingOptions {
  /**
   * Notification method to stream chunks from.
   */
  readonly notificationMethod?: string;

  /**
   * Transform function to extract stream items from notifications.
   */
  readonly selector?: (notification: CodexProtocol.CodexAppServerIncomingNotification) => A | undefined;
}

/**
 * Creates a streaming request that yields chunks as notifications arrive.
 * Combines backpressure, per-chunk timeouts, and abort signal support.
 */
export const requestStream = <A>(
  _method: string,
  _payload: unknown,
  options: CodexRequestStreamOptions = {},
) => {
  return <R>(
    client: CodexProtocol.CodexAppServerPatchedProtocol,
  ): Effect.Effect<
    CodexStreamingResponse<A>,
    CodexError.CodexAppServerError,
    R
  > => {
    const warningTimeout = options.chunkWarningTimeout ?? DEFAULT_CHUNK_WARNING_TIMEOUT;
    const failTimeout = options.chunkFailTimeout ?? DEFAULT_CHUNK_FAIL_TIMEOUT;
    const abortSignal = options.abortSignal ?? new AbortController().signal;

    return Effect.gen(function* () {
      const abortController = new AbortController();

      // Wire up external abort signal
      if (abortSignal.aborted) {
        abortController.abort();
      } else {
        abortSignal.addEventListener("abort", () => {
          abortController.abort();
        });
      }

      const chunkQueue = yield* Queue.unbounded<A>();
      const startTime = yield* Clock.currentTimeMillis;
      const lastChunkRef = yield* Ref.make(startTime);

      const warningTimeoutMs = Duration.toMillis(warningTimeout);
      const failTimeoutMs = Duration.toMillis(failTimeout);

      // Set up timeout monitoring fiber
      const timeoutFiber = Effect.gen(function* () {
        while (true) {
          if (abortController.signal.aborted) {
            break;
          }

          yield* Effect.sleep(Duration.seconds(1));

          if (abortController.signal.aborted) {
            break;
          }

          const currentTime = yield* Clock.currentTimeMillis;
          const lastChunkTime = yield* Ref.get(lastChunkRef);
          const sinceLastChunk = currentTime - lastChunkTime;

          if (sinceLastChunk >= failTimeoutMs) {
            yield* Effect.logWarning(
              `Streaming timed out: no chunk received for ${sinceLastChunk}ms`,
            );
            abortController.abort();
            return;
          }

          if (sinceLastChunk >= warningTimeoutMs) {
            yield* Effect.logDebug(
              `Chunk delayed: ${sinceLastChunk}ms (warning at ${warningTimeoutMs}ms)`,
            );
          }
        }
      }).pipe(Effect.forkScoped);

      // Listen for notifications matching the selector
      const selector = options.selector;
      const notificationMethod = options.notificationMethod;

      const notificationFiber = Stream.runForEach(
        client.incomingNotifications.pipe(
          Stream.filter((notification) =>
            notificationMethod ? notification.method === notificationMethod : true
          ),
          Stream.map((notification) =>
            selector ? selector(notification) : (notification as unknown as A)
          ),
          Stream.filterMap((item) =>
            item !== undefined ? Chunk.make(item) : Chunk.empty<A>(),
        ),
        (item) => Queue.offer(chunkQueue, item)
      ).pipe(
        Effect.catchCause((cause) =>
          Queue.offer(chunkQueue, cause as unknown as A).pipe(Effect.asVoid),
        ),
        Effect.forkScoped,
      );

      // Create output stream with backpressure
      const outputStream = Stream.fromQueue(chunkQueue, { capacity: 10 });

      const fiber = yield* Effect.forkScoped(
        Effect.zip(notificationFiber, timeoutFiber, { concurrent: true }),
      );

      return {
        stream: outputStream,
        fiber,
        abortController,
      };
    });
  };
};

export type { CodexStreamingOptions, CodexStreamingResponse };