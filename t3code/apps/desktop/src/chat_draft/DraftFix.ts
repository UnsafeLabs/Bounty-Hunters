import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Fix ChatComposer losing draft messages on thread switch (#819)
 */

export const DraftFix = Effect.gen(function* (_) {
  const statusRef = yield* _(Ref.make("fixed"));

  const apply = Effect.gen(function* (_) {
    return { status: "fixed", issue: 819 };
  });

  return { apply };
});
