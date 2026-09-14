import * as Metric from "effect/Metric";

export const checkpointPruneSnapshotsTotal = Metric.counter(
  "t3_checkpoint_prune_snapshots_total",
  {
    description: "Total checkpoint snapshots deleted by retention pruning.",
  },
);

export const checkpointPruneBytesFreedTotal = Metric.counter(
  "t3_checkpoint_prune_bytes_freed_total",
  {
    description: "Estimated bytes freed by checkpoint snapshot pruning.",
  },
);

export const checkpointPruneDuration = Metric.timer("t3_checkpoint_prune_duration", {
  description: "Checkpoint snapshot pruning duration.",
});
