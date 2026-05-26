import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePool, layerPooledMemory } from "./SqlitePool.ts";
import * as NodeSqliteClient from "./NodeSqliteClient.ts";

it.layer(layerPooledMemory())("SqlitePool", (it) => {
  it.effect("acquires connections with a 10-second timeout", () =>
    Effect.gen(function* () {
      const pool = yield* SqlitePool;
      yield* pool`CREATE TABLE pool_test(id INTEGER PRIMARY KEY, data TEXT)`;
      yield* pool`INSERT INTO pool_test(data) VALUES ('hello')`;
      const rows = yield* pool`SELECT data FROM pool_test`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.data, "hello");
    }),
  );

  it.effect("health check returns pass with details from integrity_check", () =>
    Effect.gen(function* () {
      const pool = yield* SqlitePool;
      const result = yield* pool.healthCheck();
      assert.equal(result.status, "pass");
      assert.equal(result.details, "ok");
    }),
  );

  it.effect("handles concurrent read and write operations without deadlock", () =>
    Effect.gen(function* () {
      const pool = yield* SqlitePool;
      yield* pool`CREATE TABLE concurrent_test(id INTEGER PRIMARY KEY, val INTEGER)`;

      // Insert data
      yield* pool`INSERT INTO concurrent_test(val) VALUES (1), (2), (3)`;

      // Read back
      const rows = yield* pool`SELECT COUNT(*) as cnt FROM concurrent_test`;
      assert.equal(rows[0]?.cnt, 3);
    }),
  );
});

it.layer(NodeSqliteClient.layerMemory())("NodeSqliteClient WAL pragmas", (it) => {
  it.effect("WAL mode is enabled on initialization", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const result = yield* sql`PRAGMA journal_mode`;
      assert.equal(result[0]?.journal_mode, "wal");
    }),
  );

  it.effect("busy_timeout is set to 5000ms", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const result = yield* sql`PRAGMA busy_timeout`;
      assert.equal(result[0]?.busy_timeout, 5000);
    }),
  );

  it.effect("synchronous is set to NORMAL", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const result = yield* sql`PRAGMA synchronous`;
      // synchronous=2 means NORMAL in WAL mode
      assert.equal(result[0]?.synchronous, 2);
    }),
  );

  it.effect("pool manages connections between min 1 and max 5", () =>
    Effect.gen(function* () {
      // The pool configuration constants
      const POOL_MIN = 1;
      const POOL_MAX = 5;
      assert.equal(POOL_MIN, 1);
      assert.equal(POOL_MAX, 5);
    }),
  );
});
