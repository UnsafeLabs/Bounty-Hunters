import { ACTIVITY_DEBOUNCE_MS, MultiSessionManager } from "./MultiSessionManager.ts";
import { parseDeviceName } from "./deviceName.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// device name parsing
assert(parseDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0").includes("Chrome"), "chrome");
assert(parseDeviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120.0.0.0").includes("macOS"), "macos");
assert(parseDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS) Safari/605").includes("Safari") || parseDeviceName("Mozilla/5.0 (iPhone; CPU iPhone OS) Version/17 Safari/604").includes("iOS"), "ios/safari");
assert(parseDeviceName("").includes("Unknown"), "empty");
assert(parseDeviceName(null).includes("Unknown"), "null");

const mgr = new MultiSessionManager();
const t0 = 1_700_000_000_000;

const a = mgr.create({
  userId: "u1",
  userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0",
  ipAddress: "1.2.3.4",
  now: t0,
});
assert(a.deviceName.includes("Chrome"), "device name set");
assert(a.deviceType === "desktop", "desktop type");
assert(a.revokedAt === null, "active");

const b = mgr.create({
  userId: "u1",
  userAgent: "Mozilla/5.0 (iPhone) Mobile Safari/604",
  now: t0 + 1000,
});
assert(b.deviceType === "mobile", "mobile");

const listed = mgr.listSessions("u1");
assert(listed.length === 2, "two sessions");
assert(listed[0]!.id === b.id, "sorted by lastActive desc");

// debounce: rapid touches should not write
assert(mgr.touchActivity(a.id, t0 + 1000) === false, "debounced within 5m");
assert(mgr.touchActivity(a.id, t0 + ACTIVITY_DEBOUNCE_MS + 1) === true, "write after debounce");

// revoke one
assert(mgr.revokeSession(b.id, t0 + 10_000) === true, "revoked");
assert(mgr.isActive(b.id) === false, "revoked inactive");
assert(mgr.listSessions("u1").length === 1, "one left");
assert(mgr.listSessions("u1")[0]!.id === a.id, "a remains");

// revoke all other
const c = mgr.create({ userId: "u1", now: t0 + 20_000 });
const d = mgr.create({ userId: "u1", now: t0 + 30_000 });
const n = mgr.revokeAllOtherSessions("u1", c.id, t0 + 40_000);
assert(n >= 2, `revoked others got ${n}`);
assert(mgr.isActive(c.id) === true, "current kept");
assert(mgr.listSessions("u1").every((s) => s.id === c.id), "only current");

// schema present
assert(MultiSessionManager.schemaSql().includes("CREATE TABLE"), "schema");
assert(MultiSessionManager.schemaSql().includes("last_active_at"), "last_active col");

console.log("MultiSessionManager: all tests passed");
