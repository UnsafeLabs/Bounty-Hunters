import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { FileSystem } from "effect/FileSystem";
import { Path } from "effect/Path";
import { ServerConfig } from "../../config.ts";
import { runMigrations } from "../Migrations.ts";

export interface PooledSqliteConfig {
  readonly filename: string;
  readonly poolSize?: number;
  readonly busyTimeoutMs?: number;
}

export const makePooledSqliteLayer = (config: PooledSqliteConfig) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem;
      const path = yield* Path;
      yield* fs.makeDirectory(path.dirname(config.filename), { recursive: true });

      const poolSize = config.poolSize ?? 5;
      const busyTimeout = config.busyTimeoutMs ?? 5000;

      const makeClient = Effect.gen(function* () {
        const runtime = process.versions.bun !== undefined ? "bun" : "node";
        const loader =
          runtime === "bun"
            ? () => import("@effect/sql-sqlite-bun/SqliteClient")
            : () => import("../NodeSqliteClient.ts");
        const clientModule = yield* Effect.promise<{
          layer: (config: any) => Layer.Layer<SqlClient.SqlClient>;
        }>(loader);

        const sql = yield* SqlClient.SqlClient;
        yield* sql`PRAGMA journal_mode = WAL;`;
        yield* sql`PRAGMA busy_timeout = ${busyTimeout};`;
        yield* sql`PRAGMA foreign_keys = ON;`;
        yield* runMigrations();

        return sql;
      });

      const pool = yield* Pool.make({
        capacity: poolSize,
        timeToLive: Duration.minutes(30),
        acquire: makeClient,
      });

      return Layer.succeed(SqlClient.SqlClient, pool);
    }),
  );

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) =>
    makePooledSqliteLayer({ filename: dbPath }),
  ),
);

import * as Duration from "effect/Duration";
