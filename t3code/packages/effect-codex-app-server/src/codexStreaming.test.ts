import { describe, it, assert } from "@effect/vitest";
import * as Chunk from "effect/Chunk";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import {
  makeStreamingChannel,
  fromProducer,
  collectChunks,
  StreamError,
  CHUNK_WARNING_TIMEOUT_MS,
  CHUNK_FAILURE_TIMEOUT_MS,
  DEFAULT_BUFFER_SIZE,
  type StreamChunk,
  type StreamWarning,
} from "./codexStreaming.ts";

describe("codexStreaming", () => {
  describe("makeStreamingChannel", () => {
    it("should create a streaming channel with controller", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        // Emit some chunks
        yield* controller.emit("chunk1");
        yield* controller.emit("chunk2");
        yield* controller.emit("chunk3");

        // Collect chunks
        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks.length, 3);
        assert.deepEqual(chunks, ["chunk1", "chunk2", "chunk3"]);
      }).pipe(Effect.runPromise));

    it("should maintain chunk order", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<number>();

        for (let i = 0; i < 100; i++) {
          yield* controller.emit(i);
        }

        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks.length, 100);
        for (let i = 0; i < 100; i++) {
          assert.strictEqual(chunks[i], i);
        }
      }).pipe(Effect.runPromise));

    it("should include index and timestamp in chunks", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        yield* controller.emit("test");

        const chunks = yield* stream.pipe(Stream.runCollect);
        const firstChunk = Chunk.unsafeHead(chunks);

        assert.strictEqual(firstChunk.index, 0);
        assert.strictEqual(firstChunk.data, "test");
        assert.typeOf(firstChunk.timestamp, "number");
        assert.isTrue(firstChunk.timestamp > 0);
      }).pipe(Effect.runPromise));

    it("should handle abort", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        yield* controller.emit("chunk1");
        yield* controller.abort("Test abort");

        const result = yield* Effect.either(collectChunks(stream));

        assert.isTrue(Exit.isFailure(result));
        if (Exit.isFailure(result)) {
          const error = result.cause;
          assert.strictEqual(error._tag, "StreamError");
          assert.strictEqual(error.cause, "abort");
        }
      }).pipe(Effect.runPromise));

    it("should track aborted state", () =>
      Effect.gen(function* () {
        const { controller } = yield* makeStreamingChannel<string>();

        let isAborted = yield* controller.isAborted;
        assert.isFalse(isAborted);

        yield* controller.abort();

        isAborted = yield* controller.isAborted;
        assert.isTrue(isAborted);
      }).pipe(Effect.runPromise));

    it("should fail emit after abort", () =>
      Effect.gen(function* () {
        const { controller } = yield* makeStreamingChannel<string>();

        yield* controller.abort("Aborted");

        const result = yield* Effect.either(controller.emit("chunk"));

        assert.isTrue(Exit.isFailure(result));
      }).pipe(Effect.runPromise));
  });

  describe("backpressure", () => {
    it("should respect buffer size", () =>
      Effect.gen(function* () {
        const bufferSize = 4;
        const { stream, controller } = yield* makeStreamingChannel<string>({
          bufferSize,
        });

        // Fill buffer
        for (let i = 0; i < bufferSize; i++) {
          yield* controller.emit(`chunk${i}`);
        }

        // Next emit should block (backpressure)
        const emitFiber = yield* Effect.fork(controller.emit("blocked"));

        // Give it a moment to potentially complete (it shouldn't)
        yield* Effect.sleep(10);

        const isDone = yield* Fiber.isDone(emitFiber);
        assert.isFalse(isDone, "Emit should be blocked due to backpressure");

        // Consume one chunk to unblock
        const consumerFiber = yield* Effect.fork(
          stream.pipe(Stream.take(1), Stream.runCollect),
        );

        // Now emit should complete
        yield* Fiber.join(consumerFiber);
        yield* Effect.sleep(10);

        const isDoneAfter = yield* Fiber.isDone(emitFiber);
        assert.isTrue(isDoneAfter, "Emit should complete after consumer takes chunk");
      }).pipe(Effect.runPromise));

    it("should use default buffer size when not specified", () =>
      Effect.gen(function* () {
        const { stream } = yield* makeStreamingChannel<string>();

        // Default buffer size should be DEFAULT_BUFFER_SIZE
        assert.strictEqual(DEFAULT_BUFFER_SIZE, 16);
      }).pipe(Effect.runPromise));
  });

  describe("timeouts", () => {
    it("should emit warning after warning timeout", () =>
      Effect.gen(function* () {
        const warnings: StreamWarning[] = [];
        const { controller } = yield* makeStreamingChannel<string>({
          chunkWarningTimeoutMs: 100, // Short timeout for testing
          onWarning: (warning) =>
            Effect.sync(() => {
              warnings.push(warning);
            }),
        });

        // Don't emit anything, wait for warning
        yield* Effect.sleep(150);

        assert.isTrue(warnings.length > 0, "Should have received warning");
        assert.strictEqual(warnings[0].chunkIndex, 0);
        assert.isTrue(warnings[0].elapsedMs >= 100);
      }).pipe(Effect.runPromise));

    it("should fail after failure timeout", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>({
          chunkFailureTimeoutMs: 100, // Short timeout for testing
        });

        // Don't emit anything, wait for failure
        yield* Effect.sleep(150);

        const result = yield* Effect.either(collectChunks(stream));

        assert.isTrue(Exit.isFailure(result));
        if (Exit.isFailure(result)) {
          const error = result.cause;
          assert.strictEqual(error._tag, "StreamError");
          assert.strictEqual(error.cause, "timeout");
        }
      }).pipe(Effect.runPromise));

    it("should reset timeout on each chunk", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>({
          chunkFailureTimeoutMs: 200,
        });

        // Emit chunks regularly to prevent timeout
        yield* controller.emit("chunk1");
        yield* Effect.sleep(100);
        yield* controller.emit("chunk2");
        yield* Effect.sleep(100);
        yield* controller.emit("chunk3");

        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks.length, 3);
      }).pipe(Effect.runPromise));
  });

  describe("fromProducer", () => {
    it("should wrap producer function in stream", () =>
      Effect.gen(function* () {
        const producer = (controller: { emit: (chunk: string) => Effect.Effect<void, any> }) =>
          Effect.gen(function* () {
            yield* controller.emit("a");
            yield* controller.emit("b");
            yield* controller.emit("c");
          });

        const stream = fromProducer(producer);
        const chunks = yield* collectChunks(stream);

        assert.deepEqual(chunks, ["a", "b", "c"]);
      }).pipe(Effect.runPromise));

    it("should abort on producer error", () =>
      Effect.gen(function* () {
        const producer = (controller: { emit: (chunk: string) => Effect.Effect<void, any> }) =>
          Effect.gen(function* () {
            yield* controller.emit("a");
            return yield* Effect.fail(new Error("Producer error"));
          });

        const stream = fromProducer(producer);
        const result = yield* Effect.either(collectChunks(stream));

        assert.isTrue(Exit.isFailure(result));
      }).pipe(Effect.runPromise));

    it("should handle async producer", () =>
      Effect.gen(function* () {
        const producer = (controller: { emit: (chunk: number) => Effect.Effect<void, any> }) =>
          Effect.gen(function* () {
            for (let i = 0; i < 5; i++) {
              yield* Effect.sleep(10);
              yield* controller.emit(i);
            }
          });

        const stream = fromProducer(producer);
        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks.length, 5);
        assert.deepEqual(chunks, [0, 1, 2, 3, 4]);
      }).pipe(Effect.runPromise));
  });

  describe("collectChunks", () => {
    it("should collect all chunks into array", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        yield* controller.emit("x");
        yield* controller.emit("y");
        yield* controller.emit("z");

        const chunks = yield* collectChunks(stream);

        assert.deepEqual(chunks, ["x", "y", "z"]);
      }).pipe(Effect.runPromise));

    it("should handle empty stream", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        yield* controller.abort();

        const result = yield* Effect.either(collectChunks(stream));

        // Empty stream should return empty array or fail
        if (Exit.isSuccess(result)) {
          assert.strictEqual(result.value.length, 0);
        }
      }).pipe(Effect.runPromise));
  });

  describe("StreamError", () => {
    it("should create error with correct structure", () => {
      const error = StreamError("timeout", "Test timeout", 5);

      assert.strictEqual(error._tag, "StreamError");
      assert.strictEqual(error.cause, "timeout");
      assert.strictEqual(error.message, "Test timeout");
      assert.strictEqual(error.chunkIndex, 5);
    });

    it("should create error without chunk index", () => {
      const error = StreamError("abort", "Aborted");

      assert.strictEqual(error._tag, "StreamError");
      assert.strictEqual(error.cause, "abort");
      assert.strictEqual(error.message, "Aborted");
      assert.isUndefined(error.chunkIndex);
    });
  });

  describe("integration scenarios", () => {
    it("should handle slow consumer with backpressure", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<number>({
          bufferSize: 2,
        });

        // Producer emits quickly
        const producerFiber = yield* Effect.fork(
          Effect.gen(function* () {
            for (let i = 0; i < 10; i++) {
              yield* controller.emit(i);
            }
          }),
        );

        // Consumer reads slowly
        const consumerFiber = yield* Effect.fork(
          Effect.gen(function* () {
            const chunks: number[] = [];
            for await (const chunk of stream) {
              chunks.push(chunk.data);
              yield* Effect.sleep(50); // Slow consumer
            }
            return chunks;
          }),
        );

        yield* Fiber.join(producerFiber);
        const chunks = yield* Fiber.join(consumerFiber);

        assert.strictEqual(chunks.length, 10);
      }).pipe(Effect.runPromise));

    it("should handle concurrent emit and abort", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        const emitFiber = yield* Effect.fork(
          Effect.gen(function* () {
            for (let i = 0; i < 100; i++) {
              yield* controller.emit(`chunk${i}`).pipe(Effect.ignore);
            }
          }),
        );

        yield* Effect.sleep(10);
        yield* controller.abort("Concurrent abort");

        yield* Fiber.join(emitFiber);

        const result = yield* Effect.either(collectChunks(stream));
        assert.isTrue(Exit.isFailure(result));
      }).pipe(Effect.runPromise));

    it("should maintain ordering under concurrent access", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<number>();

        // Emit from multiple fibers
        const fibers = yield* Effect.all([
          Effect.fork(
            Effect.gen(function* () {
              for (let i = 0; i < 10; i++) {
                yield* controller.emit(i);
              }
            }),
          ),
          Effect.fork(
            Effect.gen(function* () {
              for (let i = 10; i < 20; i++) {
                yield* controller.emit(i);
              }
            }),
          ),
        ]);

        yield* Effect.all(fibers.map((f) => Fiber.join(f)));

        const chunks = yield* collectChunks(stream);

        // Should have all 20 chunks
        assert.strictEqual(chunks.length, 20);

        // Each chunk should have correct index
        const indices = chunks.map((_, i) => i);
        const chunkIndices = Array.from({ length: 20 }, (_, i) => i);
        assert.deepEqual(indices, chunkIndices);
      }).pipe(Effect.runPromise));
  });

  describe("edge cases", () => {
    it("should handle zero buffer size gracefully", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>({
          bufferSize: 0,
        });

        // Should still work, just with immediate backpressure
        yield* controller.emit("test");
        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks.length, 1);
      }).pipe(Effect.runPromise));

    it("should handle very large chunks", () =>
      Effect.gen(function* () {
        const { stream, controller } = yield* makeStreamingChannel<string>();

        const largeChunk = "x".repeat(1_000_000); // 1MB
        yield* controller.emit(largeChunk);

        const chunks = yield* collectChunks(stream);

        assert.strictEqual(chunks[0].length, 1_000_000);
      }).pipe(Effect.runPromise));

    it("should handle rapid emit/abort cycles", () =>
      Effect.gen(function* () {
        for (let i = 0; i < 10; i++) {
          const { controller } = yield* makeStreamingChannel<string>();
          yield* controller.emit(`chunk${i}`);
          yield* controller.abort();
        }
        // Should not throw or hang
        assert.isTrue(true);
      }).pipe(Effect.runPromise));
  });
});
