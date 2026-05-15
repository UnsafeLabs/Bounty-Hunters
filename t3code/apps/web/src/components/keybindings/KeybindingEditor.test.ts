import { describe, it, expect } from "vitest";
import { detectConflicts, parseKeySequence } from "./KeybindingEditor.ts";
import type { KeyBinding } from "./KeybindingEditor.ts";

describe("detectConflicts", () => {
  it("detects conflicting keybindings", () => {
    const bindings: KeyBinding[] = [
      { id: "1", action: "copy", keys: "Ctrl+C", category: "edit" },
      { id: "2", action: "cancel", keys: "ctrl + c", category: "general" },
    ];

    const conflicts = detectConflicts(bindings);
    expect(conflicts.length).toBe(1);
    expect(conflicts[0].conflictingKeys).toBe("c+ctrl");
  });

  it("returns empty array when no conflicts", () => {
    const bindings: KeyBinding[] = [
      { id: "1", action: "copy", keys: "Ctrl+C", category: "edit" },
      { id: "2", action: "paste", keys: "Ctrl+V", category: "edit" },
    ];

    const conflicts = detectConflicts(bindings);
    expect(conflicts.length).toBe(0);
  });

  it("detects multiple conflicts with same key", () => {
    const bindings: KeyBinding[] = [
      { id: "1", action: "a", keys: "Ctrl+S", category: "edit" },
      { id: "2", action: "b", keys: "Ctrl+S", category: "edit" },
      { id: "3", action: "c", keys: "Ctrl+S", category: "edit" },
    ];

    const conflicts = detectConflicts(bindings);
    expect(conflicts.length).toBe(3);
  });

  it("handles empty bindings array", () => {
    const conflicts = detectConflicts([]);
    expect(conflicts.length).toBe(0);
  });
});

describe("parseKeySequence", () => {
  it("parses Ctrl+C", () => {
    expect(parseKeySequence("Ctrl+C")).toBe("ctrl+C");
  });

  it("parses Ctrl+Shift+S", () => {
    expect(parseKeySequence("Ctrl+Shift+S")).toBe("ctrl+shift+S");
  });

  it("normalizes cmd to meta", () => {
    expect(parseKeySequence("Cmd+P")).toBe("meta+P");
  });

  it("orders modifiers correctly", () => {
    expect(parseKeySequence("Shift+Ctrl+Alt+K")).toBe("ctrl+alt+shift+K");
  });

  it("handles spaces around plus", () => {
    expect(parseKeySequence("Ctrl + C")).toBe("ctrl+C");
  });
});
