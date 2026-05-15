// @effect-diagnostics nodeBuiltinImport:off
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layerMemory());

function makeTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3-sqlite-pool-"));
  return {
    dir,
    dbPath: path.join(dir, "state.sqlite"),
  };
}

const withTempDb = <A, E, R>(use: (dbPath: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(makeTempDb),
    ({ dbPath }) => use(dbPath),
    ({ dir }) =>
      Effect.sync(() => {
        fs.rmSync(dir, { recursive: true, force: true });
      }),
  );

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

it.effect("NodeSqliteClient configures WAL pragmas and health checks for file databases", () =>
  withTempDb((dbPath) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const client = yield* SqliteClient.SqliteClient;

      const journalMode = yield* sql<{ readonly journal_mode: string }>`
        PRAGMA journal_mode
      `;
      assert.equal(journalMode[0]?.journal_mode.toLowerCase(), "wal");

      const busyTimeout = yield* sql<{ readonly timeout: number }>`
        PRAGMA busy_timeout
      `;
      assert.equal(Number(busyTimeout[0]?.timeout), 5000);

      const synchronous = yield* sql<{ readonly synchronous: number }>`
        PRAGMA synchronous
      `;
      assert.equal(Number(synchronous[0]?.synchronous), 1);

      const health = yield* client.healthCheck;
      assert.deepEqual(health, { ok: true, details: ["ok"] });
    }).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath }))),
  ),
);

it.effect("NodeSqliteClient grows the file-backed pool from 1 to 5 connections on demand", () =>
  withTempDb((dbPath) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const client = yield* SqliteClient.SqliteClient;

      const initialStats = yield* client.poolStats;
      assert.equal(initialStats.minSize, 1);
      assert.equal(initialStats.maxSize, 5);
      assert.ok(initialStats.activeConnections >= 1);
      assert.ok(initialStats.activeConnections <= 5);

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.all(
            Array.from({ length: 5 }, () => sql.reserve),
            {
              concurrency: "unbounded",
              discard: true,
            },
          );

          const heldStats = yield* client.poolStats;
          assert.equal(heldStats.activeConnections, 5);
          assert.equal(heldStats.acquiredConnections, 5);
        }),
      );

      const stats = yield* client.poolStats;
      assert.equal(stats.activeConnections, 5);
      assert.equal(stats.availableConnections, 5);
      assert.equal(stats.acquiredConnections, 0);
    }).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath }))),
  ),
);

it.live("NodeSqliteClient times out connection acquisition when the pool is exhausted", () =>
  withTempDb((dbPath) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* sql.reserve;

          const result = yield* Effect.exit(sql`SELECT 1`);
          assert.equal(Exit.isFailure(result), true);
        }),
      );
    }).pipe(
      Effect.provide(
        SqliteClient.layer({
          filename: dbPath,
          pool: {
            maxSize: 1,
            acquireTimeout: "20 millis",
          },
        }),
      ),
    ),
  ),
);

it.effect(
  "NodeSqliteClient resets returned connections and handles concurrent reads and writes",
  () =>
    withTempDb((dbPath) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* sql`CREATE TABLE entries(id INTEGER PRIMARY KEY, value TEXT NOT NULL)`;

        yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* sql.reserve;
            yield* connection.executeUnprepared("BEGIN;", [], undefined);
            yield* connection.executeUnprepared(
              "INSERT INTO entries(id, value) VALUES (999, 'uncommitted');",
              [],
              undefined,
            );
          }),
        );

        const leakedRows = yield* sql<{ readonly id: number }>`
        SELECT id FROM entries WHERE id = 999
      `;
        assert.equal(leakedRows.length, 0);

        yield* Effect.all(
          Array.from({ length: 20 }, (_, index) =>
            index % 2 === 0
              ? sql`INSERT INTO entries(value) VALUES (${`value-${index}`})`
              : sql<{ readonly count: number }>`SELECT COUNT(*) AS count FROM entries`,
          ),
          { concurrency: "unbounded", discard: true },
        );

        const countRows = yield* sql<{ readonly count: number }>`
        SELECT COUNT(*) AS count FROM entries
      `;
        assert.equal(Number(countRows[0]?.count), 10);
      }).pipe(Effect.provide(SqliteClient.layer({ filename: dbPath }))),
    ),
);
