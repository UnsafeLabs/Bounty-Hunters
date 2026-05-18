import { Effect, Stream, Schedule, Schema, Queue } from "effect";

export const CodexChunk = Schema.Struct({
  type: Schema.Union(
    Schema.Literal("text_delta"),
    Schema.Literal("code_delta"),
    Schema.Literal("tool_call"),
    Schema.Literal("done")
  ),
  content: Schema.String,
  index: Schema.Number,
});

export type CodexChunkType = Schema.Schema.Type<typeof CodexChunk>;

export interface BackpressureConfig {
  highWaterMark: number;
  strategy: "drop-newest" | "drop-oldest" | "error";
}

export const CodexStreamService = Effect.gen(function* (_) {
  const chunkQueue = yield* _(Queue.bounded<CodexChunkType>(1000));
  const backpressureRef = yield* _(Effect.makeRef({ currentSize: 0, dropped: 0 }));

  const handleBackpressure = (config: BackpressureConfig) =>
    Effect.gen(function* (_) {
      const { currentSize } = yield* _(Effect.getRef(backpressureRef));

      if (currentSize >= config.highWaterMark) {
        switch (config.strategy) {
          case "drop-newest":
            // Drop incoming chunk
            yield* _(Effect.updateRef(backpressureRef, (s) => ({
              ...s,
              dropped: s.dropped + 1,
            })));
            return false; // Don't enqueue

          case "drop-oldest":
            // Drop oldest from queue
            yield* _(Queue.take(chunkQueue));
            break;

          case "error":
            return yield* _(Effect.fail(new Error("Backpressure: queue full")));
        }
      }
      return true;
    });

  const streamFromResponse = (
    response: ReadableStream<Uint8Array>,
    bpConfig: BackpressureConfig = { highWaterMark: 800, strategy: "drop-oldest" }
  ) =>
    Stream.async<CodexChunkType, Error>((emit) => {
      const reader = response.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let chunkIndex = 0;

      const processChunk = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              // Flush remaining buffer
              if (buffer.trim()) {
                const chunk = Schema.decodeUnknownSync(CodexChunk)({
                  type: "text_delta",
                  content: buffer,
                  index: chunkIndex,
                });
                emit.single(chunk);
              }
              emit.end();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6).trim();
                if (data === "[DONE]") {
                  emit.single(
                    Schema.decodeUnknownSync(CodexChunk)({
                      type: "done",
                      content: "",
                      index: chunkIndex++,
                    })
                  );
                  emit.end();
                  return;
                }

                try {
                  const parsed = JSON.parse(data);
                  const chunk = Schema.decodeUnknownSync(CodexChunk)({
                    ...parsed,
                    index: chunkIndex++,
                  });

                  // Apply backpressure
                  Effect.runSync(
                    Effect.gen(function* (_) {
                      const shouldEnqueue = yield* _(handleBackpressure(bpConfig));
                      if (shouldEnqueue) {
                        yield* _(Queue.offer(chunkQueue, chunk));
                        yield* _(Effect.updateRef(backpressureRef, (s) => ({
                          ...s,
                          currentSize: s.currentSize + 1,
                        })));
                      }
                    })
                  );

                  emit.single(chunk);
                } catch {
                  // Skip malformed JSON chunks
                }
              }
            }
          }
        } catch (err) {
          emit.fail(err instanceof Error ? err : new Error(String(err)));
        }
      };

      processChunk();
    }).pipe(Stream.retry(Schedule.exponential("100 millis", 2.0)));

  const consumeStream = Stream.fromQueue(chunkQueue);

  const getBackpressureStats = Effect.getRef(backpressureRef);

  return { streamFromResponse, consumeStream, getBackpressureStats };
});
