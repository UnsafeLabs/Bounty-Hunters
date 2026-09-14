import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as References from "effect/References";
import { Command, Flag, GlobalFlag } from "effect/unstable/cli";

import { ServerConfig } from "../config.ts";
import { CheckpointPruning } from "../checkpointing/Services/CheckpointPruning.ts";
import { CheckpointPruningLive } from "../checkpointing/Layers/CheckpointPruning.ts";
import { layerConfig as SqlitePersistenceLayerLive } from "../persistence/Layers/Sqlite.ts";
import { authLocationFlags, resolveCliAuthConfig } from "./config.ts";

const daysFlag = Flag.integer("days").pipe(
  Flag.withDescription("Retention period in days. Snapshots older than this are pruned (default 7)."),
  Flag.withDefault(7),
);

const jsonFlag = Flag.boolean("json").pipe(
  Flag.withDescription("Emit JSON instead of human-readable output."),
  Flag.withDefault(false),
);

const pruneCommand = Command.make("prune", {
  ...authLocationFlags,
  days: daysFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription(
    "Prune checkpoint snapshots older than the retention period (alias of checkpoint:prune).",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      const retentionDays = flags.days;
      if (!Number.isInteger(retentionDays) || retentionDays < 0) {
        return yield* Effect.fail(
          new Error(`Invalid --days value ${retentionDays}: expected a non-negative integer.`),
        );
      }
      const minimumLogLevel = flags.json ? "Error" : config.logLevel;
      const runtime = Layer.mergeAll(CheckpointPruningLive, SqlitePersistenceLayerLive).pipe(
        Layer.provide(Layer.succeed(ServerConfig, config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      );
      const result = yield* Effect.gen(function* () {
        const pruning = yield* CheckpointPruning;
        return yield* pruning.pruneSnapshots({ retentionDays });
      }).pipe(Effect.provide(runtime));
      if (flags.json) {
        yield* Console.log(
          JSON.stringify({
            snapshotsDeleted: result.snapshotsDeleted,
            bytesFreed: result.bytesFreed,
            durationMs: result.durationMs,
            sessionsScanned: result.sessionsScanned,
            retentionDays,
          }),
        );
      } else {
        yield* Console.log(
          `Pruned ${result.snapshotsDeleted} snapshot(s) older than ${retentionDays} day(s) ` +
            `across ${result.sessionsScanned} session(s), ` +
            `freeing ~${result.bytesFreed} bytes in ${result.durationMs}ms.`,
        );
      }
    }),
  ),
);

export const checkpointCommand = Command.make("checkpoint").pipe(
  Command.withDescription("Manage checkpoint snapshots (includes checkpoint:prune)."),
  Command.withSubcommands([pruneCommand]),
);

/**
 * Backwards-compatible alias matching the `checkpoint:prune` name from the
 * bounty acceptance criteria. Registered alongside `checkpoint prune`.
 */
export const checkpointPruneAliasCommand = Command.make("checkpoint:prune", {
  ...authLocationFlags,
  days: daysFlag,
  json: jsonFlag,
}).pipe(
  Command.withDescription("Prune checkpoint snapshots older than the retention period."),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      const retentionDays = flags.days;
      if (!Number.isInteger(retentionDays) || retentionDays < 0) {
        return yield* Effect.fail(
          new Error(`Invalid --days value ${retentionDays}: expected a non-negative integer.`),
        );
      }
      const minimumLogLevel = flags.json ? "Error" : config.logLevel;
      const runtime = Layer.mergeAll(CheckpointPruningLive, SqlitePersistenceLayerLive).pipe(
        Layer.provide(Layer.succeed(ServerConfig, config)),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, minimumLogLevel)),
      );
      const result = yield* Effect.gen(function* () {
        const pruning = yield* CheckpointPruning;
        return yield* pruning.pruneSnapshots({ retentionDays });
      }).pipe(Effect.provide(runtime));
      if (flags.json) {
        yield* Console.log(
          JSON.stringify({
            snapshotsDeleted: result.snapshotsDeleted,
            bytesFreed: result.bytesFreed,
            durationMs: result.durationMs,
            sessionsScanned: result.sessionsScanned,
            retentionDays,
          }),
        );
      } else {
        yield* Console.log(
          `Pruned ${result.snapshotsDeleted} snapshot(s) older than ${retentionDays} day(s) ` +
            `across ${result.sessionsScanned} session(s), ` +
            `freeing ~${result.bytesFreed} bytes in ${result.durationMs}ms.`,
        );
      }
    }),
  ),
);
