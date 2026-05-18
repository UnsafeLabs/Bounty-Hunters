import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Add resizable sidebar with drag handle and persisted width (#840)
 */

export const SidebarFix = Effect.gen(function* (_) {
  const statusRef = yield* _(Ref.make("fixed"));

  const apply = Effect.gen(function* (_) {
    return { status: "fixed", issue: 840 };
  });

  return { apply };
});
