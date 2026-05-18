import { Effect, Schema, Ref } from "effect";

export const KeyBinding = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  keyCombo: Schema.String,
  label: Schema.String,
  category: Schema.String,
  isEditable: Schema.Boolean,
});

export type KeyBindingType = Schema.Schema.Type<typeof KeyBinding>;

export const ConflictResult = Schema.Struct({
  hasConflict: Schema.Boolean,
  conflictingBindings: Schema.Array(KeyBinding),
});

export type ConflictResultType = Schema.Schema.Type<typeof ConflictResult>;

export const KeybindingManager = Effect.gen(function* (_) {
  const bindings = yield* _(Ref.make<Map<string, KeyBindingType>>(new Map()));

  const register = (binding: KeyBindingType) =>
    Effect.gen(function* (_) {
      yield* _(Ref.update(bindings, (m) => {
        const next = new Map(m);
        next.set(binding.id, binding);
        return next;
      }));
    });

  const updateKeyCombo = (id: string, newCombo: string) =>
    Effect.gen(function* (_) {
      const b = yield* _(Ref.get(bindings));
      const existing = b.get(id);
      if (!existing || !existing.isEditable) return null;

      // Check for conflicts
      const conflicts = [...b.values()].filter(
        (binding) => binding.keyCombo === newCombo && binding.id !== id
      );

      if (conflicts.length > 0) {
        // Warn but still allow — user can resolve
        yield* _(Ref.update(bindings, (m) => {
          const next = new Map(m);
          next.set(id, { ...existing, keyCombo: newCombo });
          return next;
        }));
        return { hasConflict: true, conflictingBindings: conflicts };
      }

      yield* _(Ref.update(bindings, (m) => {
        const next = new Map(m);
        next.set(id, { ...existing, keyCombo: newCombo });
        return next;
      }));
      return { hasConflict: false, conflictingBindings: [] };
    });

  const checkConflicts = Effect.gen(function* (_) {
    const b = yield* _(Ref.get(bindings));
    const comboMap = new Map<string, KeyBindingType[]>();

    for (const binding of b.values()) {
      const existing = comboMap.get(binding.keyCombo) || [];
      comboMap.set(binding.keyCombo, [...existing, binding]);
    }

    const conflicts: Array<{ keyCombo: string; bindings: KeyBindingType[] }> = [];
    for (const [combo, bList] of comboMap) {
      if (bList.length > 1) {
        conflicts.push({ keyCombo: combo, bindings: bList });
      }
    }

    return conflicts;
  });

  const getByCategory = (category: string) =>
    Effect.gen(function* (_) {
      const b = yield* _(Ref.get(bindings));
      return [...b.values()].filter((binding) => binding.category === category);
    });

  const getAll = Effect.gen(function* (_) {
    const b = yield* _(Ref.get(bindings));
    return [...b.values()].sort((a, b) => a.category.localeCompare(b.category));
  });

  const reset = (id: string) =>
    Effect.gen(function* (_) {
      // Reset to default (would need defaults registry)
      yield* _(Ref.update(bindings, (m) => {
        const next = new Map(m);
        next.delete(id);
        return next;
      }));
    });

  return { register, updateKeyCombo, checkConflicts, getByCategory, getAll, reset };
});
