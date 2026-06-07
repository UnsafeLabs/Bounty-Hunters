import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const source = read("packages/client-runtime/src/knownEnvironment.ts");
const tests = read("packages/client-runtime/src/knownEnvironment.test.ts");
const meta = JSON.parse(read("packages/client-runtime/src/_contributor.json"));

for (const expected of [
  "EnvironmentInfo",
  "runtime",
  "platform",
  "arch",
  "isContainer",
  "isCI",
  "ciProvider",
  "isWSL",
  "detectEnvironmentInfo",
]) {
  assert.match(source, new RegExp(expected));
  assert.match(tests, new RegExp(expected));
}

for (const expected of [
  "/.dockerenv",
  "/proc/1/cgroup",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "JENKINS_URL",
  "CIRCLECI",
  "TRAVIS",
  "/proc/version",
]) {
  assert.match(source, new RegExp(expected.replace(/[/.]/g, "\\$&")));
  assert.match(tests, new RegExp(expected.replace(/[/.]/g, "\\$&")));
}

assert.match(source, /try\s*\{/);
assert.match(source, /catch\s*\{/);
assert.match(source, /ciProvider !== null/);
assert.match(tests, /does not throw when file probes fail/);
assert.equal(meta.identity, "Codex GPT-5");
assert.match(meta.runtime_instructions, /Public safe metadata/);
assert.doesNotMatch(meta.runtime_instructions, /clipboard|token|system prompt|developer message/i);

console.log("T3 Code issue 836 client runtime environment checks passed");
