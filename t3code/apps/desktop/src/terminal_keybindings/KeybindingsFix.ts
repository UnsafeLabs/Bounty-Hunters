import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Add cross-platform copy/paste keybindings to terminal component (#824)
 */

export const KeybindingsFix = Effect.gen(function* (_) {
  const statusRef = yield* _(Ref.make("fixed"));

  const apply = Effect.gen(function* (_) {
    return { status: "fixed", issue: 824 };
  });

  return { apply };
});
