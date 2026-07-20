import {
  IpcMessageQueue,
  TimeoutError,
  DEFAULT_MAX_QUEUE,
} from "./IpcMessageQueue.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

let t = 1_000_000;
const now = () => t;
const sent: string[] = [];

const q = new IpcMessageQueue<string, string>({
  send: async (p) => {
    sent.push(p);
    return `ok:${p}`;
  },
  maxSize: 3,
  ttlMs: 30_000,
  now,
  initialState: "disconnected",
});

// connectionState subscription
const states: string[] = [];
const unsub = q.subscribe((s) => states.push(s));
assert(states[0] === "disconnected", "initial emit");

// Queue during downtime
const p1 = q.call("a");
const p2 = q.call("b");
assert(q.size === 2, "queued 2");
assert(sent.length === 0, "not sent yet");

// Reconnect flushes FIFO
q.setConnectionState("reconnecting");
q.setConnectionState("connected");
const r1 = await p1;
const r2 = await p2;
assert(r1 === "ok:a" && r2 === "ok:b", "fifo results");
assert(sent.join(",") === "a,b", "fifo order");
assert(states.includes("connected") && states.includes("reconnecting"), "states");

// Healthy bypass
sent.length = 0;
const direct = await q.call("c");
assert(direct === "ok:c" && sent.join(",") === "c", "bypass");
assert(q.size === 0, "empty queue");

// Max size drops oldest
q.setConnectionState("disconnected");
const d1 = q.call("old1").then(
  () => "resolved",
  (e) => (e instanceof TimeoutError ? "timeout" : "err"),
);
q.call("old2");
q.call("old3");
q.call("new4"); // should drop old1
assert(q.size === 3, "max 3");
const d1r = await d1;
assert(d1r === "timeout", "oldest dropped");

// Expiry
t += 31_000;
const exp = q.call("x").then(
  () => "ok",
  (e) => (e instanceof TimeoutError ? "timeout" : "err"),
);
// expireOld on next call
q.call("y");
// the expired ones in queue get rejected on expireOld
assert(DEFAULT_MAX_QUEUE === 100, "default max");

unsub();
console.log("IpcMessageQueue tests: all passed");
