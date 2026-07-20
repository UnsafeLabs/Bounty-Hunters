import {
  applyCustom,
  filterRows,
  findConflicts,
  formatShortcut,
  resetBinding,
  sortRows,
  type KeybindingRow,
} from "./KeybindingsEditor.logic.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const rows: KeybindingRow[] = [
  { command: "Open File", shortcut: "Cmd+O", defaultShortcut: "Cmd+O", source: "default" },
  { command: "Save", shortcut: "Cmd+S", defaultShortcut: "Cmd+S", source: "default" },
  { command: "Quit", shortcut: "Cmd+Q", defaultShortcut: "Cmd+Q", source: "default" },
];

assert(formatShortcut({ key: "o", metaKey: true }, "darwin") === "Cmd+O", "format");
const conflicts = findConflicts(rows, "Save", "Cmd+O");
assert(conflicts.includes("Open File"), "conflict");
assert(findConflicts(rows, "Save", "Cmd+S").length === 0, "no self conflict");

const custom = applyCustom(rows, "Save", "Cmd+Shift+S");
assert(custom.find((r) => r.command === "Save")!.source === "user", "user");
const reset = resetBinding(custom, "Save");
assert(reset.find((r) => r.command === "Save")!.shortcut === "Cmd+S", "reset");

assert(filterRows(rows, "open").length === 1, "filter");
assert(sortRows(rows, "command")[0]!.command === "Open File", "sort");

console.log("KeybindingsEditor logic tests: all passed");
