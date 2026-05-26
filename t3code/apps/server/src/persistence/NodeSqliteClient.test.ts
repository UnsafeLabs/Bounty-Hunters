import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layerMemory());
const fileLayer = it.layer(
  SqliteClient.layer({
    filename: `${
      process.env["TEMP"] ?? process.env["TMP"] ?? "."
    }/t3-sqlite-pool-${globalThis.crypto.randomUUID()}.sqlite`,
  }),
);

const firstPragmaValue = (row: Record<string, unknown> | undefined) =>
  Number(Object.values(row ?? {})[0] ?? 0);

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
});

fileLayer("NodeSqliteClient pooled file database", (it) => {
  it.effect("initializes WAL, busy timeout, and synchronous pragmas", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const journalMode = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode;`;
      const busyTimeout = yield* sql<Record<string, unknown>>`PRAGMA busy_timeout;`;
      const synchronous = yield* sql<Record<string, unknown>>`PRAGMA synchronous;`;

      assert.equal(journalMode[0]?.journal_mode, "wal");
      assert.equal(firstPragmaValue(busyTimeout[0]), 5000);
      assert.equal(firstPragmaValue(synchronous[0]), 1);
    }),
  );

  it.effect("exposes pool bounds and integrity health check", () =>
    Effect.gen(function* () {
      const client = yield* SqliteClient.SqliteClient;

      assert.equal(client.pool.config.minSize, SqliteClient.SQLITE_POOL_MIN_SIZE);
      assert.equal(client.pool.config.maxSize, SqliteClient.SQLITE_POOL_MAX_SIZE);

      const health = yield* client.healthCheck;
      assert.isTrue(health.ok);
      assert.deepEqual(health.details, ["ok"]);
    }),
  );

  it.effect("resets connections before returning them to the pool", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`PRAGMA foreign_keys = OFF;`;

      const foreignKeys = yield* sql<Record<string, unknown>>`PRAGMA foreign_keys;`;
      assert.equal(firstPragmaValue(foreignKeys[0]), 1);
    }),
  );

  it.effect("handles concurrent reads and writes without deadlock", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE concurrent_items(id INTEGER PRIMARY KEY, value TEXT NOT NULL)`;

      yield* Effect.all(
        Array.from(
          { length: 12 },
          (_, index) => sql`INSERT INTO concurrent_items(value) VALUES (${`item-${index}`})`,
        ),
        { concurrency: SqliteClient.SQLITE_POOL_MAX_SIZE },
      );

      const rows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM concurrent_items
      `;

      assert.equal(Number(rows[0]?.count), 12);
    }),
  );
});
