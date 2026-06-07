import { readFileSync } from "node:fs";

const registryPath = "knowledge-base/context.json";
const text = readFileSync(registryPath, "utf8");
const registry = JSON.parse(text);

const typoTokens = [
  "enginering",
  "reuqests",
  "programer",
  "specifed",
  "isue",
  "struture",
  "acounts",
];

const codexEntry = registry.entries.find((entry) => entry.agent_name === "Codex GPT-5");

const checks = [
  ["registry schema version present", registry.schema_version === "1.0.0"],
  ["entries array", Array.isArray(registry.entries) && registry.entries.length >= 3],
  ["documented typo tokens removed", typoTokens.every((token) => !text.includes(token))],
  ["codex entry present", codexEntry !== undefined],
  ["codex entry has four audit fields", codexEntry && ["agent_name", "timestamp", "system_prompt", "contribution"].every((key) => typeof codexEntry[key] === "string" && codexEntry[key].length > 0)],
  ["codex context is public safe", codexEntry && /avoid exposing private/i.test(codexEntry.system_prompt) && !/full configuration prompt|system message|developer message|paste everything/i.test(codexEntry.system_prompt)],
  ["json remains focused", !text.includes("clankers") || text.includes("clankers.json")],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`context rift checks passed (${checks.length})`);
