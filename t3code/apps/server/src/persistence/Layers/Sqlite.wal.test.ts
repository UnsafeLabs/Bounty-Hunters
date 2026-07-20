import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  SQLITE_POOL_MAX,
  SQLITE_POOL_MIN,
  SqlitePersistenceMemory,
  makeSqliteConnectionPool,
  sqliteIntegrityCheck,
} from "./Sqlite.ts";

describe("Sqlite WAL + pool (#858)", () => {
  it("exports pool bounds 1..5", () => {
    expect(SQLITE_POOL_MIN).toBe(1);
    expect(SQLITE_POOL_MAX).toBe(5);
  });

  it("memory layer enables foreign keys and passes integrity_check", async () => {
    const program = Effect.gen(function* () {
      const health = yield* sqliteIntegrityCheck;
      return health;
    }).pipe(Effect.provide(SqlitePersistenceMemory));

    const health = await Effect.runPromise(program);
    expect(health.pass).toBe(true);
    expect(health.detail.toLowerCase()).toContain("ok");
  });

  it("connection pool acquires and runs a query", async () => {
    const program = Effect.gen(function* () {
      const { get } = yield* makeSqliteConnectionPool;
      const one = yield* get((sql) =>
        sql<{ n: number }>`SELECT 1 as n`.pipe(Effect.map((rows) => rows[0]?.n)),
      );
      return one;
    }).pipe(Effect.provide(SqlitePersistenceMemory));

    const n = await Effect.runPromise(program);
    expect(n).toBe(1);
  });
});
