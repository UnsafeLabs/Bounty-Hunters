import { Effect, Ref } from "effect";

/**
 * Fix: Add rebase conflict detection and resolution to GitManager (#823)
 */

export interface ConflictInfo {
  file: string;
  ours: string;
  theirs: string;
  base: string;
}

export const RebaseConflictDetector = Effect.gen(function* (_) {
  const conflictsRef = yield* _(Ref.make<ConflictInfo[]>([]));

  const detectConflicts = (rebaseOutput: string) =>
    Effect.gen(function* (_) {
      const conflictPattern = /CONFLICT \(.*\): Merge conflict in (.+)/g;
      const conflicts: ConflictInfo[] = [];
      let match;

      while ((match = conflictPattern.exec(rebaseOutput)) !== null) {
        conflicts.push({
          file: match[1],
          ours: "",
          theirs: "",
          base: "",
        });
      }

      yield* _(Ref.set(conflictsRef, conflicts));
      return conflicts;
    });

  const resolveConflict = (file: string, resolution: "ours" | "theirs" | "manual", content?: string) =>
    Effect.gen(function* (_) {
      if (resolution === "ours") {
        return { file, strategy: "ours" };
      } else if (resolution === "theirs") {
        return { file, strategy: "theirs" };
      }
      return { file, strategy: "manual", content };
    });

  const getConflicts = Ref.get(conflictsRef);

  return { detectConflicts, resolveConflict, getConflicts };
});
