import { Effect } from "effect";
import { describe, it, expect } from "vitest";
import { KeybindingManager, KeyBinding } from "./KeybindingManager";
import { Schema } from "effect";

describe("KeybindingManager", () => {
  it("should validate KeyBinding schema", () => {
    const binding = {
      id: "save",
      action: "file.save",
      keyCombo: "Ctrl+S",
      label: "Save",
      category: "File",
      isEditable: true,
    };
    const result = Schema.decodeUnknownSync(KeyBinding)(binding);
    expect(result.id).toBe("save");
  });

  it("should export KeybindingManager as an Effect", () => {
    expect(Effect.isEffect(KeybindingManager)).toBe(true);
  });
});
