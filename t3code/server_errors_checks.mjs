import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const errors = read("apps/server/src/errors.ts");
const bootstrap = read("apps/server/src/bootstrap.ts");
const processRunner = read("apps/server/src/processRunner.ts");
const http = read("apps/server/src/http.ts");
const tests = read("apps/server/src/errors.test.ts");

for (const tag of [
  "AuthError",
  "ValidationError",
  "DatabaseError",
  "NetworkError",
  "ConfigError",
  "GitError",
]) {
  assert.match(errors, new RegExp(`class ${tag} extends Data\\.TaggedError\\("${tag}"\\)`));
  assert.match(errors, new RegExp(`${tag}:\\s*(401|400|422|500|502)`));
  assert.match(tests, new RegExp(`${tag}`));
}

assert.match(errors, /function errorToResponse/);
assert.match(errors, /function errorToLog/);
assert.match(errors, /readonly timestamp: string/);
assert.match(errors, /readonly cause\?: unknown/);
assert.match(tests, /Match\.tag\("AuthError"/);
assert.match(tests, /cause chains/);

assert.match(bootstrap, /import \{ BootstrapError \} from "\.\/errors\.ts";/);
assert.match(processRunner, /from "\.\/errors\.ts";/);
assert.match(http, /import \{ DecodeOtlpTraceRecordsError \} from "\.\/errors\.ts";/);

console.log("server error standardization checks passed");
