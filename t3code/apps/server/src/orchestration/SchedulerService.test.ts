import {
  InMemorySchedulerStore,
  SchedulerService,
  backoffMs,
} from "./SchedulerService.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(backoffMs(1) === 1000 && backoffMs(2) === 2000 && backoffMs(3) === 4000, "backoff");

let t = Date.parse("2026-07-20T12:00:00.000Z");
const now = () => t;
const sleeps: number[] = [];

const store = new InMemorySchedulerStore();
const executed: string[] = [];
let failsLeft = 2;

const svc = new SchedulerService({
  store,
  now,
  sleep: async (ms) => {
    sleeps.push(ms);
    t += ms;
  },
  execute: async (cmd) => {
    if (cmd.commandId === "c1" && failsLeft > 0) {
      failsLeft -= 1;
      throw new Error("transient");
    }
    executed.push(cmd.commandId);
  },
});

await svc.schedule({
  commandId: "c1",
  scheduledAt: "2026-07-20T12:01:00.000Z",
  maxRetries: 3,
});
assert((await svc.due()).length === 0, "not due yet");
t = Date.parse("2026-07-20T12:01:00.000Z");
assert((await svc.due()).length === 1, "due");

const ran = await svc.tick();
assert(ran[0]!.status === "completed", `completed after retries got ${ran[0]!.status}`);
assert(failsLeft === 0 && executed.includes("c1"), "executed");
assert(sleeps.length === 2, "two backoffs");

await svc.schedule({
  commandId: "c2",
  scheduledAt: "2026-07-20T12:02:00.000Z",
});
await svc.cancel("c2");
t = Date.parse("2026-07-20T12:03:00.000Z");
assert((await svc.due()).length === 0, "cancelled not due");
assert(store.get("c2")!.status === "cancelled", "cancelled status");

await svc.reschedule("c2", "2026-07-20T12:04:00.000Z");
assert(store.get("c2")!.status === "pending", "rescheduled pending");
assert(store.list().filter((c) => c.commandId === "c2").length === 1, "no duplicate");

// recurring on fresh store
const storeR = new InMemorySchedulerStore();
const svcR = new SchedulerService({
  store: storeR,
  now: () => t,
  sleep: async () => {},
  execute: async (cmd) => {
    executed.push(cmd.commandId);
  },
});
t = Date.parse("2026-07-20T12:05:00.000Z");
await svcR.schedule({
  commandId: "c3",
  scheduledAt: "2026-07-20T12:05:00.000Z",
  repeatIntervalMs: 60_000,
  maxRetries: 1,
});
const rec = await svcR.tick();
assert(rec.length === 1 && rec[0]!.commandId === "c3", "only c3");
assert(rec[0]!.status === "pending", `recurring stays pending got ${rec[0]!.status}`);
assert(Date.parse(rec[0]!.scheduledAt) >= Date.parse("2026-07-20T12:06:00.000Z"), "next interval");

store.upsert({
  commandId: "c4",
  scheduledAt: "2026-07-20T12:00:00.000Z",
  maxRetries: 1,
  status: "running",
  attempts: 1,
});
const recovered = await svc.recoverOnBoot();
assert(recovered >= 1 && store.get("c4")!.status === "pending", "boot recover");

const store2 = new InMemorySchedulerStore();
const svc2 = new SchedulerService({
  store: store2,
  now: () => Date.parse("2026-07-20T13:00:00.000Z"),
  sleep: async () => {},
  execute: async () => {
    throw new Error("always");
  },
});
await svc2.schedule({
  commandId: "bad",
  scheduledAt: "2026-07-20T12:00:00.000Z",
  maxRetries: 2,
});
const failed = await svc2.tick();
assert(failed[0]!.status === "failed", "failed");

console.log("SchedulerService tests: all passed");
