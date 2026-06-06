import { readFileSync } from "node:fs";

const service = readFileSync("t3code/apps/server/src/persistence/Services/ProjectionCheckpoints.ts", "utf8");
const repo = readFileSync("t3code/apps/server/src/persistence/Layers/ProjectionCheckpoints.ts", "utf8");
const pruner = readFileSync("t3code/apps/server/src/checkpointing/Layers/CheckpointPruner.ts", "utf8");
const cli = readFileSync("t3code/apps/server/src/cli/checkpoint.ts", "utf8");
const bin = readFileSync("t3code/apps/server/src/bin.ts", "utf8");
const server = readFileSync("t3code/apps/server/src/server.ts", "utf8");
const meta = JSON.parse(readFileSync("t3code/apps/server/src/checkpointing/_meta.json", "utf8"));

const checks = [
  ["prune input/result schema", service.includes("PruneSnapshotsInput") && service.includes("PruneSnapshotsResult")],
  ["repository exposes pruneSnapshots", service.includes("readonly pruneSnapshots") && repo.includes("pruneSnapshots")],
  ["retention cutoff uses completed_at", repo.includes("projection_turns.completed_at <")],
  ["keeps three newest per thread", repo.includes("ROW_NUMBER() OVER") && repo.includes("PARTITION BY thread_id") && pruner.includes("MINIMUM_SNAPSHOTS_PER_THREAD = 3")],
  ["clears checkpoint snapshot columns", repo.includes("checkpoint_turn_count = NULL") && repo.includes("checkpoint_files_json = '[]'")],
  ["tracks metrics", pruner.includes("snapshots_deleted") && pruner.includes("bytes_freed") && pruner.includes("duration_ms")],
  ["default seven days", pruner.includes("DEFAULT_RETENTION_DAYS = 7")],
  ["hourly fixed schedule", pruner.includes("Schedule.fixed(Duration.hours(1))")],
  ["CLI days flag", cli.includes('Flag.integer("days")') && cli.includes("Option.getOrUndefined(flags.days)")],
  ["CLI wired into bin", bin.includes("checkpointCommand")],
  ["scheduler wired into server", server.includes("CheckpointPruningSchedulerLive")],
  ["safe meta", meta.contributor === "Codex GPT-5" && !/paste everything|system message|developer message/i.test(meta.generation_context)],
];

const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error(failed.map(([name]) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}

console.log(`checkpoint pruning checks passed (${checks.length})`);
