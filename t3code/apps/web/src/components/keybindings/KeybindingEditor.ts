import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

export interface KeyBinding {
  readonly id: string;
  readonly action: string;
  readonly keys: string;
  readonly category: string;
}

export interface KeyBindingConflict {
  readonly binding1: KeyBinding;
  readonly binding2: KeyBinding;
  readonly conflictingKeys: string;
}

export class KeyBindingError extends Error {
  readonly _tag = "KeyBindingError";
  constructor(message: string) {
    super(message);
  }
}

function normalizeKeyCombo(keys: string): string {
  return keys
    .split("+")
    .map((k) => k.trim().toLowerCase())
    .sort()
    .join("+");
}

export function detectConflicts(bindings: ReadonlyArray<KeyBinding>): ReadonlyArray<KeyBindingConflict> {
  const keyMap = new Map<string, KeyBinding[]>();

  for (const binding of bindings) {
    const normalized = normalizeKeyCombo(binding.keys);
    const existing = keyMap.get(normalized) ?? [];
    existing.push(binding);
    keyMap.set(normalized, existing);
  }

  const conflicts: KeyBindingConflict[] = [];

  for (const [normalizedKey, conflictingBindings] of keyMap.entries()) {
    if (conflictingBindings.length > 1) {
      for (let i = 0; i < conflictingBindings.length - 1; i++) {
        for (let j = i + 1; j < conflictingBindings.length; j++) {
          conflicts.push({
            binding1: conflictingBindings[i],
            binding2: conflictingBindings[j],
            conflictingKeys: normalizedKey,
          });
        }
      }
    }
  }

  return conflicts;
}

export function parseKeySequence(input: string): string {
  const modifierOrder = ["ctrl", "alt", "shift", "meta", "cmd"];
  const tokens = input.split(/\s*\+\s*/);
  const modifiers: string[] = [];
  const keys: string[] = [];

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (modifierOrder.includes(lower)) {
      modifiers.push(lower === "cmd" ? "meta" : lower);
    } else if (lower.length > 0) {
      keys.push(token.toUpperCase());
    }
  }

  return [...modifiers.sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b)), ...keys].join("+");
}

export interface KeyBindingEditorShape {
  readonly getAllBindings: () => Effect.Effect<ReadonlyArray<KeyBinding>, never>;
  readonly updateBinding: (id: string, newKeys: string) => Effect.Effect<KeyBinding, KeyBindingError>;
  readonly resetBinding: (id: string) => Effect.Effect<KeyBinding, KeyBindingError>;
  readonly getConflicts: () => Effect.Effect<ReadonlyArray<KeyBindingConflict>, never>;
}

export class KeyBindingEditorService extends Context.Service<
  KeyBindingEditorService,
  KeyBindingEditorShape
>()("t3/keybindings/KeyBindingEditorService") {}
