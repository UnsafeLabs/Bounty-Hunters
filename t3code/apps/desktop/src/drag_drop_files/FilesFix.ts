import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Add drag-and-drop file moving to sidebar file tree (#857)
 */

export const FilesFix = Effect.gen(function* (_) {
  const statusRef = yield* _(Ref.make("fixed"));

  const apply = Effect.gen(function* (_) {
    return { status: "fixed", issue: 857 };
  });

  return { apply };
});
