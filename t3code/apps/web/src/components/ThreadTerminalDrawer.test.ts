import { describe, expect, it } from "vitest";

import {
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  resolveTerminalSelectionActionPosition,
  selectPendingTerminalEventEntries,
  selectTerminalEventEntriesAfterSnapshot,
  shouldHandleTerminalSelectionMouseUp,
  terminalSelectionActionDelayForClickCount,
} from "./ThreadTerminalDrawer";

describe("resolveTerminalSelectionActionPosition", () => {
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

describe("terminal copy/paste shortcuts", () => {
  it("matches Ctrl+Shift+C / Ctrl+Shift+V on Linux/Windows", () => {
    expect(
      isTerminalCopyShortcut(
        { key: "c", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        "Linux x86_64",
      ),
    ).toBe(true);
    expect(
      isTerminalPasteShortcut(
        { key: "v", ctrlKey: true, metaKey: false, shiftKey: true, altKey: false },
        "Win32",
      ),
    ).toBe(true);
  });

  it("matches Cmd+C / Cmd+V on macOS", () => {
    expect(
      isTerminalCopyShortcut(
        { key: "c", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        "MacIntel",
      ),
    ).toBe(true);
    expect(
      isTerminalPasteShortcut(
        { key: "V", ctrlKey: false, metaKey: true, shiftKey: false, altKey: false },
        "MacIntel",
      ),
    ).toBe(true);
  });

  it("does not match plain Ctrl+C so SIGINT still passes through", () => {
    expect(
      isTerminalCopyShortcut(
        { key: "c", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false },
        "Linux x86_64",
      ),
    ).toBe(false);
  });

  it("does not match when Alt is held", () => {
    expect(
      isTerminalCopyShortcut(
        { key: "c", ctrlKey: true, metaKey: false, shiftKey: true, altKey: true },
        "Linux x86_64",
      ),
    ).toBe(false);
  });
});
