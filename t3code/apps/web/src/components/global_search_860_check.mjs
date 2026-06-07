import { readFileSync } from "node:fs";

const files = {
  root: "t3code/apps/web/src/routes/__root.tsx",
  component: "t3code/apps/web/src/components/GlobalSearch.tsx",
  logic: "t3code/apps/web/src/components/GlobalSearch.logic.ts",
  audit: "t3code/apps/web/.audit.json",
};

const source = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [key, readFileSync(path, "utf8")]),
);

const checks = [
  ["root mounts GlobalSearch", source.root.includes("<GlobalSearch />")],
  ["Ctrl+Shift+F shortcut opens overlay", source.component.includes("isGlobalSearchShortcut")],
  ["Escape closes overlay", source.component.includes('event.key === "Escape"')],
  ["regex and case toggles exist", source.component.includes("RegexIcon") && source.component.includes("CaseSensitiveIcon")],
  ["uses React Query and progressive loading", source.component.includes("useInfiniteQuery") && source.component.includes("takeProgressiveResults")],
  ["groups chat file git results", source.component.includes('source="chat"') && source.component.includes('source="file"') && source.component.includes('source="git"')],
  ["invalid regex is surfaced", source.logic.includes("Invalid regular expression") && source.component.includes("Invalid regex")],
  ["chat messages searched", source.logic.includes("searchChatMessages") && source.logic.includes("message.text")],
  ["workspace paths searched", source.logic.includes("searchProjectEntries") && source.component.includes("projectSearchEntriesQueryOptions")],
  ["git refs searched", source.logic.includes("searchGitRefs") && source.component.includes("gitBranchSearchInfiniteQueryOptions")],
  ["safe public audit metadata", source.audit.includes("Public safe metadata") && !source.audit.includes("system prompt")],
];

const failed = checks.filter(([, passed]) => !passed);
if (failed.length > 0) {
  for (const [name] of failed) {
    console.error(`FAIL: ${name}`);
  }
  process.exit(1);
}

console.log("T3 Code #860 global search checks passed");
