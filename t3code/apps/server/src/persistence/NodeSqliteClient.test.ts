import { assert, it } from "@effect/vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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
});

const makeTempDbPath = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-sqlite-pool-"));
  return path.join(dir, "test.sqlite");
};

it.layer(
  Layer.mergeAll(SqliteClient.layer({
    filename: makeTempDbPath(),
    poolMin: 1,
    poolMax: 1,
    acquireTimeout: "10 seconds",
  })),
)(
  "NodeSqliteClient file-backed pooling",
  (it) => {
    it.effect("initializes WAL, busy timeout, synchronous NORMAL, and health check", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const health = yield* SqliteClient.SqliteHealth;

        const journalMode = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode;`;
        const busyTimeout = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout;`;
        const synchronous = yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous;`;
        const healthResult = yield* health.check;

        assert.equal(journalMode[0]?.journal_mode, "wal");
        assert.equal(busyTimeout[0]?.timeout, 5000);
        assert.equal(synchronous[0]?.synchronous, 1);
        assert.deepStrictEqual(healthResult, { ok: true, details: ["ok"] });
      }),
    );

    it.effect("resets pooled connections before reuse", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* sql`PRAGMA busy_timeout = 1;`;

        const busyTimeout = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout;`;
        assert.equal(busyTimeout[0]?.timeout, 5000);
      }),
    );

    it.effect("handles concurrent reads and writes without deadlock", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* sql`CREATE TABLE concurrent_entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;

        yield* Effect.forEach(
          Array.from({ length: 25 }, (_, index) => index),
          (index) => sql`INSERT INTO concurrent_entries(name) VALUES (${`entry-${index}`})`,
          { concurrency: 5, discard: true },
        );

        const rows = yield* Effect.forEach(
          Array.from({ length: 5 }, () => undefined),
          () => sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM concurrent_entries`,
          { concurrency: 5 },
        );

        assert.deepStrictEqual(
          rows.map((result) => result[0]?.count),
          [25, 25, 25, 25, 25],
        );
      }),
    );
  },
);
