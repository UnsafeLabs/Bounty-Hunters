import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeSqlitePersistenceLive, SqlitePersistenceMemory } from "./Sqlite.ts";
import { vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";

// Test Suite 1: In-Memory (Bypasses connection pooling)
const memoryLayer = it.layer(
  SqlitePersistenceMemory.pipe(Layer.provideMerge(NodeServices.layer))
);

memoryLayer("SqlitePool - InMemory Database Path", (it) => {
  it.effect("performs queries and supports healthCheck without pooling issues", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      // Basic query check
      const rows = yield* sql`SELECT 1 as value`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.value, 1);

      // healthCheck check
      const pooledSql = sql as any;
      assert.equal(typeof pooledSql.healthCheck, "function");
      const health = yield* pooledSql.healthCheck();
      assert.equal(health.status, "pass");
      assert.equal(health.details, "ok");
    })
  );
});

// Test Suite 2: File-Based Database (Supports connection pooling & PRAGMA reset)
const tempDbPath = path.join(__dirname, `test-${Math.random().toString(36).substring(7)}.db`);
const fileLayer = it.layer(
  makeSqlitePersistenceLive(tempDbPath).pipe(Layer.provideMerge(NodeServices.layer))
);

fileLayer("SqlitePool - File-Based Database Path", (it) => {
  it.effect("applies connection pooling and runs PRAGMA reset on release", () =>
    Effect.gen(function* () {
      // Setup cleanup finalizer inside the test block
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (fs.existsSync(tempDbPath)) {
            try {
              fs.unlinkSync(tempDbPath);
            } catch (e) {
              // Ignore cleanup issues
            }
          }
        })
      );

      const prepareSpy = vi.spyOn(DatabaseSync.prototype, "prepare");
      const sql = yield* SqlClient.SqlClient;

      // Perform queries to trigger connection checkout and return
      const rows = yield* sql`SELECT 1 as val`;
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.val, 1);

      // Verify PRAGMA reset was prepared and called when the connection checkout scope is closed
      const calls = prepareSpy.mock.calls.map((c) => c[0]);
      assert.deepInclude(calls, "PRAGMA reset;");

      prepareSpy.mockRestore();
    })
  );
});
