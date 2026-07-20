import {
  BackendHealthMonitor,
  FAILURES_BEFORE_RESTART,
  HEALTH_INTERVAL_MS,
  MAX_RESTART_ATTEMPTS,
} from "./BackendHealthMonitor.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(HEALTH_INTERVAL_MS === 15_000, "15s");
assert(FAILURES_BEFORE_RESTART === 3, "3 fails");
assert(MAX_RESTART_ATTEMPTS === 3, "3 restarts");

let pings = 0;
let healthy = true;
let restarts = 0;
const logs: string[] = [];
const notes: string[] = [];
const dialogs: string[] = [];

const mon = new BackendHealthMonitor({
  ping: async () => {
    pings += 1;
    return healthy;
  },
  restart: async () => {
    restarts += 1;
    healthy = true;
  },
  notify: (m) => notes.push(m),
  showErrorDialog: (m) => dialogs.push(m),
  log: (m) => logs.push(m),
  intervalMs: 1000,
  jitter: 0,
  random: () => 0.5,
});

assert(mon.nextIntervalMs() === 1000, "no jitter when 0");

// healthy ticks
await mon.tick();
await mon.tick();
assert(mon.getStatus() === "healthy", "healthy");
assert(mon.getConsecutiveFailures() === 0, "no fails");

// 3 failures -> restart
healthy = false;
await mon.tick();
await mon.tick();
assert(mon.getConsecutiveFailures() === 2, "2 fails");
await mon.tick();
assert(restarts === 1, "restarted once");
assert(notes.some((n) => /restart/i.test(n)), "notified");
assert(mon.getStatus() === "healthy", "healthy after restart");

// permanent failure after 3 restart failures
const mon2 = new BackendHealthMonitor({
  ping: async () => false,
  restart: async () => {
    throw new Error("spawn failed");
  },
  showErrorDialog: (m) => dialogs.push(m),
  log: (m) => logs.push(m),
  jitter: 0,
  random: () => 0.5,
});
for (let i = 0; i < 20 && mon2.getStatus() !== "failed"; i++) {
  await mon2.tick();
}
assert(mon2.getStatus() === "failed", "failed permanently");
assert(dialogs.length >= 1, "error dialog");
assert(mon2.getRestartAttempts() >= MAX_RESTART_ATTEMPTS, "max restarts");

// jitter changes interval
const mon3 = new BackendHealthMonitor({
  ping: async () => true,
  restart: async () => {},
  intervalMs: 1000,
  jitter: 0.2,
  random: () => 1, // factor 1.2
});
assert(mon3.nextIntervalMs() === 1200, "jitter up");

console.log("BackendHealthMonitor tests: all passed");
