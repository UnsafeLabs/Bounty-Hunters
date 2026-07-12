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
  bun: () => import("../BunSqliteClient.ts"),
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

export const sqliteHealthCheck = Effect.fn("sqliteHealthCheck")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<Record<string, unknown>>`PRAGMA integrity_check;`;
  const details = rows.map((row) => String(Object.values(row)[0] ?? ""));

  return {
    ok: details.length === 1 && details[0]?.toLowerCase() === "ok",
    details,
  };
});

const setup = (verifyWal: boolean) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const journalMode = yield* sql<Record<string, unknown>>`PRAGMA journal_mode = WAL;`;
      yield* sql`PRAGMA busy_timeout = 5000;`;
      yield* sql`PRAGMA synchronous = NORMAL;`;
      yield* sql`PRAGMA foreign_keys = ON;`;

      const mode = String(Object.values(journalMode[0] ?? {})[0] ?? "").toLowerCase();
      if (verifyWal && mode !== "wal") {
        return yield* Effect.die(
          new Error(`SQLite WAL mode verification failed: ${mode || "unknown"}`),
        );
      }

      yield* runMigrations();
    }),
  );

const isMemoryDatabase = (filename: string) => filename === ":memory:";

const makeSetupLayer = (filename: string) => setup(!isMemoryDatabase(filename));

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    makeSetupLayer(dbPath),
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
  makeSetupLayer(":memory:"),
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
