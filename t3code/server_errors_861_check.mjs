import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const errors = read("apps/server/src/errors.ts");
const tests = read("apps/server/src/errors.test.ts");
const bootstrap = read("apps/server/src/bootstrap.ts");
const http = read("apps/server/src/http.ts");
const serverAuth = read("apps/server/src/auth/Services/ServerAuth.ts");
const processRunner = read("apps/server/src/processRunner.ts");
const meta = JSON.parse(read("apps/server/src/_meta.json"));

assert.match(errors, /type StandardServerError = Data\.TaggedEnum</);
assert.match(errors, /const ServerError = Data\.taggedEnum<StandardServerError>\(\)/);

for (const tag of [
  "AuthError",
  "ValidationError",
  "DatabaseError",
  "NetworkError",
  "ConfigError",
  "GitError",
]) {
  assert.match(errors, new RegExp(`readonly ${tag}: ServerErrorFields`));
  assert.match(tests, new RegExp(`"${tag}"`));
}

assert.match(errors, /function errorToResponse/);
assert.match(errors, /function errorToLog/);
assert.match(errors, /function toStandardServerError/);
assert.match(errors, /readonly timestamp: string/);
assert.match(errors, /readonly cause\?: unknown/);
assert.match(tests, /Match\.tag\("AuthError"/);
assert.match(tests, /preserves cause chains/);
assert.match(tests, /ProcessTimeoutError/);

assert.match(bootstrap, /import \{ BootstrapError \} from "\.\/errors\.ts";/);
assert.match(http, /import \{ DecodeOtlpTraceRecordsError \} from "\.\/errors\.ts";/);
assert.match(serverAuth, /import \{ AuthError \} from "\.\.\/\.\.\/errors\.ts";/);
assert.match(processRunner, /from "\.\/errors\.ts";/);

assert.equal(meta.contributor, "Codex GPT-5");
assert.match(meta.generation_context, /Public safe metadata/);
assert.doesNotMatch(meta.generation_context, /system prompt|developer message|clipboard|token/i);

console.log("T3 Code issue 861 server error checks passed");
