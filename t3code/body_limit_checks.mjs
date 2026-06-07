import { readFileSync } from "node:fs";

const bodyLimit = readFileSync("t3code/apps/server/src/httpBodyLimit.ts", "utf8");
const http = readFileSync("t3code/apps/server/src/http.ts", "utf8");
const auth = readFileSync("t3code/apps/server/src/auth/http.ts", "utf8");
const orchestration = readFileSync("t3code/apps/server/src/orchestration/http.ts", "utf8");
const tests = readFileSync("t3code/apps/server/src/http.test.ts", "utf8");
const provenance = JSON.parse(readFileSync("t3code/apps/server/src/_provenance.json", "utf8"));

const routeFiles = `${http}\n${auth}\n${orchestration}`;

const checks = [
  ["10MB default", bodyLimit.includes("DEFAULT_REQUEST_BODY_LIMIT_BYTES = 10 * 1024 * 1024")],
  ["50MB upload override", bodyLimit.includes("FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES = 50 * 1024 * 1024")],
  ["content length parsed safely", bodyLimit.includes("parseContentLengthBytes") && bodyLimit.includes("Number.isSafeInteger")],
  ["413 response", bodyLimit.includes("status: 413") && bodyLimit.includes("Payload Too Large")],
  ["limit and received in JSON", bodyLimit.includes("limit: error.limitBytes") && bodyLimit.includes("received: error.receivedBytes")],
  ["max body header", bodyLimit.includes('BODY_LIMIT_HEADER = "X-Max-Body-Size"')],
  ["guard before JSON parsing", routeFiles.includes("yield* enforceRequestBodyLimit();") && routeFiles.indexOf("yield* enforceRequestBodyLimit();") < routeFiles.indexOf("schemaBodyJson")],
  ["upload route uses override", http.includes("enforceRequestBodyLimit(FILE_UPLOAD_REQUEST_BODY_LIMIT_BYTES)")],
  ["routes catch body errors", routeFiles.includes('Effect.catchTag("RequestBodyTooLargeError", respondToRequestBodyTooLarge)')],
  ["tests cover default and override", tests.includes("uses a 10MB default") && tests.includes("allows requests under custom per-route limits")],
  ["safe provenance", provenance.agent === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(JSON.stringify(provenance))],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`body limit checks passed (${checks.length})`);
