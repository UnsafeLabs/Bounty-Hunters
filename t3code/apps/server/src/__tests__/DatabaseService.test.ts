/**
 * DatabaseService tests — pool lifecycle, concurrent queries, WAL mode check.
 */
import { it, describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";

import {
  DatabaseService,
  makeDatabaseServiceLayer,
} from "../services/DatabaseService.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a test layer backed by an in-memory SQLite database with a pool of 2. */
const testLayer = (poolSize = 2) =>
  makeDatabaseServiceLayer({ filename: ":memory:", poolSize });

/** Run a query via the service and return rows. */
const runQuery = (sql: string, params?: ReadonlyArray<unknown>) =>
  Effect.flatMap(
    DatabaseService,
    (svc) => svc.query(sql, params),
  );

/** Execute a statement via the service. */
const runExec = (sql: string, params?: ReadonlyArray<unknown>) =>
  Effect.flatMap(
    DatabaseService,
    (svc) => svc.exec(sql, params),
  );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DatabaseService", () => {
  describe("pool lifecycle", () => {
    it.effect("should create a pool, execute queries, and shut down gracefully", () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(2);
            yield* Scope.extend(layer, scope);
            yield* Scope.addFinalizer(scope, Layer.toRuntime(layer).pipe(Effect.asVoid));

            // Use the pool
            yield* runExec("CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, name TEXT)");
            yield* runExec("INSERT INTO test (name) VALUES (?)", ["hello"]);

            const rows = yield* runQuery("SELECT * FROM test");
            expect(rows).toEqual([{ id: 1, name: "hello" }]);

            return "ok";
          }),
        );
        expect(result).toBe("ok");
      }),
    );

    it.effect("should handle graceful shutdown without errors", () =>
      Effect.gen(function* () {
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(3);
            yield* Scope.extend(layer, scope);

            yield* runExec("CREATE TABLE IF NOT EXISTS graceful (id INTEGER PRIMARY KEY)");
            yield* runExec("INSERT INTO graceful DEFAULT VALUES");

            // Scope closing will trigger pool shutdown
            return "shutdown-ok";
          }),
        );
        expect(result).toBe("shutdown-ok");
      }),
    );
  });

  describe("concurrent queries", () => {
    it.effect("should handle multiple concurrent queries", () =>
      Effect.gen(function* () {
        const results = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(4);
            yield* Scope.extend(layer, scope);

            yield* runExec("CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, value TEXT)");
            yield* runExec("INSERT INTO items (value) VALUES ('a')");
            yield* runExec("INSERT INTO items (value) VALUES ('b')");
            yield* runExec("INSERT INTO items (value) VALUES ('c')");

            // Fire 3 concurrent queries
            const queries = Effect.all(
              [
                runQuery("SELECT value FROM items WHERE id = 1"),
                runQuery("SELECT value FROM items WHERE id = 2"),
                runQuery("SELECT value FROM items WHERE id = 3"),
              ],
              { concurrency: 3 },
            );

            return yield* queries;
          }),
        );

        expect(results).toHaveLength(3);
        expect(results[0]).toEqual([{ value: "a" }]);
        expect(results[1]).toEqual([{ value: "b" }]);
        expect(results[2]).toEqual([{ value: "c" }]);
      }),
    );

    it.effect("should handle concurrent writes in WAL mode", () =>
      Effect.gen(function* () {
        const count = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(4);
            yield* Scope.extend(layer, scope);

            yield* runExec("CREATE TABLE IF NOT EXISTS conwrite (id INTEGER PRIMARY KEY, val TEXT)");

            // Concurrent inserts
            yield* Effect.all(
              [1, 2, 3, 4, 5].map((i) =>
                runExec("INSERT INTO conwrite (val) VALUES (?)", [`item-${i}`])
              ),
              { concurrency: 5 },
            );

            const rows = yield* runQuery("SELECT COUNT(*) as count FROM conwrite");
            return rows[0]!.count as number;
          }),
        );
        expect(count).toBe(5);
      }),
    );
  });

  describe("WAL mode", () => {
    it.effect("should have WAL journal mode enabled", () =>
      Effect.gen(function* () {
        const rows = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(1);
            yield* Scope.extend(layer, scope);

            return yield* runQuery("PRAGMA journal_mode");
          }),
        );

        // `journal_mode` returns the current mode as a single-row result.
        // WAL is always enabled by the service.
        const mode = String(rows[0]?.journal_mode ?? rows[0]?.mode ?? "");
        expect(mode.toLowerCase()).toBe("wal");
      }),
    );

    it.effect("should have foreign keys enabled", () =>
      Effect.gen(function* () {
        const rows = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(1);
            yield* Scope.extend(layer, scope);

            return yield* runQuery("PRAGMA foreign_keys");
          }),
        );

        const fk = Number(rows[0]?.foreign_keys ?? rows[0]?.fk ?? 0);
        expect(fk).toBe(1);
      }),
    );
  });

  describe("error handling", () => {
    it.effect("should return DatabaseError on bad SQL", () =>
      Effect.gen(function* () {
        const error = yield* Effect.scoped(
          Effect.gen(function* () {
            const scope = yield* Effect.scope;
            const layer = testLayer(1);
            yield* Scope.extend(layer, scope);

            return yield* runExec("INVALID SQL HERE").pipe(Effect.flip);
          }),
        );

        expect(error._tag).toBe("DatabaseError");
      }),
    );
  });
});
