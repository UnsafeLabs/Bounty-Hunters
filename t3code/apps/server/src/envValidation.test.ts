import {
  formatIssuesTable,
  runValidateConfig,
  validateEnv,
  type EnvSpec,
} from "./envValidation.ts";
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const specs: EnvSpec[] = [
  { name: "PORT", required: true, type: "number", description: "HTTP port" },
  { name: "DATABASE_URL", required: true, type: "url", description: "DB" },
  { name: "DEBUG", required: false, type: "boolean", description: "debug", defaultValue: "false" },
];
const bad = validateEnv(specs, { PORT: "x", DATABASE_URL: "not-a-url" });
assert(!bad.ok && bad.issues.length === 2, "two issues");
const table = formatIssuesTable(bad.issues);
assert(table.includes("PORT") && table.includes("DATABASE_URL"), "table");
const good = runValidateConfig(specs, {
  PORT: "3000",
  DATABASE_URL: "https://example.com/db",
});
assert(good.exitCode === 0, "ok exit");
const missing = runValidateConfig(specs, {});
assert(missing.exitCode === 1, "fail exit");
console.log("envValidation tests: all passed");
