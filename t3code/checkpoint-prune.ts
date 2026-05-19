/**
 * checkpoint:prune CLI command (#838)
 */

import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import { Flag } from "effect/unstable/cli";
import * as Schema from "effect/Schema";
import { CheckpointPruningService } from "./CheckpointPruningService.js";

export const daysFlag = Flag.integer("days").pipe(
  Flag.withSchema(Schema.Number.pipe(Schema.positive())),
  Flag.withDescription("Retention period in days (default: 7)"),
  Flag.optional,
);

export const checkpointPruneCommand = Effect.gen(function* (_) {
  const pruning = yield* _(CheckpointPruningService);
  return {
    name: "checkpoint:prune",
    description: "Manually trigger checkpoint snapshot pruning",
    flags: [daysFlag],
    handler: Effect.gen(function* (_) {
      const days = yield* _(daysFlag);
      const config = days._tag === "Some" ? { retentionDays: days.value } : {};
      const metrics = yield* _(pruning.pruneSnapshots(config));
      yield* _(Console.log(
        `Pruning complete:\n` +
        `  Snapshots deleted: ${metrics.snapshots_deleted}\n` +
        `  Bytes freed: ${metrics.bytes_freed}\n` +
        `  Duration: ${metrics.duration_ms}ms\n` +
        `  Retention: ${metrics.retention_days} days\n` +
        `  Preserved: ${metrics.preserved_count} recent snapshots`
      ));
    }),
  };
});
