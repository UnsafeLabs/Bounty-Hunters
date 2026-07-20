/**
 * Streaming Codex generation with backpressure, per-chunk timeout, abort (issue #845).
 */

export const CHUNK_WARN_MS = 30_000;
export const CHUNK_FAIL_MS = 120_000;

export type StreamEvent =
  | { type: "chunk"; index: number; data: string }
  | { type: "warning"; message: string; waitedMs: number }
  | { type: "done"; totalChunks: number }
  | { type: "error"; message: string };

export class StreamTimeoutError extends Error {
  readonly _tag = "StreamTimeoutError" as const;
  waitedMs: number;
  constructor(message: string, waitedMs: number) {
    super(message);
    this.name = "StreamTimeoutError";
    this.waitedMs = waitedMs;
  }
}

export class StreamAbortError extends Error {
  readonly _tag = "StreamAbortError" as const;
  constructor(message = "stream aborted") {
    super(message);
    this.name = "StreamAbortError";
  }
}

export interface CodexStreamOptions {
  /** Max buffered chunks before producer awaits consumer (backpressure). */
  highWaterMark?: number;
  chunkWarnMs?: number;
  chunkFailMs?: number;
  signal?: AbortSignal;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Async queue with backpressure: push waits when size >= highWaterMark.
 */
export class BackpressureQueue<T> {
  private items: T[] = [];
  private waiters: Array<(v: IteratorResult<T>) => void> = [];
  private spaceWaiters: Array<() => void> = [];
  private closed = false;
  private readonly highWaterMark: number;

  constructor(highWaterMark = 16) {
    this.highWaterMark = highWaterMark;
  }

  get size(): number {
    return this.items.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  async push(item: T): Promise<void> {
    if (this.closed) throw new Error("queue closed");
    while (this.items.length >= this.highWaterMark) {
      await new Promise<void>((resolve) => this.spaceWaiters.push(resolve));
      if (this.closed) throw new Error("queue closed");
    }
    if (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      w({ value: item, done: false });
    } else {
      this.items.push(item);
    }
  }

  async pull(): Promise<IteratorResult<T>> {
    if (this.items.length > 0) {
      const value = this.items.shift()!;
      const sw = this.spaceWaiters.shift();
      if (sw) sw();
      return { value, done: false };
    }
    if (this.closed) return { value: undefined as unknown as T, done: true };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    for (const w of this.waiters) w({ value: undefined as unknown as T, done: true });
    this.waiters = [];
    for (const s of this.spaceWaiters) s();
    this.spaceWaiters = [];
  }
}

/**
 * Stream partial results from an async producer with timeouts + abort.
 */
export async function* streamCodexGeneration(
  produce: (emit: (chunk: string) => Promise<void>, signal: AbortSignal) => Promise<void>,
  options: CodexStreamOptions = {},
): AsyncGenerator<StreamEvent, void, unknown> {
  const highWaterMark = options.highWaterMark ?? 8;
  const warnMs = options.chunkWarnMs ?? CHUNK_WARN_MS;
  const failMs = options.chunkFailMs ?? CHUNK_FAIL_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const ac = new AbortController();
  const parent = options.signal;
  if (parent) {
    if (parent.aborted) throw new StreamAbortError();
    parent.addEventListener("abort", () => ac.abort(), { once: true });
  }

  const q = new BackpressureQueue<string>(highWaterMark);
  let producerError: unknown = null;
  let index = 0;
  const seen = new Set<string>();

  const producer = (async () => {
    try {
      await produce(async (chunk) => {
        if (ac.signal.aborted) throw new StreamAbortError();
        await q.push(chunk);
      }, ac.signal);
    } catch (err) {
      producerError = err;
    } finally {
      q.close();
    }
  })();

  let lastChunkAt = now();
  let warned = false;

  try {
    while (true) {
      if (ac.signal.aborted) {
        yield { type: "error", message: "aborted" };
        throw new StreamAbortError();
      }

      const waited = now() - lastChunkAt;
      // Poll with small steps to honor warn/fail deadlines
      const pullPromise = q.pull();
      let result: IteratorResult<string> | null = null;
      while (result === null) {
        const remainingFail = failMs - (now() - lastChunkAt);
        if (remainingFail <= 0) {
          ac.abort();
          throw new StreamTimeoutError("no chunk within fail timeout", failMs);
        }
        const waitedNow = now() - lastChunkAt;
        if (!warned && waitedNow >= warnMs) {
          warned = true;
          yield { type: "warning", message: "chunk delay exceeded warn threshold", waitedMs: waitedNow };
        }
        result = await Promise.race([
          pullPromise.then((r) => r),
          sleep(Math.min(50, Math.max(1, remainingFail))).then(() => null),
        ]);
      }

      if (result.done) break;
      const data = result.value;
      const key = `${index}:${data}`;
      if (seen.has(key)) continue; // no duplicates
      seen.add(key);
      lastChunkAt = now();
      warned = false;
      yield { type: "chunk", index, data };
      index += 1;
    }

    await producer;
    if (producerError) {
      if (producerError instanceof StreamAbortError) throw producerError;
      yield { type: "error", message: String(producerError) };
      throw producerError;
    }
    yield { type: "done", totalChunks: index };
  } finally {
    ac.abort();
    q.close();
  }
}

/** Collect all chunk data in order (parity with non-streaming). */
export async function runCollect(
  produce: (emit: (chunk: string) => Promise<void>, signal: AbortSignal) => Promise<void>,
  options: CodexStreamOptions = {},
): Promise<string[]> {
  const out: string[] = [];
  for await (const ev of streamCodexGeneration(produce, options)) {
    if (ev.type === "chunk") out.push(ev.data);
    if (ev.type === "error") throw new Error(ev.message);
  }
  return out;
}

/** Non-streaming API: await full result. */
export async function generateOnce(
  produce: (emit: (chunk: string) => Promise<void>, signal: AbortSignal) => Promise<void>,
  options: CodexStreamOptions = {},
): Promise<string> {
  const parts = await runCollect(produce, options);
  return parts.join("");
}
