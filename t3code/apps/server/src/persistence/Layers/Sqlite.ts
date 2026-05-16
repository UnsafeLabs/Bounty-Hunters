import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Context from "effect/Context";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { runMigrations } from "../Migrations.ts";
import { sqlitePoolDefaults } from "../SqlitePoolConfig.ts";
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

export interface SqliteHealthCheckResult {
  readonly ok: boolean;
  readonly details: ReadonlyArray<string>;
  readonly pool: {
    readonly min: number;
    readonly max: number;
    readonly acquireTimeoutMs: number;
  };
}

export interface SqliteHealthShape {
  readonly check: Effect.Effect<SqliteHealthCheckResult, SqlError>;
}

export class SqliteHealth extends Context.Service<SqliteHealth, SqliteHealthShape>()(
  "t3/persistence/Layers/Sqlite/SqliteHealth",
) {}

const poolHealth = {
  min: sqlitePoolDefaults.min,
  max: sqlitePoolDefaults.max,
  acquireTimeoutMs: 10_000,
} as const;

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
    const journalModeRows = yield* sql<{
      readonly journal_mode: string;
    }>`PRAGMA journal_mode = WAL;`;
    const journalMode = journalModeRows[0]?.journal_mode?.toLowerCase();
    if (journalMode !== "wal" && journalMode !== "memory") {
      return yield* Effect.die(
        `SQLite WAL startup verification failed: journal_mode=${journalMode}`,
      );
    }
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA synchronous = NORMAL;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    yield* runMigrations();
  }),
);

const SqliteHealthLive = Layer.effect(
  SqliteHealth,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      check: Effect.gen(function* () {
        const rows = yield* sql<{ readonly integrity_check: string }>`PRAGMA integrity_check;`;
        const details = rows.map((row) => row.integrity_check);
        return {
          ok: details.length === 1 && details[0] === "ok",
          details,
          pool: poolHealth,
        };
      }),
    };
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    Layer.mergeAll(setup, SqliteHealthLive),
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
  Layer.mergeAll(setup, SqliteHealthLive),
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
