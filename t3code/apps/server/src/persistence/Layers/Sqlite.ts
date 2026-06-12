import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
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

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA journal_mode = WAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA synchronous = NORMAL;`;

    // Verify WAL mode is active
    const walCheck = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode;`;
    const mode = walCheck[0]?.journal_mode;
    if (mode?.toLowerCase() !== "wal") {
      yield* Effect.logWarning(
        `Expected SQLite journal_mode=wal but got "${mode}". Database may not support concurrent reads/writes.`,
      );
    }

    yield* runMigrations();
  }),
);

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

/**
 * Health check that runs SQLite PRAGMA integrity_check.
 * Returns `{ pass: true, details: "ok" }` when the database is intact,
 * or `{ pass: false, details: <error messages> }` on corruption.
 */
export const sqliteHealthCheck = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly integrity_check: string }>`PRAGMA integrity_check;`;
  const details = rows.map((r) => r.integrity_check).join("\n");
  const pass = rows.length === 1 && rows[0]?.integrity_check === "ok";
  return { pass, details } as const;
});
