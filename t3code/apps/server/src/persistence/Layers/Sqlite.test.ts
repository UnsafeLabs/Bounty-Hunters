// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { PlatformError } from "effect/PlatformError";
import type { MigrationError } from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { makeSqlitePersistenceLive, SqliteHealth } from "./Sqlite.ts";

const makeDbPath = () =>
  path.join(fs.mkdtempSync(path.join(os.tmpdir(), "t3-sqlite-")), "app.sqlite");

const hasNodeSqlite = () => {
  const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
  return (major === 22 && minor >= 16) || (major === 23 && minor >= 11) || major >= 24;
};

const hasSqliteRuntime = process.versions.bun !== undefined || hasNodeSqlite();
type SqliteTestLayerError = SqlError | MigrationError | PlatformError;
const testLayer: Layer.Layer<SqlClient.SqlClient | SqliteHealth, SqliteTestLayerError> =
  hasSqliteRuntime
    ? makeSqlitePersistenceLive(makeDbPath()).pipe(Layer.provide(NodeServices.layer))
    : (Layer.empty as unknown as Layer.Layer<
        SqlClient.SqlClient | SqliteHealth,
        SqliteTestLayerError
      >);
const layer = it.layer(testLayer);

layer("Sqlite persistence", (it) => {
  const sqliteIt = hasSqliteRuntime ? it.effect : it.effect.skip;

  sqliteIt("enables WAL mode and startup pragmas", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const journalModeRows = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode;`;
      const busyTimeoutRows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout;`;
      const synchronousRows = yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous;`;

      assert.equal(journalModeRows[0]?.journal_mode, "wal");
      assert.equal(busyTimeoutRows[0]?.timeout, 5000);
      assert.equal(synchronousRows[0]?.synchronous, 1);
    }),
  );

  sqliteIt("reports integrity_check health details and pool sizing", () =>
    Effect.gen(function* () {
      const health = yield* SqliteHealth;

      const result = yield* health.check;

      assert.equal(result.ok, true);
      assert.deepEqual(result.details, ["ok"]);
      assert.deepEqual(result.pool, {
        min: 1,
        max: 5,
        acquireTimeoutMs: 10_000,
      });
    }),
  );

  sqliteIt("resets connection pragmas before returning a pooled connection", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`PRAGMA busy_timeout = 1;`;

      const busyTimeoutRows = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout;`;
      assert.equal(busyTimeoutRows[0]?.timeout, 5000);
    }),
  );

  sqliteIt("handles concurrent reads and writes without deadlock", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE concurrent_access(id INTEGER PRIMARY KEY, value TEXT NOT NULL);`;

      const writes = Array.from(
        { length: 20 },
        (_, index) => sql`INSERT INTO concurrent_access(value) VALUES (${`value-${index}`});`,
      );
      const reads = Array.from(
        { length: 20 },
        () => sql`SELECT COUNT(*) AS count FROM concurrent_access;`,
      );

      yield* Effect.all([...writes, ...reads], { concurrency: "unbounded" });

      const rows = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM concurrent_access;`;
      assert.equal(rows[0]?.count, 20);
    }),
  );
});
