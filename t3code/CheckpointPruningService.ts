/**
 * CheckpointPruningService - Checkpoint snapshot pruning with retention policy (#838)
 */

import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

export const PruningMetrics = Schema.Struct({
  snapshots_deleted: Schema.Number,
  bytes_freed: Schema.Number,
  duration_ms: Schema.Number,
  retention_days: Schema.Number,
  preserved_count: Schema.Number,
});
export type PruningMetrics = typeof PruningMetrics.Type;

export const PruningConfig = Schema.Struct({
  retentionDays: Schema.Number.pipe(Schema.positive()),
  minPreserved: Schema.Number.pipe(Schema.positive()),
});
export type PruningConfig = typeof PruningConfig.Type;

export const DefaultPruningConfig: PruningConfig = {
  retentionDays: 7,
  minPreserved: 3,
};

export class PruningError extends Schema.TaggedError<PruningError>()("PruningError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface CheckpointPruningService {
  readonly pruneSnapshots: (config?: Partial<PruningConfig>) => Effect.Effect<PruningMetrics, PruningError>;
  readonly getMetrics: () => Effect.Effect<PruningMetrics, PruningError>;
}

export const CheckpointPruningService = Context.GenericTag<CheckpointPruningService>(
  "@t3code/CheckpointPruningService"
);

interface DbClient {
  readonly exec: (sql: string, params?: unknown[]) => Effect.Effect<void, PruningError>;
  readonly query: <T>(sql: string, params?: unknown[]) => Effect.Effect<ReadonlyArray<T>, PruningError>;
}
const DbClient = Context.GenericTag<DbClient>("@t3code/DbClient");

const makePruningService = Effect.gen(function* (_) {
  const db = yield* _(DbClient);
  let lastMetrics: PruningMetrics = {
    snapshots_deleted: 0, bytes_freed: 0, duration_ms: 0, retention_days: 7, preserved_count: 0,
  };

  const pruneSnapshots: CheckpointPruningService["pruneSnapshots"] = (config) =>
    Effect.gen(function* (_) {
      const start = Date.now();
      const cfg = { ...DefaultPruningConfig, ...config };
      const cutoffDate = yield* _(
        Effect.map(DateTime.now, (now) => {
          const ms = DateTime.toDate(now).getTime() - cfg.retentionDays * 86400000;
          return new Date(ms).toISOString();
        })
      );

      interface SessionCount { session_id: string; total_count: number; }
      const sessions = yield* _(db.query<SessionCount>(
        "SELECT session_id, COUNT(*) as total_count FROM checkpoints GROUP BY session_id HAVING COUNT(*) > ?",
        [cfg.minPreserved]
      ));

      let totalDeleted = 0, totalBytesFreed = 0, totalPreserved = 0;

      for (const session of sessions) {
        interface PreservedId { id: string; }
        const preserved = yield* _(db.query<PreservedId>(
          "SELECT id FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
          [session.session_id, cfg.minPreserved]
        ));
        const preservedIds = preserved.map((r) => r.id);

        interface Candidate { id: string; size_bytes: number; }
        const ph = preservedIds.map(() => "?").join(",");
        const candidates = yield* _(db.query<Candidate>(
          `SELECT id, size_bytes FROM checkpoints WHERE session_id = ? AND created_at < ? AND id NOT IN (${ph})`,
          [session.session_id, cutoffDate, ...preservedIds]
        ));

        if (candidates.length > 0) {
          const ids = candidates.map((c) => c.id);
          const bytes = candidates.reduce((s, c) => s + (c.size_bytes || 0), 0);
          const dph = ids.map(() => "?").join(",");
          yield* _(db.exec(`DELETE FROM checkpoints WHERE id IN (${dph})`, ids));
          totalDeleted += candidates.length;
          totalBytesFreed += bytes;
        }
        totalPreserved += preservedIds.length;
      }

      lastMetrics = {
        snapshots_deleted: totalDeleted, bytes_freed: totalBytesFreed,
        duration_ms: Date.now() - start, retention_days: cfg.retentionDays, preserved_count: totalPreserved,
      };
      return lastMetrics;
    });

  const getMetrics = () => Effect.sync(() => lastMetrics);
  return CheckpointPruningService.of({ pruneSnapshots, getMetrics });
});

export const CheckpointPruningServiceLive = Layer.effect(CheckpointPruningService, makePruningService);

export const scheduledPruning = Effect.gen(function* (_) {
  const pruning = yield* _(CheckpointPruningService);
  yield* _(Effect.schedule(
    Effect.gen(function* (_) {
      const m = yield* _(pruning.pruneSnapshots());
      if (m.snapshots_deleted > 0)
        console.log(`[CheckpointPruning] Deleted ${m.snapshots_deleted}, freed ${m.bytes_freed}B in ${m.duration_ms}ms`);
    }),
    Schedule.fixed(Duration.hours(1))
  ));
});
