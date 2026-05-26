import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(SqlitePersistenceMemory);

layer("SqlitePool", (it) => {
  it.effect("performs queries and supports healthCheck", () =>
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
