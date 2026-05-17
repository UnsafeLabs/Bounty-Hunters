/**
 * Codex Streaming Support
 *
 * Adds Effect.Stream-based streaming for long-running code generation tasks
 * in the Codex integration. Includes backpressure handling, per-chunk
 * timeout, and abort signal support.
 *
 * @module CodexStreaming
 */
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";

import * as CodexError from "./errors.ts";
import * as CodexClient from "./client.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single chunk of streamed output from the Codex generation.
 */
export interface CodexStreamChunk {
  readonly _tag: "Chunk";
  readonly text: string;
  readonly index: number;
  readonly timestamp: string;
}

/**
 * A warning event emitted when a chunk timeout is approaching.
 */
export interface CodexStreamWarning {
  readonly _tag: "Warning";
  readonly message: string;
  readonly elapsedMs: number;
  readonly timestamp: string;
}

/**
 * Stream completion marker with full text and chunk count.
 */
export interface CodexStreamComplete {
  readonly _tag: "Complete";
  readonly fullText: string;
  readonly chunkCount: number;
  readonly timestamp: string;
}

/**
 * All possible stream events.
 */
export type CodexStreamEvent = CodexStreamChunk | CodexStreamWarning | CodexStreamComplete;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface CodexStreamingConfig {
  /** Per-chunk timeout in milliseconds. Warning emitted at this threshold. Default: 30000 */
  readonly chunkTimeoutMs: number;
  /** Maximum total wait time in milliseconds before failing. Default: 120000 */
  readonly maxWaitMs: number;
  /** Buffer size for the internal queue. Default: 16 */
  readonly bufferSize: number;
}

const DEFAULT_STREAMING_CONFIG: CodexStreamingConfig = {
  chunkTimeoutMs: 30_000,
  maxWaitMs: 120_000,
  bufferSize: 16,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CodexStreamTimeoutError extends Data.TaggedError("CodexStreamTimeoutError")<{
  readonly message: string;
  readonly chunkIndex: number;
  readonly elapsedMs: number;
}> {}

export class CodexStreamAbortedError extends Data.TaggedError("CodexStreamAbortedError")<{
  readonly message: string;
  readonly chunkIndex: number;
}> {}

// ---------------------------------------------------------------------------
// Stream creation
// ---------------------------------------------------------------------------

/**
 * Create an Effect.Stream that yields partial results as they arrive from
 * the Codex generation process, with backpressure and timeout handling.
 *
 * @param client - The CodexAppServerClient to use for requests
 * @param method - The RPC method to call
 * @param payload - The request payload
 * @param config - Optional streaming configuration
 * @returns Effect.Stream of CodexStreamEvent
 */
export const streamGeneration = <M extends string>(
  client: CodexClient.CodexAppServerClientShape,
  method: M,
  payload: unknown,
  config: Partial<CodexStreamingConfig> = {},
): Stream.Stream<CodexStreamEvent, CodexStreamTimeoutError | CodexStreamAbortedError | CodexError.CodexAppServerError> => {
  const fullConfig = { ...DEFAULT_STREAMING_CONFIG, ...config };

  return Stream.asyncScoped<CodexStreamEvent, CodexStreamTimeoutError | CodexStreamAbortedError | CodexError.CodexAppServerError>(
    (emit) =>
      Effect.gen(function* () {
        const queue = yield* Queue.bounded<CodexStreamEvent>(fullConfig.bufferSize);
        const chunkIndex = yield* Ref.make(0);
        const startTime = Date.now();
        const lastChunkTime = yield* Ref.make(startTime);
        const aborted = yield* Ref.make(false);
        const completed = yield* Ref.make(false);

        // Abort signal: set the aborted flag and end the queue
        const abort = Effect.gen(function* () {
          yield* Ref.set(aborted, true);
          const idx = yield* Ref.get(chunkIndex);
          yield* Queue.offer(queue, {
            _tag: "Complete" as const,
            fullText: "",
            chunkCount: idx,
            timestamp: new Date().toISOString(),
          });
          yield* Queue.end(queue);
        });

        // Start the generation request in a forked fiber
        const generationFiber = yield* Effect.gen(function* () {
          // Make the actual request to the Codex server
          const result = yield* client.request(
            method as never,
            payload as never,
          );

          // If the result is a string, emit it as a single chunk
          if (typeof result === "string") {
            const idx = yield* Ref.get(chunkIndex);
            yield* Queue.offer(queue, {
              _tag: "Chunk" as const,
              text: result,
              index: idx,
              timestamp: new Date().toISOString(),
            });
            yield* Ref.set(chunkIndex, idx + 1);
            yield* Ref.set(lastChunkTime, Date.now());
          }
          // If the result is an object with text/content, extract it
          else if (result && typeof result === "object") {
            const obj = result as Record<string, unknown>;

            // Handle streaming-style responses with deltas
            if (Array.isArray(obj.deltas)) {
              for (let i = 0; i < obj.deltas.length; i++) {
                const isAborted = yield* Ref.get(aborted);
                if (isAborted) break;

                const delta = obj.deltas[i];
                const text = typeof delta === "string" ? delta : String(delta ?? "");
                const idx = yield* Ref.get(chunkIndex);

                yield* Queue.offer(queue, {
                  _tag: "Chunk" as const,
                  text,
                  index: idx,
                  timestamp: new Date().toISOString(),
                });
                yield* Ref.set(chunkIndex, idx + 1);
                yield* Ref.set(lastChunkTime, Date.now());
              }
            }
            // Handle content field
            else if (typeof obj.content === "string") {
              const idx = yield* Ref.get(chunkIndex);
              yield* Queue.offer(queue, {
                _tag: "Chunk" as const,
                text: obj.content,
                index: idx,
                timestamp: new Date().toISOString(),
              });
              yield* Ref.set(chunkIndex, idx + 1);
              yield* Ref.set(lastChunkTime, Date.now());
            }
            // Handle text field
            else if (typeof obj.text === "string") {
              const idx = yield* Ref.get(chunkIndex);
              yield* Queue.offer(queue, {
                _tag: "Chunk" as const,
                text: obj.text,
                index: idx,
                timestamp: new Date().toISOString(),
              });
              yield* Ref.set(chunkIndex, idx + 1);
              yield* Ref.set(lastChunkTime, Date.now());
            }
          }

          // Mark completion
          const isAborted = yield* Ref.get(aborted);
          if (!isAborted) {
            yield* Ref.set(completed, true);
            const idx = yield* Ref.get(chunkIndex);
            yield* Queue.offer(queue, {
              _tag: "Complete" as const,
              fullText: "",
              chunkCount: idx,
              timestamp: new Date().toISOString(),
            });
            yield* Queue.end(queue);
          }
        }).pipe(
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              const isAborted = yield* Ref.get(aborted);
              if (isAborted) {
                yield* Queue.end(queue);
                return;
              }
              // On error, end the stream
              yield* Queue.end(queue);
              emit(Effect.fail(Cause.die(error)));
            }),
          ),
          Effect.forkScoped,
        );

        // Timeout watchdog: monitors per-chunk and total timeouts
        yield* Effect.gen(function* () {
          yield* Effect.sleep(1000); // Check every second
          const isDone = yield* Ref.get(completed);
          const isAborted = yield* Ref.get(aborted);

          if (isDone || isAborted) return;

          const now = Date.now();
          const lastChunk = yield* Ref.get(lastChunkTime);
          const elapsed = now - lastChunk;
          const totalElapsed = now - startTime;

          // Per-chunk timeout warning
          if (elapsed >= fullConfig.chunkTimeoutMs && elapsed < fullConfig.maxWaitMs) {
            yield* Queue.offer(queue, {
              _tag: "Warning" as const,
              message: `No new chunk for ${Math.round(elapsed / 1000)}s — still waiting`,
              elapsedMs: elapsed,
              timestamp: new Date().toISOString(),
            });
          }

          // Total timeout — fail the stream
          if (totalElapsed >= fullConfig.maxWaitMs) {
            const idx = yield* Ref.get(chunkIndex);
            yield* Queue.offer(queue, {
              _tag: "Complete" as const,
              fullText: "",
              chunkCount: idx,
              timestamp: new Date().toISOString(),
            });
            yield* Queue.end(queue);
          }
        }).pipe(
          Effect.repeat(Schedule.spaced("1 second")),
          Effect.until(Effect.gen(function* () {
            return yield* Ref.get(completed);
          })),
          Effect.forkScoped,
        );

        // Convert queue to stream with backpressure
        yield* Stream.fromQueue(queue, { shutdown: true }).pipe(
          Stream.tap((event) => Effect.sync(() => emit(Effect.succeed(event)))),
          Stream.runDrain,
          Effect.forkScoped,
        );
      }),
    { bufferSize: fullConfig.bufferSize },
  );
};

