import { assert, it } from "@effect/vitest";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import type { PlatformError } from "effect/PlatformError";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { sqliteHealthCheck } from "./Layers/Sqlite.ts";
import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layerMemory());

layer("NodeSqliteClient", (it) => {
  it.effect("runs prepared queries and returns positional values", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"}), (${"beta"})`;

      const rows = yield* sql<{ readonly id: number; readonly name: string }>`
      SELECT id, name FROM entries ORDER BY id
    `;
      assert.equal(rows.length, 2);
      assert.equal(rows[0]?.name, "alpha");
      assert.equal(rows[1]?.name, "beta");

      const values = yield* sql`SELECT id, name FROM entries ORDER BY id`.values;
      assert.equal(values.length, 2);
      assert.equal(values[0]?.[1], "alpha");
      assert.equal(values[1]?.[1], "beta");
    }),
  );

  it.effect("keeps a single in-memory database across pooled acquisitions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE memory_entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO memory_entries(name) VALUES (${"alpha"})`;

      const rows = yield* sql<{ readonly name: string }>`
        SELECT name FROM memory_entries
      `;

      assert.deepEqual(rows, [{ name: "alpha" }]);
    }),
  );
});

const withTempSqlite = <A, E>(
  effect: (dbPath: string) => Effect.Effect<A, E, SqlClient.SqlClient>,
): Effect.Effect<A, E | PlatformError> => {
  const nodePlatform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

  return Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-sqlite-" });
      const dbPath = path.join(dir, "state.sqlite");

      return yield* effect(dbPath).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath })));
    }),
  ).pipe(Effect.provide(nodePlatform));
};

it.effect("NodeSqliteClient file databases enable WAL and contention PRAGMAs", () =>
  withTempSqlite(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql`INSERT INTO entries(name) VALUES (${"alpha"})`;

      const journalMode = yield* sql<Record<string, unknown>>`PRAGMA journal_mode`;
      const busyTimeout = yield* sql<Record<string, unknown>>`PRAGMA busy_timeout`;
      const synchronous = yield* sql<Record<string, unknown>>`PRAGMA synchronous`;

      assert.equal(String(Object.values(journalMode[0] ?? {})[0]).toLowerCase(), "wal");
      assert.equal(Number(Object.values(busyTimeout[0] ?? {})[0]), 5000);
      assert.equal(Number(Object.values(synchronous[0] ?? {})[0]), 1);
    }),
  ),
);

it.effect("NodeSqliteClient handles concurrent writes through pooled file connections", () =>
  withTempSqlite(() =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE writes(id INTEGER PRIMARY KEY, value INTEGER NOT NULL)`;
      yield* Effect.all(
        Array.from({ length: 20 }, (_, index) => sql`INSERT INTO writes(value) VALUES (${index})`),
        { concurrency: 5, discard: true },
      );

      const rows = yield* sql<Record<string, unknown>>`SELECT COUNT(*) AS count FROM writes`;
      assert.equal(Number(Object.values(rows[0] ?? {})[0]), 20);
    }),
  ),
);

it.effect("sqliteHealthCheck reports PRAGMA integrity_check details", () =>
  withTempSqlite(() =>
    Effect.gen(function* () {
      const result = yield* sqliteHealthCheck();

      assert.equal(result.ok, true);
      assert.deepEqual(result.details, ["ok"]);
    }),
  ),
);
