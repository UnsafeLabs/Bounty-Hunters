import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Duration from "effect/Duration";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

/** Pool sizing for concurrent SQLite access (issue #858). */
export const SQLITE_POOL_MIN = 1;
export const SQLITE_POOL_MAX = 5;
export const SQLITE_POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

/**
 * Apply WAL + contention PRAGMAs, verify journal mode, run migrations.
 * - WAL: concurrent readers + one writer
 * - busy_timeout=5000: wait before SQLITE_BUSY
 * - synchronous=NORMAL: WAL-safe write performance
 */
const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA synchronous = NORMAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;

    const modeRows = yield* sql<{ journal_mode: string }>`PRAGMA journal_mode;`;
    const mode = String(modeRows[0]?.journal_mode ?? "").toLowerCase();
    // File DBs must be WAL; :memory: commonly reports "memory"
    if (mode !== "wal" && mode !== "memory") {
      return yield* Effect.fail(new Error(`Expected WAL journal mode, got: ${mode}`));
    }

    yield* runMigrations();
  }),
);

/** On-demand integrity check for ops health endpoints. */
export const sqliteIntegrityCheck = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ integrity_check: string }>`PRAGMA integrity_check;`;
  const detail = rows.map((r) => r.integrity_check).join("; ");
  const parts = detail.split(";").map((p) => p.trim().toLowerCase()).filter(Boolean);
  const pass = parts.length > 0 && parts.every((p) => p === "ok");
  return { pass, detail } as const;
});

/**
 * Bounded concurrent access to the SqlClient (min intent 1, max 5 permits).
 * Acquire waits up to 10 seconds — models Effect.Pool get timeout semantics
 * for a single-file SQLite process where connections share one writer.
 */
export const makeSqliteConnectionPool = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sem = yield* Semaphore.make(SQLITE_POOL_MAX);

  // Warm min permits path with a ping so first callers do not pay cold start alone
  for (let i = 0; i < SQLITE_POOL_MIN; i++) {
    yield* sql`SELECT 1;`;
  }

  const get = <A, E, R>(use: (client: SqlClient.SqlClient) => Effect.Effect<A, E, R>) =>
    sem.withPermits(1)(
      Effect.gen(function* () {
        // Reset/live check before handing out the client
        yield* sql`SELECT 1;`;
        return yield* use(sql);
      }),
    ).pipe(
      Effect.timeoutFail({
        duration: SQLITE_POOL_ACQUIRE_TIMEOUT,
        onTimeout: () => new Error("SQLite pool acquire timeout (10s)"),
      }),
    );

  return {
    min: SQLITE_POOL_MIN,
    max: SQLITE_POOL_MAX,
    get,
  } as const;
});

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup,
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
