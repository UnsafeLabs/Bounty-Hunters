/**
 * CheckpointPruningScheduler - Automatic hourly checkpoint snapshot pruning.
 *
 * When provided as a layer, forks a background fiber that runs checkpoint
 * pruning every hour. Errors are logged and do not interrupt the schedule.
 *
 * This layer requires CheckpointStore to be provided in the dependency graph.
 *
 * @module CheckpointPruningScheduler
 */
import * as Context from "effect/Context";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";

import { CheckpointStore } from "../Services/CheckpointStore.ts";

/**
 * Service tag for the pruning scheduler. Exists only to anchor the layer.
 */
export class CheckpointPruningScheduler extends Context.Service<
  CheckpointPruningScheduler,
  {}
>()("t3/checkpointing/Layers/CheckpointPruningScheduler") {}

/**
 * Run a single pruning pass in the current working directory.
 * Silently handles errors so a failure in one pass does not affect the next.
 */
const runPruningPass = Effect.fn("CheckpointPruningScheduler.runPruningPass")(function* () {
  const checkpointStore = yield* CheckpointStore;
  const cwd = globalThis.process.cwd();

  const result = yield* checkpointStore.pruneSnapshots({ cwd }).pipe(
    Effect.catchAll((error) =>
      Effect.succeed({
        snapshotsDeleted: -1,
        bytesFreed: 0,
        durationMs: 0,
        errorMessage: error.message ?? String(error),
      }),
    ),
  );

  if ((result as any).errorMessage) {
    yield* Console.log(
      `[CheckpointPruning] Skipped for ${cwd}: ${(result as any).errorMessage}`,
    );
  } else if (result.snapshotsDeleted > 0) {
    yield* Console.log(
      `[CheckpointPruning] Pruned ${result.snapshotsDeleted} snapshot(s) ` +
        `(freed ${(result.bytesFreed / 1024).toFixed(1)} KB) ` +
        `in ${result.durationMs} ms for ${cwd}`,
    );
  }
});

const make = Effect.fn("CheckpointPruningScheduler.make")(function* () {
  // Fork the pruning loop as a scoped fiber so it is cleaned up with the layer
  yield* runPruningPass().pipe(
    Effect.repeat(Schedule.fixed(Duration.hours(1))),
    Effect.ignoreLog,
    Effect.forkScoped,
  );
  return CheckpointPruningScheduler.of({});
});

/**
 * Layer that starts the background pruning scheduler.
 * Requires CheckpointStore to be provided in the dependency graph.
 */
export const layer = Layer.effect(CheckpointPruningScheduler, make);
