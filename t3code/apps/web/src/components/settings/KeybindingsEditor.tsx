import { TriangleAlertIcon } from "lucide-react";
import {
  type KeyboardEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  KeybindingCommand,
  ResolvedKeybindingsConfig,
  ServerUpsertKeybindingInput,
} from "@t3tools/contracts";

import { toastManager } from "~/components/ui/toast";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Kbd, KbdGroup } from "~/components/ui/kbd";
import { isMacPlatform } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { useServerKeybindings } from "~/rpc/serverState";
import {
  buildKeybindingRows,
  commandLabel,
  compareKeybindingRows,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  type KeybindingRow,
  type KeybindingSortDirection,
  type KeybindingSortKey,
} from "~/components/settings/KeybindingsSettings.logic";

export type { KeybindingSortDirection, KeybindingSortKey };

const COLUMNS: ReadonlyArray<{ key: KeybindingSortKey; label: string }> = [
  { key: "command", label: "Command" },
  { key: "shortcut", label: "Shortcut" },
  { key: "source", label: "Source" },
];

function shortcutPill(value: string) {
  const parts = value.split("+");
  const isMac = typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
  return (
    <KbdGroup className="bg-transparent p-0 shadow-none">
      {parts.map((part) => (
        <Kbd key={part} className="min-w-6 justify-center px-1.5">
          {part === "mod"
            ? isMac
              ? "⌘"
              : "Ctrl"
            : part.length === 1
              ? part.toUpperCase()
              : part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function KeybindingEditorRow({
  row,
  allRows,
  isSaving,
  onSave,
  onReset,
}: {
  row: KeybindingRow;
  allRows: ReadonlyArray<KeybindingRow>;
  isSaving: boolean;
  onSave: (input: ServerUpsertKeybindingInput) => void;
  onReset: (row: KeybindingRow) => void;
}) {
  const [draft, setDraft] = useState(row.key);
  const [isRecording, setIsRecording] = useState(false);
  const conflicts = keybindingConflictLabels(allRows, {
    rowId: row.id,
    key: draft,
    when: row.when,
  });
  const isDirty = draft !== row.key;
  const canReset = row.source !== "Default" && row.defaultKey !== null;

  const capture = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setDraft(row.key);
      setIsRecording(false);
      return;
    }
    const next = keybindingFromKeyboardEvent(
      event.nativeEvent,
      typeof navigator === "undefined" ? "Win32" : navigator.platform,
    );
    if (!next) return;
    setDraft(next);
    setIsRecording(false);
  };

  return (
    <div
      role="row"
      className="grid grid-cols-[minmax(160px,1.2fr)_minmax(200px,1fr)_minmax(90px,0.4fr)_minmax(220px,0.9fr)] items-center gap-2 px-4 py-1.5 text-sm even:bg-muted/15 hover:bg-accent/40"
    >
      <div role="gridcell" className="truncate text-[13px] font-medium" title={row.command}>
        {commandLabel(row.command)}
      </div>
      <div role="gridcell" className="flex min-w-0 items-center gap-2">
        {isRecording ? (
          <Input
            autoFocus
            aria-label={`Record shortcut for ${commandLabel(row.command)}. Press Escape to cancel.`}
            value=""
            placeholder="Press shortcut"
            onKeyDown={capture}
            onBlur={() => setIsRecording(false)}
            className="h-7 w-44 font-mono text-[12px]"
          />
        ) : (
          <>
            {draft ? shortcutPill(draft) : <span className="text-muted-foreground">Unassigned</span>}
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="h-7"
              disabled={isSaving}
              aria-label={`Record shortcut for ${commandLabel(row.command)}`}
              onClick={() => setIsRecording(true)}
            >
              Record shortcut
            </Button>
          </>
        )}
      </div>
      <div role="gridcell">
        <span
          aria-label={`Source: ${row.source}`}
          className="inline-flex h-5 items-center rounded-sm border border-border/70 bg-muted/40 px-1.5 text-[10px] font-medium uppercase tracking-[0.06em] text-muted-foreground"
        >
          {row.source === "Default" ? "Default" : row.source === "Project" ? "Project" : "User"}
        </span>
      </div>
      <div role="gridcell" className="flex items-center justify-end gap-1.5">
        {conflicts.length > 0 ? (
          <span
            role="alert"
            tabIndex={0}
            aria-label={`Conflicts with ${conflicts.join(", ")}`}
            title={`Conflicts with ${conflicts.join(", ")}. The most recent matching binding wins.`}
            className="inline-flex items-center gap-1 rounded-sm px-1.5 py-1 text-[11px] text-warning outline-none focus-visible:ring-[3px] focus-visible:ring-warning/25"
          >
            <TriangleAlertIcon className="size-3.5" />
            Conflicts: {conflicts.slice(0, 2).join(", ")}
            {conflicts.length > 2 ? ` +${conflicts.length - 2}` : ""}
          </span>
        ) : null}
        {isDirty ? (
          <Button
            type="button"
            size="xs"
            className="h-7"
            disabled={isSaving || draft.trim().length === 0}
            onClick={() =>
              onSave({
                command: row.command,
                key: draft.trim(),
                ...(row.when.trim() ? { when: row.when } : {}),
                replace: {
                  command: row.command,
                  key: row.key,
                  ...(row.when.trim() ? { when: row.when } : {}),
                },
              })
            }
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
        ) : null}
        {canReset ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="h-7"
            disabled={isSaving}
            aria-label={`Reset ${commandLabel(row.command)} to default`}
            onClick={() => {
              setDraft(row.defaultKey ?? row.key);
              onReset(row);
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function KeybindingsEditor({
  keybindings: keybindingsProp,
}: {
  keybindings?: ResolvedKeybindingsConfig;
} = {}) {
  const serverKeybindings = useServerKeybindings();
  const keybindings = keybindingsProp ?? serverKeybindings;
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<KeybindingSortKey>("command");
  const [sortDirection, setSortDirection] = useState<KeybindingSortDirection>("asc");
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const built = buildKeybindingRows(keybindings, "");
    const filtered =
      normalized.length === 0
        ? built
        : built.filter(
            (row) =>
              row.command.toLowerCase().includes(normalized) ||
              row.key.toLowerCase().includes(normalized),
          );
    const sorted = [...filtered].sort((a, b) => compareKeybindingRows(a, b, sortKey));
    return sortDirection === "desc" ? sorted.reverse() : sorted;
  }, [keybindings, query, sortKey, sortDirection]);

  const toggleSort = useCallback(
    (next: KeybindingSortKey) => {
      if (next === sortKey) {
        setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(next);
        setSortDirection("asc");
      }
    },
    [sortKey],
  );

  const handleBodyKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End" && event.key !== "Escape") {
      return;
    }
    if (event.key === "Escape") {
      setQuery("");
      return;
    }
    const container = bodyRef.current;
    if (!container || !(event.target instanceof HTMLElement)) return;
    const focusable = [...container.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])")];
    const currentIndex = focusable.indexOf(event.target as HTMLElement);
    if (currentIndex === -1) return;
    event.preventDefault();
    if (event.key === "Home") {
      focusable[0]?.focus();
      return;
    }
    if (event.key === "End") {
      focusable[focusable.length - 1]?.focus();
      return;
    }
    const delta = event.key === "ArrowDown" ? 1 : -1;
    focusable[(currentIndex + delta + focusable.length) % focusable.length]?.focus();
  }, []);

  const saveKeybinding = useCallback((input: ServerUpsertKeybindingInput) => {
    setSavingCommand(input.command);
    // Settings RPC path: server keybinding upsert applies immediately, no restart needed.
    void ensureLocalApi()
      .server.upsertKeybinding({
        command: input.command,
        key: input.key.trim(),
        ...(input.when?.trim() ? { when: input.when.trim() } : {}),
        ...(input.replace ? { replace: input.replace } : {}),
      })
      .then(() => {
        toastManager.add({
          title: "Keybinding saved",
          description: `${commandLabel(input.command)} is now ${input.key.trim()}.`,
          type: "success",
        });
      })
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to save keybinding",
          description: error instanceof Error ? error.message : "The keybinding was not saved.",
          type: "error",
        });
      })
      .finally(() => {
        setSavingCommand(null);
      });
  }, []);

  const resetKeybinding = useCallback(
    (row: KeybindingRow) => {
      if (!row.defaultKey) return;
      saveKeybinding({
        command: row.command,
        key: row.defaultKey,
        when: row.defaultWhen.trim().length > 0 ? row.defaultWhen : undefined,
        replace: {
          command: row.command,
          key: row.key,
          ...(row.when.trim().length > 0 ? { when: row.when } : {}),
        },
      });
    },
    [saveKeybinding],
  );

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 px-4 py-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by command or shortcut"
          aria-label="Search keybindings by command or shortcut"
          className="h-8 max-w-sm"
        />
        <span className="text-[11px] text-muted-foreground">
          {rows.length} {rows.length === 1 ? "binding" : "bindings"}
        </span>
      </div>
      <div role="grid" aria-label="Keybindings editor" aria-rowcount={rows.length + 1}>
        <div
          role="row"
          className="grid grid-cols-[minmax(160px,1.2fr)_minmax(200px,1fr)_minmax(90px,0.4fr)_minmax(220px,0.9fr)] gap-2 border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground"
        >
          {COLUMNS.map((column) => (
            <div
              key={column.key}
              role="columnheader"
              aria-sort={
                sortKey === column.key
                  ? sortDirection === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                type="button"
                onClick={() => toggleSort(column.key)}
                aria-label={`Sort by ${column.label.toLowerCase()}`}
                className="inline-flex items-center gap-1 uppercase outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/24"
              >
                {column.label}
                <span aria-hidden className="text-[9px]">
                  {sortKey === column.key ? (sortDirection === "asc" ? "▲" : "▼") : ""}
                </span>
              </button>
            </div>
          ))}
          <div role="columnheader" aria-sort="none">
            <span>Actions</span>
          </div>
        </div>
        <div ref={bodyRef} role="rowgroup" onKeyDown={handleBodyKeyDown} className="divide-y divide-border/60">
          {rows.map((row) => (
            <KeybindingEditorRow
              key={row.id}
              row={row}
              allRows={rows}
              isSaving={savingCommand === row.command}
              onSave={saveKeybinding}
              onReset={resetKeybinding}
            />
          ))}
          {rows.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              No keybindings match your search.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default KeybindingsEditor;