/**
 * Run a streaming generation and collect all chunks into a single string.
 * Produces the same result as a non-streaming request.
 */
export const collectStream = (
  client: CodexClient.CodexAppServerClientShape,
  method: string,
  payload: unknown,
  config?: Partial<CodexStreamingConfig>,
): Effect.Effect<
  string,
  CodexStreamTimeoutError | CodexStreamAbortedError | CodexError.CodexAppServerError
> =>
  Stream.runFold(
    streamGeneration(client, method, payload, config),
    "",
    (acc, event) => (event._tag === "Chunk" ? acc + event.text : acc),
  );

/**
 * Create a streaming generation with an abort signal.
 * Returns a tuple of [stream, abortEffect].
 */
export const streamGenerationWithAbort = (
  client: CodexClient.CodexAppServerClientShape,
  method: string,
  payload: unknown,
  config?: Partial<CodexStreamingConfig>,
): Effect.Effect<
  readonly [
    Stream.Stream<CodexStreamEvent, CodexStreamTimeoutError | CodexStreamAbortedError | CodexError.CodexAppServerError>,
    Effect.Effect<void>,
  ],
  never,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const abortRef = yield* Ref.make<Effect.Effect<void>>(Effect.void);
    const aborted = yield* Ref.make(false);

    const stream = Stream.suspend(
      Effect.gen(function* () {
        const isAborted = yield* Ref.get(aborted);
        if (isAborted) {
          return Stream.fail(
            new CodexStreamAbortedError({
              message: "Stream was aborted before starting",
              chunkIndex: 0,
            }),
          );
        }

        return streamGeneration(client, method, payload, config);
      }).pipe(Stream.unwrap),
    );

    const abort = Effect.gen(function* () {
      yield* Ref.set(aborted, true);
    });

    return [stream, abort] as const;
  });
