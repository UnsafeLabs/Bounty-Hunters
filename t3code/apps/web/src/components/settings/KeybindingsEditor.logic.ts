/**
 * Visual keybinding editor logic: record, conflict detect, reset (issue #843).
 */

export interface KeybindingRow {
  command: string;
  shortcut: string;
  defaultShortcut: string;
  source: "default" | "user";
}

export interface KeyEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

export function formatShortcut(e: KeyEventLike, platform: string = "darwin"): string {
  const parts: string[] = [];
  const isMac = platform === "darwin";
  if (e.metaKey || (isMac && e.metaKey)) parts.push(isMac ? "Cmd" : "Meta");
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) parts.push(key);
  return parts.join("+");
}

export function findConflicts(
  rows: KeybindingRow[],
  command: string,
  shortcut: string,
): string[] {
  if (!shortcut) return [];
  return rows
    .filter((r) => r.command !== command && r.shortcut === shortcut)
    .map((r) => r.command);
}

export function applyCustom(
  rows: KeybindingRow[],
  command: string,
  shortcut: string,
): KeybindingRow[] {
  return rows.map((r) =>
    r.command === command
      ? {
          ...r,
          shortcut,
          source: shortcut === r.defaultShortcut ? "default" : "user",
        }
      : r,
  );
}

export function resetBinding(rows: KeybindingRow[], command: string): KeybindingRow[] {
  return rows.map((r) =>
    r.command === command
      ? { ...r, shortcut: r.defaultShortcut, source: "default" as const }
      : r,
  );
}

export function filterRows(rows: KeybindingRow[], query: string): KeybindingRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter(
    (r) =>
      r.command.toLowerCase().includes(q) ||
      r.shortcut.toLowerCase().includes(q),
  );
}

export type SortKey = "command" | "shortcut" | "source";

export function sortRows(
  rows: KeybindingRow[],
  key: SortKey,
  dir: "asc" | "desc" = "asc",
): KeybindingRow[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => mul * a[key].localeCompare(b[key]));
}
