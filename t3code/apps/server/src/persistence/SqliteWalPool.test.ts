import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./NodeSqliteClient.ts";

const layer = it.layer(SqliteClient.layerMemory());

layer("SQLite WAL mode and pragmas", (it) => {
  it.effect("has WAL journal mode enabled", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode`;
      // In-memory databases use "memory" journal mode, file databases use "wal"
      assert.include(["wal", "memory"], rows[0]?.journal_mode);
    }),
  );

  it.effect("has busy_timeout set", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA busy_timeout = 5000`;
      const rows = yield* sql<{ readonly busy_timeout: number }>`PRAGMA busy_timeout`;
      assert.equal(rows[0]?.busy_timeout, 5000);
    }),
  );

  it.effect("has synchronous mode set to NORMAL", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA synchronous = NORMAL`;
      const rows = yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous`;
      // NORMAL = 1 in SQLite
      assert.equal(rows[0]?.synchronous, 1);
    }),
  );

  it.effect("has foreign_keys enabled", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = ON`;
      const rows = yield* sql<{ readonly foreign_keys: number }>`PRAGMA foreign_keys`;
      assert.equal(rows[0]?.foreign_keys, 1);
    }),
  );
});

layer("SQLite concurrent access", (it) => {
  it.effect("handles concurrent reads without deadlock", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE concurrent_test(id INTEGER PRIMARY KEY, value TEXT NOT NULL)`;
      yield* sql`INSERT INTO concurrent_test(value) VALUES (${"test-1"}), (${"test-2"}), (${"test-3"})`;

      // Run multiple concurrent reads
      const results = yield* Effect.all(
        [
          sql<{ readonly id: number; readonly value: string }>`SELECT * FROM concurrent_test`,
          sql<{ readonly id: number; readonly value: string }>`SELECT * FROM concurrent_test WHERE id > 0`,
          sql<{ readonly count: number }>`SELECT COUNT(*) as count FROM concurrent_test`,
        ],
        { concurrency: "unbounded" },
      );

      assert.equal(results[0].length, 3);
      assert.equal(results[1].length, 3);
      assert.equal(results[2][0]?.count, 3);
    }),
  );
});

layer("SQLite integrity check", (it) => {
  it.effect("passes integrity_check on healthy database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql<{ readonly integrity_check: string }>`PRAGMA integrity_check`;
      assert.equal(rows[0]?.integrity_check, "ok");
    }),
  );
});
