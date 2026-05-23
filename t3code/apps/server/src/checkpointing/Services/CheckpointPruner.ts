import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import type { CheckpointRef } from "@t3tools/contracts";

export interface RetentionPolicy {
  readonly maxAgeDays?: number;
  readonly maxCount?: number;
  readonly minKeep?: number;
}

export interface CheckpointPrunerShape {
  readonly prune: (cwd: string, policy: RetentionPolicy) => Effect.Effect<number, never>;
  readonly listPrunable: (cwd: string, policy: RetentionPolicy) => Effect.Effect<CheckpointRef[], never>;
}

export class CheckpointPruner extends Context.Service<CheckpointPruner, CheckpointPrunerShape>()(
  "t3/checkpointing/CheckpointPruner",
) {}

export const makeCheckpointPruner = Effect.gen(function* () {
  const prune: CheckpointPrunerShape["prune"] = (cwd, policy) =>
    Effect.gen(function* () {
      const now = Date.now();
      const cutoffMs = policy.maxAgeDays
        ? now - policy.maxAgeDays * 24 * 60 * 60 * 1000
        : 0;

      // Get all checkpoint refs
      const store = yield* Context.Service(CheckpointStore);
      const allRefs = yield* store.listCheckpoints({ cwd });

      let prunable = allRefs;

      // Apply age policy
      if (cutoffMs > 0) {
        prunable = prunable.filter((ref) => ref.createdAt < cutoffMs);
      }

      // Apply count policy (keep most recent N)
      if (policy.maxCount && prunable.length > policy.maxCount) {
        const sorted = [...prunable].sort((a, b) => b.createdAt - a.createdAt);
        prunable = sorted.slice(policy.maxCount);
      }

      // Respect minimum keep
      const minKeep = policy.minKeep ?? 1;
      const toPrune = prunable.slice(0, Math.max(0, prunable.length - minKeep));

      if (toPrune.length > 0) {
        yield* store.deleteCheckpointRefs({
          cwd,
          checkpointRefs: toPrune.map((r) => r.ref),
        });
      }

      return toPrune.length;
    });

  const listPrunable: CheckpointPrunerShape["listPrunable"] = (cwd, policy) =>
    Effect.succeed([]); // Simplified for initial implementation

  return { prune, listPrunable } satisfies CheckpointPrunerShape;
});

// Import alias for context lookup
import { CheckpointStore, type CheckpointStoreShape } from "./CheckpointStore.ts";
const CheckpointStore: Context.Tag<CheckpointStore, CheckpointStoreShape> = CheckpointStore;
