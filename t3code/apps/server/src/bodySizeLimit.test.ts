import {
  DEFAULT_BODY_LIMIT,
  UPLOAD_BODY_LIMIT,
  checkBodySize,
  resolveBodyLimit,
} from "./bodySizeLimit.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

assert(DEFAULT_BODY_LIMIT === 10 * 1024 * 1024, "10mb");
assert(UPLOAD_BODY_LIMIT === 50 * 1024 * 1024, "50mb");
assert(resolveBodyLimit("/api/chat") === DEFAULT_BODY_LIMIT, "default");
assert(resolveBodyLimit("/api/files/upload") === UPLOAD_BODY_LIMIT, "upload heuristic");
assert(resolveBodyLimit("/x", { "/x": 100 }) === 100, "override");

const ok = checkBodySize({ path: "/api", contentLength: 1000 });
assert(ok.allowed && ok.received === 1000, "ok");

const big = checkBodySize({ path: "/api", contentLength: DEFAULT_BODY_LIMIT + 1 });
assert(big.allowed === false && big.status === 413, "413");
assert(big.headers?.["X-Max-Body-Size"] === String(DEFAULT_BODY_LIMIT), "header");
assert(big.body?.limit === DEFAULT_BODY_LIMIT && big.body?.received === DEFAULT_BODY_LIMIT + 1, "body fields");

const uploadOk = checkBodySize({
  path: "/files/upload",
  contentLength: 20 * 1024 * 1024,
});
assert(uploadOk.allowed === true, "upload 20mb ok");

const custom = checkBodySize({
  path: "/special",
  contentLength: 50,
  overrides: { "/special": 40 },
});
assert(custom.allowed === false && custom.limit === 40, "per-route");

console.log("bodySizeLimit tests: all passed");
