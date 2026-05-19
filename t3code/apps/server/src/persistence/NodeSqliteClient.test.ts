import { assert, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
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

  it.effect("health check returns pass for an empty database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const result = yield* SqliteClient.healthCheck(sql);
      assert.equal(result.status, "pass");
    }),
  );

  it.effect("concurrent reads do not deadlock", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE concurrency(id INTEGER PRIMARY KEY, val INTEGER)`;
      yield* sql`INSERT INTO concurrency(val) VALUES (1), (2), (3), (4), (5)`;

      const readers = Effect.all(
        Array.from({ length: 10 }, (_, i) =>
          Effect.delay(
            Effect.gen(function* () {
              const rows = yield* sql<{ readonly id: number; readonly val: number }>`
                SELECT id, val FROM concurrency ORDER BY id
              `;
              assert.equal(rows.length, 5);
              return i;
            }),
            Duration.millis(i * 5),
          ),
        ),
        { concurrency: 5 },
      );

      const results = yield* readers;
      assert.equal(results.length, 10);
    }),
  );

  it.effect("concurrent writes do not deadlock with WAL mode", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`CREATE TABLE write_test(id INTEGER PRIMARY KEY, val INTEGER)`;

      const writers = Effect.all(
        Array.from({ length: 5 }, (_, i) =>
          Effect.gen(function* () {
            yield* sql`INSERT INTO write_test(val) VALUES (${i})`;
          }),
        ),
        { concurrency: 5 },
      );

      yield* writers;
      const rows = yield* sql<{ readonly id: number; readonly val: number }>`
        SELECT id, val FROM write_test ORDER BY id
      `;
      assert.equal(rows.length, 5);
    }),
  );
});
