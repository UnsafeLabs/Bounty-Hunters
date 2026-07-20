import {
  MemoryCheckpointStore,
  runWithInterruptCheckpoint,
  resumeInterrupted,
} from "./InterruptCheckpoint.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const store = new MemoryCheckpointStore();
const logs: Array<Record<string, unknown>> = [];
let phase = "start";
let partial: unknown = { step: 0 };

// Normal completion unaffected
const ok = await runWithInterruptCheckpoint({
  commandId: "c-ok",
  fiberId: "f1",
  getPartial: () => partial,
  phase: () => phase,
  store,
  log: (e, f) => logs.push({ e, ...f }),
  run: async () => {
    phase = "done";
    partial = { step: 2 };
    return 42;
  },
});
assert(ok === 42, "normal");
assert((await resumeInterrupted(store, "c-ok")) === undefined, "no interrupt save");

// Interrupt mid-run via AbortSignal
const ac = new AbortController();
partial = { step: 0 };
phase = "working";
let threw = false;
const p = runWithInterruptCheckpoint({
  commandId: "c-int",
  fiberId: "f2",
  getPartial: () => partial,
  phase: () => phase,
  store,
  signal: ac.signal,
  log: (e, f) => logs.push({ e, ...f }),
  run: async () => {
    partial = { step: 1, data: "half" };
    phase = "mid";
    ac.abort();
    // simulate work noticing abort
    throw new DOMException("Interrupted by client", "AbortError");
  },
});
try {
  await p;
} catch {
  threw = true;
}
assert(threw, "threw");
const cp = await resumeInterrupted(store, "c-int");
assert(cp?.commandId === "c-int", "checkpointed");
assert((cp?.partialPayload as any)?.step === 1, "partial");
assert(cp?.phase === "mid", "phase");
assert(logs.some((l) => l.e === "orchestration.command.interrupted"), "logged");
assert(logs.some((l) => l.commandId === "c-int" && l.fiberId === "f2"), "ids");

console.log("InterruptCheckpoint tests: all passed");
