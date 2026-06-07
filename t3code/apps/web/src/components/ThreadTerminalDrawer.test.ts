import { describe, expect, it } from "vitest";

import {
  isMacTerminalClipboardPlatform,
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  resolveTerminalSelectionActionPosition,
  selectPendingTerminalEventEntries,
  selectTerminalEventEntriesAfterSnapshot,
  shouldHandleTerminalSelectionMouseUp,
  shouldHandleTerminalCopyShortcut,
  terminalSelectionActionDelayForClickCount,
  type TerminalClipboardShortcutEvent,
} from "./ThreadTerminalDrawer";

function keyEvent(
  key: string,
  modifiers: Partial<Omit<TerminalClipboardShortcutEvent, "key">> = {},
): TerminalClipboardShortcutEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...modifiers,
  };
}

describe("resolveTerminalSelectionActionPosition", () => {
  it("detects mac-style terminal clipboard platforms", () => {
    expect(isMacTerminalClipboardPlatform("MacIntel")).toBe(true);
    expect(isMacTerminalClipboardPlatform("iPhone")).toBe(true);
    expect(isMacTerminalClipboardPlatform("Win32")).toBe(false);
    expect(isMacTerminalClipboardPlatform("Linux x86_64")).toBe(false);
  });

  it("uses Ctrl+Shift+C and Ctrl+Shift+V for terminal clipboard shortcuts on Windows and Linux", () => {
    expect(isTerminalCopyShortcut(keyEvent("c", { ctrlKey: true, shiftKey: true }), "Win32")).toBe(
      true,
    );
    expect(isTerminalPasteShortcut(keyEvent("v", { ctrlKey: true, shiftKey: true }), "Linux")).toBe(
      true,
    );
    expect(isTerminalCopyShortcut(keyEvent("c", { ctrlKey: true }), "Linux")).toBe(false);
    expect(isTerminalPasteShortcut(keyEvent("v", { ctrlKey: true }), "Win32")).toBe(false);
  });

  it("uses Cmd+C and Cmd+V for terminal clipboard shortcuts on macOS", () => {
    expect(isTerminalCopyShortcut(keyEvent("C", { metaKey: true }), "MacIntel")).toBe(true);
    expect(isTerminalPasteShortcut(keyEvent("V", { metaKey: true }), "MacIntel")).toBe(true);
    expect(isTerminalCopyShortcut(keyEvent("c", { ctrlKey: true, shiftKey: true }), "MacIntel"))
      .toBe(false);
    expect(isTerminalPasteShortcut(keyEvent("v", { ctrlKey: true, shiftKey: true }), "MacIntel"))
      .toBe(false);
  });

  it("handles terminal copy only when the terminal has selected text", () => {
    const shortcut = keyEvent("c", { ctrlKey: true, shiftKey: true });

    expect(shouldHandleTerminalCopyShortcut(shortcut, "Linux", true)).toBe(true);
    expect(shouldHandleTerminalCopyShortcut(shortcut, "Linux", false)).toBe(false);
  });

  it("prefers the selection rect over the last pointer position", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: { right: 260, bottom: 140 },
        pointer: { x: 520, y: 200 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 260,
      y: 144,
    });
  });

  it("falls back to the pointer position when no selection rect is available", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 180, y: 130 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 180,
      y: 130,
    });
  });

  it("clamps the pointer fallback into the terminal drawer bounds", () => {
    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 720, y: 340 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 600,
      y: 270,
    });

    expect(
      resolveTerminalSelectionActionPosition({
        bounds: { left: 100, top: 50, width: 500, height: 220 },
        selectionRect: null,
        pointer: { x: 40, y: 20 },
        viewport: { width: 1024, height: 768 },
      }),
    ).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("delays multi-click selection actions so triple-click selection can complete", () => {
    expect(terminalSelectionActionDelayForClickCount(1)).toBe(0);
    expect(terminalSelectionActionDelayForClickCount(2)).toBe(260);
    expect(terminalSelectionActionDelayForClickCount(3)).toBe(260);
  });

  it("only handles mouseup when the selection gesture started in the terminal", () => {
    expect(shouldHandleTerminalSelectionMouseUp(true, 0)).toBe(true);
    expect(shouldHandleTerminalSelectionMouseUp(false, 0)).toBe(false);
    expect(shouldHandleTerminalSelectionMouseUp(true, 1)).toBe(false);
  });

  it("replays only terminal events newer than the open snapshot", () => {
    expect(
      selectTerminalEventEntriesAfterSnapshot(
        [
          {
            id: 1,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:00.000Z",
              type: "output",
              data: "before",
            },
          },
          {
            id: 2,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:01.000Z",
              type: "output",
              data: "after",
            },
          },
        ],
        "2026-04-02T20:00:00.500Z",
      ).map((entry) => entry.id),
    ).toEqual([2]);
  });

  it("applies only terminal events that have not already been consumed", () => {
    expect(
      selectPendingTerminalEventEntries(
        [
          {
            id: 1,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:00.000Z",
              type: "output",
              data: "one",
            },
          },
          {
            id: 2,
            event: {
              threadId: "thread-1",
              terminalId: "default",
              createdAt: "2026-04-02T20:00:01.000Z",
              type: "output",
              data: "two",
            },
          },
        ],
        1,
      ).map((entry) => entry.id),
    ).toEqual([2]);
  });
});
