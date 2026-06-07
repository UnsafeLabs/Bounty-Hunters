import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const source = read("packages/contracts/src/providerConfigValidation.ts");
const tests = read("packages/contracts/src/providerConfigValidation.test.ts");
const index = read("packages/contracts/src/index.ts");

for (const needle of [
  "ProviderConfigError",
  "ProviderApiKeyValue",
  "ProviderHttpsEndpointUrl",
  "validateProviderConfig",
  "Result.fail(errors)",
  "HTTPS, not HTTP",
  "ProviderInstanceConfig schema",
  "invalidValue",
  "expected",
  "field",
]) {
  assert.ok(source.includes(needle), `${needle} missing from provider config validation`);
}

for (const testName of [
  "accepts valid provider configuration",
  "rejects empty and short API keys",
  "rejects HTTP URLs",
  "rejects malformed endpoint URLs",
  "returns all validation errors at once",
  "maps Effect Schema decode failures",
]) {
  assert.ok(tests.includes(testName), `${testName} test missing`);
}

assert.ok(index.includes('export * from "./providerConfigValidation.ts";'));

console.log("provider config validation checks passed");
