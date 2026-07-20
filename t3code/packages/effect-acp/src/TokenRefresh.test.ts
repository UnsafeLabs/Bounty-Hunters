import {
  AuthenticationError,
  TokenRefreshClient,
  isUnauthorized,
  reauthScheduleAttempts,
} from "./TokenRefresh.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(reauthScheduleAttempts() === 1, "exactly one reauth attempt");
assert(isUnauthorized(401) === true, "401");
assert(isUnauthorized(200) === false, "200");

let expiredCalls: string[] = [];
let releaseCalls: string[] = [];
let reauthCount = 0;

const client = new TokenRefreshClient(
  { accessToken: "access-old", refreshToken: "refresh-1", sessionId: "sess-1" },
  {
    onSessionExpired: (id) => {
      expiredCalls.push(id);
    },
    releaseSession: (id) => {
      releaseCalls.push(id);
    },
    reauthenticate: async (rt, sid) => {
      reauthCount += 1;
      assert(rt === "refresh-1", "uses refresh token");
      assert(sid === "sess-1", "old session id");
      return {
        accessToken: "access-new",
        refreshToken: "refresh-2",
        sessionId: "sess-2",
      };
    },
  },
);

// Happy path no 401
const ok = await client.requestWithAuth(async (tok) => {
  assert(tok === "access-old", "old token first");
  return { status: 200, body: { data: 1 } };
});
assert(ok.data === 1, "body");
assert(reauthCount === 0, "no reauth");

// 401 triggers reauth once then success
let sawNew = false;
const body = await client.requestWithAuth(async (tok) => {
  if (tok === "access-old") return { status: 401, body: null as null };
  sawNew = true;
  assert(tok === "access-new", "new access token");
  return { status: 200, body: { ok: true } };
});
assert(body.ok === true && sawNew, "reauth success");
assert(reauthCount === 1, "one reauth");
assert(expiredCalls[0] === "sess-1", "onSessionExpired");
assert(releaseCalls[0] === "sess-1", "release old session");
assert(client.sessionId === "sess-2", "new session");
assert(client.refreshToken === "refresh-2", "refresh rotated");

// Concurrent requests during reauth are queued
expiredCalls = [];
reauthCount = 0;
const slow = new TokenRefreshClient(
  { accessToken: "a0", refreshToken: "r0", sessionId: "s0" },
  {
    onSessionExpired: async (id) => {
      expiredCalls.push(id);
      await new Promise((r) => setTimeout(r, 30));
    },
    reauthenticate: async () => {
      reauthCount += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { accessToken: "a1", refreshToken: "r1", sessionId: "s1" };
    },
  },
);

let phase = 0;
const makeExec = (label: string) => async (tok: string) => {
  if (tok === "a0") return { status: 401 as const, body: null };
  return { status: 200 as const, body: { label, tok } };
};

// Start three concurrent 401s — should single-flight reauth
const p1 = slow.requestWithAuth(makeExec("p1"));
const p2 = slow.requestWithAuth(makeExec("p2"));
// small delay so p1 starts refresh
await new Promise((r) => setTimeout(r, 5));
const p3 = slow.requestWithAuth(makeExec("p3"));
const results = await Promise.all([p1, p2, p3]);
assert(reauthCount === 1, `single flight reauth got ${reauthCount}`);
assert(results.every((r) => r.tok === "a1"), "all got new token");

// Failed reauth fails queued with AuthenticationError
const bad = new TokenRefreshClient(
  { accessToken: "x", refreshToken: "y", sessionId: "z" },
  {
    reauthenticate: async () => {
      throw new Error("refresh rejected");
    },
  },
);
let failed = false;
try {
  await bad.requestWithAuth(async () => ({ status: 401, body: null }));
} catch (e) {
  failed = e instanceof AuthenticationError;
}
assert(failed, "AuthenticationError on failed reauth");

console.log("TokenRefresh tests: all passed");
