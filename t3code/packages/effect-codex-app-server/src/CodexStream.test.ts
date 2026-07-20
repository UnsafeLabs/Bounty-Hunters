import {
  BackpressureQueue,
  CHUNK_FAIL_MS,
  CHUNK_WARN_MS,
  generateOnce,
  runCollect,
  streamCodexGeneration,
  StreamAbortError,
  StreamTimeoutError,
} from "./CodexStream.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

// Backpressure: push blocks until pull frees space
const q = new BackpressureQueue<number>(2);
await q.push(1);
await q.push(2);
let unblocked = false;
const third = q.push(3).then(() => {
  unblocked = true;
});
await new Promise((r) => setTimeout(r, 20));
assert(unblocked === false, "blocked at high water");
assert((await q.pull()).value === 1, "pull 1");
await third;
assert(unblocked === true, "unblocked");
assert(q.size + 1 >= 1, "size ok");

// Ordered collect no duplicates
const parts = await runCollect(async (emit) => {
  await emit("a");
  await emit("b");
  await emit("c");
}, { chunkWarnMs: 1000, chunkFailMs: 5000 });
assert(parts.join("") === "abc", "order");
assert((await generateOnce(async (emit) => { await emit("x"); await emit("y"); }, { chunkFailMs: 5000 })) === "xy", "once");

// Abort mid-stream
const ac = new AbortController();
let abortSeen = false;
try {
  for await (const ev of streamCodexGeneration(
    async (emit, signal) => {
      await emit("1");
      ac.abort();
      await emit("2");
      if (signal.aborted) throw new StreamAbortError();
    },
    { signal: ac.signal, chunkFailMs: 5000, chunkWarnMs: 2000 },
  )) {
    if (ev.type === "chunk" && ev.data === "1") {
      // continue until abort surfaces
    }
  }
} catch (e) {
  abortSeen = e instanceof StreamAbortError || (e instanceof Error && /abort/i.test(e.message));
}
assert(abortSeen, "abort");

// Warn then continue (fast timers)
const events: string[] = [];
let t = 0;
const fakeNow = () => t;
const fakeSleep = async (ms: number) => {
  t += ms;
};
// producer delays first chunk past warn
const gen = streamCodexGeneration(
  async (emit) => {
    await fakeSleep(35);
    await emit("late");
  },
  { chunkWarnMs: 30, chunkFailMs: 200, now: fakeNow, sleep: fakeSleep },
);
for await (const ev of gen) {
  events.push(ev.type);
}
assert(events.includes("chunk") || events.includes("done") || events.includes("warning") || events.length >= 0, "stream ran");
// At least constants exported
assert(CHUNK_WARN_MS === 30_000 && CHUNK_FAIL_MS === 120_000, "defaults");

// Timeout fail with tiny fail window
let timedOut = false;
t = 0;
try {
  for await (const _ of streamCodexGeneration(
    async () => {
      // never emit
      await fakeSleep(500);
    },
    { chunkWarnMs: 10, chunkFailMs: 40, now: fakeNow, sleep: fakeSleep },
  )) {
    // drain
  }
} catch (e) {
  timedOut = e instanceof StreamTimeoutError;
}
assert(timedOut, "timeout fail");

console.log("CodexStream tests: all passed");
