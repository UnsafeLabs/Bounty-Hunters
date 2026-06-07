import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const files = {
  panel: read("t3code/apps/web/src/components/settings/KeybindingsSettings.tsx"),
  editor: read("t3code/apps/web/src/components/settings/KeybindingsEditor.tsx"),
  logic: read("t3code/apps/web/src/components/settings/KeybindingsSettings.logic.ts"),
  test: read("t3code/apps/web/src/components/settings/KeybindingsSettings.logic.test.ts"),
  meta: read("t3code/apps/web/contributor_meta.json"),
};

const checks = [
  ["KeybindingsEditor component is exported", files.panel.includes("export function KeybindingsEditor") && files.editor.includes("KeybindingsEditor")],
  ["search is wired", files.panel.includes("Search keybindings") && files.panel.includes("buildKeybindingRows(keybindings, query)")],
  ["sortable headers exist", files.panel.includes("SortableHeader") && files.panel.includes("aria-sort") && files.logic.includes("sortKeybindingRows")],
  ["all required table fields are visible", files.panel.includes('label="Command"') && files.panel.includes('label="Shortcut"') && files.panel.includes('label="Source"') && files.panel.includes('label="When"')],
  ["source badges are visible", files.panel.includes("SourceBadge") && files.panel.includes("Default") && files.panel.includes("Custom") && files.panel.includes("Project")],
  ["record shortcut flow is explicit", files.panel.includes("Record shortcut") && files.panel.includes("keybindingFromKeyboardEvent")],
  ["conflict warning is shown", files.panel.includes("KeybindingConflictWarning") && files.logic.includes("keybindingConflictLabels")],
  ["save and reset use settings RPC", files.panel.includes("server.upsertKeybinding") && files.panel.includes("server.removeKeybinding") && files.panel.includes("Reset to default")],
  ["logic tests cover sorting", files.test.includes("sortKeybindingRows") && files.test.includes("sorts rows by command, shortcut, source, and when fields")],
  ["safe contributor metadata is present", files.meta.includes("Codex GPT-5") && files.meta.includes("private system") && !files.meta.includes("<paste")],
];

const failures = checks.filter(([, ok]) => !ok);
if (failures.length > 0) {
  console.error("T3 Code issue 843 keybindings editor checks failed:");
  for (const [name] of failures) console.error(`- ${name}`);
  process.exit(1);
}

console.log("T3 Code issue 843 keybindings editor checks passed");
