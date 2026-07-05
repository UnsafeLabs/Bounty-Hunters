import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Exit from "effect/Exit";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "./NodeSqliteClient.ts";
import { sqliteHealthCheck } from "./sqliteHealthCheck.ts";

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

const makeTempDbPath = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-node-sqlite-" });
  return path.join(directory, "state.sqlite");
});

const withFileSqlite = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config: Omit<SqliteClient.SqliteClientConfig, "filename"> = {},
) =>
  Effect.gen(function* () {
    const filename = yield* makeTempDbPath;
    return yield* effect.pipe(
      Effect.provide(
        SqliteClient.layer({
          ...config,
          filename,
        }),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

it.effect(
  "enables WAL, busy timeout, synchronous normal, and health checks for file databases",
  () =>
    withFileSqlite(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const journalMode = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode`;
        assert.equal(journalMode[0]?.journal_mode.toLowerCase(), "wal");

        const busyTimeout = yield* sql<{ readonly timeout: number }>`PRAGMA busy_timeout`;
        assert.equal(Number(busyTimeout[0]?.timeout), 5000);

        const synchronous = yield* sql<{ readonly synchronous: number }>`PRAGMA synchronous`;
        assert.equal(Number(synchronous[0]?.synchronous), 1);

        const health = yield* sqliteHealthCheck();
        assert.deepStrictEqual(health, { ok: true, details: ["ok"] });
      }),
    ),
);

it.effect("supports concurrent file-backed writes through the connection pool", () =>
  withFileSqlite(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE pooled_entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* Effect.all(
        Array.from(
          { length: 20 },
          (_, index) => sql`INSERT INTO pooled_entries(name) VALUES (${`entry-${index}`})`,
        ),
        { concurrency: "unbounded", discard: true },
      );

      const rows = yield* sql<{
        readonly count: number;
      }>`SELECT COUNT(*) AS count FROM pooled_entries`;
      assert.equal(Number(rows[0]?.count), 20);
    }),
  ),
);

it.effect("keeps transactions scoped to one pooled file connection", () =>
  withFileSqlite(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`CREATE TABLE transactional_entries(id INTEGER PRIMARY KEY, name TEXT NOT NULL)`;
      yield* sql.withTransaction(
        sql`INSERT INTO transactional_entries(name) VALUES (${"committed"})`,
      );

      const rollbackExit = yield* Effect.exit(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO transactional_entries(name) VALUES (${"rolled-back"})`;
            return yield* Effect.fail("rollback");
          }),
        ),
      );
      assert.equal(Exit.isFailure(rollbackExit), true);

      const rows = yield* sql<{
        readonly name: string;
      }>`SELECT name FROM transactional_entries ORDER BY id`;
      assert.deepStrictEqual(
        rows.map((row) => row.name),
        ["committed"],
      );
    }),
  ),
);

it.effect(
  "supports multiple scoped reservations when the file-backed pool is configured above one",
  () =>
    withFileSqlite(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        const firstScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void).pipe(Effect.ignore),
        );
        const secondScope = yield* Effect.acquireRelease(Scope.make(), (scope) =>
          Scope.close(scope, Exit.void).pipe(Effect.ignore),
        );

        yield* Scope.provide(sql.reserve, firstScope);
        yield* Scope.provide(sql.reserve, secondScope);
      }),
      { poolMaxSize: 2 },
    ),
);
