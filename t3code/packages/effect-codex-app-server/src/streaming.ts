/**
 * Effect.Stream-based streaming for Codex integration with backpressure.
 * Handles long-running code generation tasks with flow control.
 */

import { Effect, Stream, Queue, pipe, Chunk } from "effect";

interface StreamConfig {
  /** Buffer size for backpressure (default: 16) */
  bufferSize?: number;
  /** Timeout for idle streams in ms (default: 30000) */
  idleTimeout?: number;
}

interface CodexChunk {
  type: "text" | "code" | "error" | "done";
  content: string;
  timestamp: number;
}

/**
 * Streaming Codex client with Effect.Stream and backpressure.
 */
export class CodexStreamClient {
  private config: Required<StreamConfig>;

  constructor(config: StreamConfig = {}) {
    this.config = {
      bufferSize: config.bufferSize || 16,
      idleTimeout: config.idleTimeout || 30000,
    };
  }

  /**
   * Create a streaming Effect for Codex code generation.
   */
  streamCompletion(
    prompt: string,
    options: { model?: string; maxTokens?: number } = {}
  ): Stream.Stream<CodexChunk, Error> {
    return Stream.asyncPush<CodexChunk, Error>((emit) => {
      const controller = new AbortController();

      // Start streaming request
      this.fetchStream(prompt, options, controller.signal, emit).catch((err) => {
        emit.die(err instanceof Error ? err : new Error(String(err)));
      });

      // Return cleanup function
      return Effect.sync(() => controller.abort());
    }, { bufferSize: this.config.bufferSize });
  }

  /**
   * Fetch streaming response from Codex API.
   */
  private async fetchStream(
    prompt: string,
    options: any,
    signal: AbortSignal,
    emit: Stream.Emit.Emit<CodexChunk, Error>
  ): Promise<void> {
    const response = await fetch("/api/codex/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, ...options, stream: true }),
      signal,
    });

    if (!response.ok) {
      await emit.fail(new Error(`Codex API error: ${response.status}`));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      await emit.fail(new Error("No response body"));
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();
            if (data === "[DONE]") {
              await emit.single({
                type: "done",
                content: "",
                timestamp: Date.now(),
              });
              return;
            }

            try {
              const parsed = JSON.parse(data);
              await emit.single({
                type: parsed.type || "text",
                content: parsed.content || parsed.text || "",
                timestamp: Date.now(),
              });
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Collect stream into a single string.
   */
  collectStream(
    prompt: string,
    options?: { model?: string; maxTokens?: number }
  ): Effect.Effect<string, Error> {
    return pipe(
      this.streamCompletion(prompt, options),
      Stream.filter((chunk) => chunk.type === "text" || chunk.type === "code"),
      Stream.map((chunk) => chunk.content),
      Stream.runCollect,
      Effect.map((chunks) => Chunk.join(chunks, ""))
    );
  }
}
