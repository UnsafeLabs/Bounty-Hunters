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

const states: string[] = [];
const unsub = q.subscribe((s) => states.push(s));
assert(states[0] === "disconnected", "initial emit");

const p1 = q.call("a");
const p2 = q.call("b");
assert(q.size === 2, "queued 2");
assert(sent.length === 0, "not sent yet");

q.setConnectionState("reconnecting");
q.setConnectionState("connected");
assert((await p1) === "ok:a" && (await p2) === "ok:b", "fifo results");
assert(sent.join(",") === "a,b", "fifo order");

sent.length = 0;
assert((await q.call("c")) === "ok:c", "bypass");
assert(q.size === 0, "empty");

q.setConnectionState("disconnected");
const d1 = q.call("old1").then(
  () => "resolved",
  (e) => (e instanceof TimeoutError ? "timeout" : "err"),
);
void q.call("old2").catch(() => {});
void q.call("old3").catch(() => {});
void q.call("new4").catch(() => {}); // drops old1
assert(q.size === 3, "max 3");
assert((await d1) === "timeout", "oldest dropped");

// Expiry: advance clock, next call expires prior entries
const pending = [
  q.call("will-expire-1").then(() => "ok", (e) => (e instanceof TimeoutError ? "timeout" : "err")),
  q.call("will-expire-2").then(() => "ok", (e) => (e instanceof TimeoutError ? "timeout" : "err")),
];
// queue has 3 from before + maybe more — set disconnected clean queue by new instance
const q2 = new IpcMessageQueue<string, string>({
  send: async (p) => `ok:${p}`,
  maxSize: 10,
  ttlMs: 30_000,
  now,
  initialState: "disconnected",
});
const e1 = q2.call("x").then(() => "ok", (e) => (e instanceof TimeoutError ? "timeout" : "err"));
const e2 = q2.call("y").then(() => "ok", (e) => (e instanceof TimeoutError ? "timeout" : "err"));
t += 31_000;
// trigger expire via call while still disconnected
const e3 = q2.call("z").then(() => "ok", (e) => (e instanceof TimeoutError ? "timeout" : "err"));
assert((await e1) === "timeout", "e1 expired");
assert((await e2) === "timeout", "e2 expired");
// z still in queue (fresh)
assert(q2.size >= 1, "z queued");
assert(DEFAULT_MAX_QUEUE === 100, "default max");
// prevent unhandled from first pending array
await Promise.all(pending).catch(() => {});
await e3.catch(() => {});

unsub();
console.log("IpcMessageQueue tests: all passed");
