import {
  AuthError,
  ConfigError,
  DatabaseError,
  GitError,
  NetworkError,
  ValidationError,
  errorToLog,
  errorToResponse,
  matchError,
} from "./errors.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const cases = [
  [AuthError("nope"), 401],
  [ValidationError("bad"), 400],
  [DatabaseError("db"), 500],
  [NetworkError("net"), 502],
  [ConfigError("cfg"), 500],
  [GitError("git"), 422],
] as const;

for (const [err, status] of cases) {
  const res = errorToResponse(err);
  assert(res.status === status, `${err._tag} -> ${status}`);
  assert(res.body.tag === err._tag, "tag");
}

const chained = DatabaseError("write failed", new Error("disk full"));
const log = JSON.parse(errorToLog(chained));
assert(log.tag === "DatabaseError" && log.message === "write failed", "log fields");
assert(typeof log.timestamp === "string" && log.stack.includes("disk full"), "cause chain");

const matched = matchError(AuthError("x"), {
  AuthError: () => "auth",
  _: () => "other",
});
assert(matched === "auth", "match");

console.log("errors tests: all passed");
