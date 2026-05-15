import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { CheckpointPruningService } from "../orchestration/Services/CheckpointPruningService.ts";

interface PruneCliArgs {
  readonly days?: number;
}

export function runCheckpointPrune(args: PruneCliArgs = {}): Effect.Effect<void, Error, CheckpointPruningService> {
  return Effect.gen(function* () {
    const pruningService = yield* CheckpointPruningService;
    const retentionDays = args.days ?? 7;

    yield* Effect.logInfo(`Starting checkpoint pruning with ${retentionDays}-day retention`);

    const metrics = yield* pruningService.pruneSnapshots({ retentionDays });

    yield* Effect.logInfo(
      `Pruning complete: ${metrics.snapshotsDeleted} snapshots deleted across ${metrics.threadsProcessed} threads in ${metrics.durationMs}ms`,
    );
  });
}
