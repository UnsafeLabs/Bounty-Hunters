import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as Duration from "effect/Duration";
import * as Fiber from "effect/Fiber";
import * as AbortSignal from "effect/AbortSignal";
import type { AbortController } from "effect/AbortController";

export interface StreamChunk<T> {
  readonly data: T;
  readonly done: boolean;
}

export interface StreamOptions {
  readonly timeoutWarning?: Duration.DurationInput;
  readonly timeoutFailure?: Duration.DurationInput;
  readonly abortSignal?: AbortSignal.AbortSignal;
}

export interface StreamingResponse {
  readonly id: string;
  readonly choices: ReadonlyArray<{
    readonly index: number;
    readonly delta: {
      readonly content?: string;
    };
    readonly finish_reason: string | null;
  }>;
}

export class StreamTimeoutWarning extends Effect.TaggedError<StreamTimeoutWarning>()(
  "StreamTimeoutWarning",
  {
    elapsed: Effect.Data<number>,
    timeout: Effect.Data<number>,
  }
) {}

export class StreamTimeoutFailure extends Effect.TaggedError<StreamTimeoutFailure>()(
  "StreamTimeoutFailure",
  {
    elapsed: Effect.Data<number>,
    timeout: Effect.Data<number>,
  }
) {}

export const makeStream = <T>(
  generator: () => AsyncIterable<T>,
  options?: StreamOptions
) =>
  Stream.async<T, StreamTimeoutWarning | StreamTimeoutFailure>(emit => {
    const timeoutWarning = options?.timeoutWarning 
      ? Duration.toMillis(Duration.decode(options.timeoutWarning))
      : 30_000;
    const timeoutFailure = options?.timeoutFailure 
      ? Duration.toMillis(Duration.decode(options.timeoutFailure))
      : 120_000;
    
    const iterator = generator()[Symbol.asyncIterator]();
    let timeout: number | null = null;
    let elapsed = 0;

    const resetTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        elapsed += timeoutWarning;
        if (elapsed >= timeoutFailure) {
          emit.fail(new StreamTimeoutFailure({ elapsed, timeout: timeoutFailure }));
        } else {
          emit.fail(new StreamTimeoutWarning({ elapsed, timeout: timeoutWarning }));
        }
      }, timeoutWarning) as any;
    };

    // Clear existing timeout and set new one
    resetTimeout();

    const poll = async () => {
      try {
        const { value, done } = await iterator.next();
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        
        if (done) {
          emit.end();
          return;
        }

        emit.single(value);
        resetTimeout();
        setImmediate(poll);
      } catch (error) {
        emit.fail(error);
      }
    };

    // Start polling
    poll().catch(error => emit.fail(error));

    // Handle abort signal
    options?.abortSignal?.addEventListener("abort", () => {
      iterator.return?.();
      if (timeout) clearTimeout(timeout);
      emit.end();
    });

    return Effect.sync(() => {
      iterator.return?.();
      if (timeout) clearTimeout(timeout);
    });
  }).pipe(
    // Add backpressure handling
    Stream.buffer({
      capacity: 10,
      strategy: "dropping"
    })
  );

export const streamCodexResponse = (
  request: any,
  options?: StreamOptions
) => 
  makeStream(async function* () {
    // This would integrate with the actual Codex SDK
    // For now, this is a placeholder that demonstrates the pattern
    yield* generateCodexResponse(request);
  }, options);

// Placeholder for actual Codex integration
const generateCodexResponse = async function* (_request: any) {
  // In a real implementation, this would call the Codex API
  // and yield partial results as they arrive
  yield "[PARTIAL]" as any;
  yield "[COMPLETE]" as any;
};