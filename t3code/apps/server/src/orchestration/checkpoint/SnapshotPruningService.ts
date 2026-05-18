import { Effect, Schedule, Layer, Ref } from "effect";
import { SqliteClient } from "@effect/sql-sqlite-node";

export interface PruningConfig {
  retentionDays: number;
  keepMinimum: number;
  scheduleInterval: string;
}

export const DefaultPruningConfig: PruningConfig = {
  retentionDays: 7,
  keepMinimum: 3,
  scheduleInterval: "1 hour",
};

export interface SnapshotRecord {
  id: string;
  sessionId: string;
  createdAt: string;
}

export const SnapshotPruningService = Effect.gen(function* (_) {
  const sql = yield* _(SqliteClient.SqliteClient);
  const config = yield* _(Ref.make(DefaultPruningConfig));

  const pruneSnapshots = Effect.gen(function* (_) {
    const { retentionDays, keepMinimum } = yield* _(Ref.get(config));
    const cutoffDate = new Date(
      Date.now() - retentionDays * 24 * 60 * 60 * 1000
    ).toISOString();

    // Get sessions with snapshots older than retention period
    const sessions = yield* _(
      sql`SELECT sessionId FROM checkpoints WHERE createdAt < ${cutoffDate} GROUP BY sessionId`
    );

    let prunedCount = 0;

    for (const session of sessions) {
      // Get total snapshots for this session
      const total = yield* _(
        sql`SELECT COUNT(*) as count FROM checkpoints WHERE sessionId = ${session.sessionId}`
      );

      if (total[0].count > keepMinimum) {
        // Keep the N most recent, delete the rest that are older than cutoff
        const result = yield* _(
          sql`DELETE FROM checkpoints 
              WHERE sessionId = ${session.sessionId} 
              AND createdAt < ${cutoffDate}
              AND id NOT IN (
                SELECT id FROM checkpoints 
                WHERE sessionId = ${session.sessionId} 
                ORDER BY createdAt DESC 
                LIMIT ${keepMinimum}
              )`
        );
        prunedCount += result.rowsAffected;
      }
    }

    return { prunedCount, sessionsProcessed: sessions.length };
  });

  const startScheduledPruning = Effect.gen(function* (_) {
    const { scheduleInterval } = yield* _(Ref.get(config));
    const schedule = Schedule.spaced(scheduleInterval === "1 hour" ? 3600000 : 86400000);
    yield* _(
      Effect.repeat(pruneSnapshots, schedule),
      Effect.fork,
      Effect.annotateLogs("service", "SnapshotPruningService")
    );
  });

  const updateConfig = (newConfig: Partial<PruningConfig>) =>
    Ref.update(config, (c) => ({ ...c, ...newConfig }));

  const getStats = Effect.gen(function* (_) {
    const { retentionDays, keepMinimum } = yield* _(Ref.get(config));
    const total = yield* _(
      sql`SELECT COUNT(*) as count FROM checkpoints`
    );
    const oldest = yield* _(
      sql`SELECT MIN(createdAt) as oldest FROM checkpoints`
    );
    return {
      totalSnapshots: total[0].count,
      oldestSnapshot: oldest[0].oldest,
      retentionDays,
      keepMinimum,
    };
  });

  return { pruneSnapshots, startScheduledPruning, updateConfig, getStats };
});

export const SnapshotPruningLayer = Layer.effect(
  SnapshotPruningService,
  SnapshotPruningService
);
