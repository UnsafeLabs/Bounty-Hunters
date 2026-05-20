import { type KeyboardEvent, useCallback, useMemo, useReducer, useRef, useState } from "react";
import {
  type KeybindingCommand,
  type ServerUpsertKeybindingInput,
} from "@t3tools/contracts";

import { formatShortcutLabel } from "../keybindings";
import { ensureLocalApi } from "../localApi";
import { useServerKeybindings } from "../rpc/serverState";
import { Button } from "./ui/button";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Kbd, KbdGroup } from "./ui/kbd";
import { toastManager } from "./ui/toast";
import { ScrollArea } from "./ui/scroll-area";
import {
  buildKeybindingRows,
  buildKeybindingCommandOptions,
  buildWhenVariableOptions,
  commandLabel,
  keybindingConflictLabels,
  keybindingFromKeyboardEvent,
  type KeybindingRow,
} from "./settings/KeybindingsSettings.logic";

function KeybindingPill({ value }: { value: string }) {
  const parts = value.split("+");
  return (
    <KbdGroup className="bg-transparent p-0 shadow-none">
      {parts.map((part) => (
        <Kbd key={part} className="min-w-6 justify-center px-1.5">
          {part === "mod"
            ? navigator.platform.toLowerCase().includes("mac")
              ? "\u2318"
              : "Ctrl"
            : part === "shift"
              ? "\u21e7"
              : part === "alt"
                ? navigator.platform.toLowerCase().includes("mac")
                  ? "\u2325"
                  : "Alt"
                : part === "ctrl"
                  ? "\u2303"
                  : part.length === 1
                    ? part.toUpperCase()
                    : part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function ConflictWarning({ labels }: { labels: ReadonlyArray<string> }) {
  if (labels.length === 0) return null;
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-warning" title={`Conflicts with ${labels.join(", ")}`}>
      <svg className="size-3.5" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM7 5h2v4H7V5zm0 5h2v2H7v-2z" />
      </svg>
    </span>
  );
}

type RowDraftState = {
  keyDraft: string;
  isRecording: boolean;
};

function createDraft(row: KeybindingRow): RowDraftState {
  return { keyDraft: row.key, isRecording: false };
}

function draftReducer(state: RowDraftState, patch: Partial<RowDraftState>): RowDraftState {
  return { ...state, ...patch };
}

function Row({
  row,
  allRows,
  isSaving,
  onSave,
  onRemove,
}: {
  row: KeybindingRow;
  allRows: ReadonlyArray<KeybindingRow>;
  isSaving: boolean;
  onSave: (input: ServerUpsertKeybindingInput) => void;
  onRemove: (row: KeybindingRow) => void;
}) {
  const [draft, setDraft] = useReducer(draftReducer, row, createDraft);
  const { keyDraft, isRecording } = draft;
  const isDirty = keyDraft !== row.key;
  const showPill = !isRecording && keyDraft === row.key && row.key.length > 0 && !isDirty;
  const conflictLabels = keybindingConflictLabels(allRows, {
    rowId: row.id, key: keyDraft, when: row.when,
  });

  const save = () => {
    onSave({ command: row.command, key: keyDraft, replace: { command: row.command, key: row.key } });
  };

  const captureKeybinding = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setDraft({ keyDraft: row.key, isRecording: false });
      return;
    }
    const next = keybindingFromKeyboardEvent(event.nativeEvent, navigator.platform);
    if (!next) return;
    setDraft({ keyDraft: next, isRecording: false });
  };

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-4 py-2 text-sm even:bg-muted/15 hover:bg-accent/40">
      <div className="truncate text-[13px] font-medium text-foreground" title={row.command}>
        {commandLabel(row.command)}
      </div>
      <div className="flex items-center gap-2">
        {showPill ? (
          <button
            type="button"
            onClick={() => setDraft({ isRecording: true })}
            className="group inline-flex h-7 items-center gap-1 rounded-md border border-transparent px-1.5 outline-none hover:border-border/70 hover:bg-background focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
          >
            <KeybindingPill value={row.key} />
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/0 group-hover:text-muted-foreground/70">
              Edit
            </span>
          </button>
        ) : (
          <Input
            autoFocus={isRecording}
            value={isRecording ? "" : keyDraft}
            placeholder={isRecording ? "Press shortcut" : "Unassigned"}
            className={"h-7 w-36 rounded-md font-mono text-[12px]" + (isRecording ? " border-primary/70 bg-primary/5" : "")}
            onFocus={() => setDraft({ isRecording: true })}
            onBlur={() => setDraft({ isRecording: false })}
            onChange={(event) => setDraft({ keyDraft: event.currentTarget.value })}
            onKeyDown={captureKeybinding}
          />
        )}
        {isDirty ? (
          <Button size="xs" className="h-7" disabled={isSaving || keyDraft.trim().length === 0} onClick={save}>
            {isSaving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <ConflictWarning labels={conflictLabels} />
        {row.source !== "Default" ? (
          <Button variant="ghost" size="icon-xs" className="size-6 text-muted-foreground hover:text-foreground" disabled={isSaving} onClick={() => onRemove(row)}>
            <svg className="size-3" viewBox="0 0 16 16" fill="currentColor"><path d="M4 4h8v10H4zM6 1h4v2H6zM2 4h12v1H2z"/></svg>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function KeybindingEditorDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keybindings = useServerKeybindings();
  const [savingCommand, setSavingCommand] = useState<KeybindingCommand | null>(null);
  const rows = useMemo(() => buildKeybindingRows(keybindings, ""), [keybindings]);

  const saveKeybinding = useCallback((input: ServerUpsertKeybindingInput) => {
    setSavingCommand(input.command);
    void ensureLocalApi()
      .server.upsertKeybinding({ command: input.command, key: input.key.trim() })
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to save keybinding",
          description: error instanceof Error ? error.message : "The keybinding was not saved.",
          type: "error",
        });
      })
      .finally(() => setSavingCommand(null));
  }, []);

  const removeKeybinding = useCallback((row: KeybindingRow) => {
    setSavingCommand(row.command);
    void ensureLocalApi()
      .server.removeKeybinding({ command: row.command, key: row.key })
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to remove keybinding",
          description: error instanceof Error ? error.message : "The keybinding was not removed.",
          type: "error",
        });
      })
      .finally(() => setSavingCommand(null));
  }, []);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogPopup className="w-[min(42rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>Keybindings</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto_auto] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          <div>Command</div>
          <div>Keybinding</div>
          <div />
        </div>
        <ScrollArea className="max-h-96">
          {rows.map((row) => (
            <Row
              key={row.id}
              row={row}
              allRows={rows}
              isSaving={savingCommand === row.command}
              onSave={saveKeybinding}
              onRemove={removeKeybinding}
            />
          ))}
        </ScrollArea>
        <div className="flex justify-end border-t border-border/70 px-4 py-3">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
