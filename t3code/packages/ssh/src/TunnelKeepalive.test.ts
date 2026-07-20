import {
  BACKOFF_SCHEDULE_MS,
  MAX_RECONNECT_ATTEMPTS,
  SERVER_ALIVE_COUNT_MAX,
  SERVER_ALIVE_INTERVAL,
  TunnelConnectionManager,
  nextBackoffMs,
  sshKeepaliveConfig,
} from "./TunnelKeepalive.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const cfg = sshKeepaliveConfig();
assert(cfg.ServerAliveInterval === 15 && SERVER_ALIVE_INTERVAL === 15, "alive 15");
assert(cfg.ServerAliveCountMax === 3 && SERVER_ALIVE_COUNT_MAX === 3, "count 3");
assert(nextBackoffMs(0) === 1000 && nextBackoffMs(1) === 4000, "backoff");
assert(nextBackoffMs(2) === 16000 && nextBackoffMs(3) === 60000, "backoff high");
assert(nextBackoffMs(99) === 60000, "cap");
assert(BACKOFF_SCHEDULE_MS.length === 4, "schedule");

const sleeps: number[] = [];
let connects = 0;
let failConnect = true;
const states: string[] = [];

const mgr = new TunnelConnectionManager({
  connect: async () => {
    connects += 1;
    if (failConnect) throw new Error("down");
  },
  sleep: async (ms) => {
    sleeps.push(ms);
  },
});
mgr.subscribe((s) => states.push(s));

// Drop with failures then success
failConnect = true;
// seed as connected then drop
// force state by successful first connect
failConnect = false;
await mgr.connect();
assert(mgr.getState() === "connected", "connected");
failConnect = true;
let attempts = 0;
// make connect succeed on 3rd reconnect try
const orig = mgr["connectFn"];
(mgr as any).connectFn = async () => {
  attempts += 1;
  if (attempts < 3) throw new Error("still down");
};
await mgr.onTunnelDrop();
assert(mgr.getState() === "connected", "reconnected");
assert(sleeps[0] === 1000 && sleeps[1] === 4000, `sleeps ${sleeps}`);

// Manual disconnect no reconnect
const mgr2 = new TunnelConnectionManager({
  connect: async () => {},
  sleep: async () => {},
});
await mgr2.connect();
mgr2.disconnect();
await mgr2.onTunnelDrop();
assert(mgr2.getState() === "disconnected", "no auto after manual");

// Permanent fail after 5
const mgr3 = new TunnelConnectionManager({
  connect: async () => {
    throw new Error("no");
  },
  sleep: async () => {},
});
// pretend was connected
(mgr3 as any).state = "connected";
await mgr3.onTunnelDrop();
assert(mgr3.getState() === "failed", "failed");
assert(mgr3.getReconnectAttempts() === MAX_RECONNECT_ATTEMPTS, "5 attempts");

console.log("TunnelKeepalive tests: all passed");
