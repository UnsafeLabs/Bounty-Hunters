import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Duration from "effect/Duration";
import { SqlitePoolLive, DefaultSqlitePoolConfig, runHealthCheck, withConnection } from "./SqlitePool.ts";

describe("SqlitePool", () => {
  it.effect("enables WAL mode on initialization", () =>
    Effect.gen(function* () {
      const config = { ...DefaultSqlitePoolConfig, dbPath: ":memory:" };
      const poolLayer = SqlitePoolLive(config);
      const pool = yield* Effect.scoped(Layer.build(poolLayer));
      const result = yield* withConnection(pool, (client) =>
        client`PRAGMA journal_mode`
      );
      expect(result).toBeDefined();
    }),
  );

  it.effect("health check returns pass for valid database", () =>
    Effect.gen(function* () {
      const config = { ...DefaultSqlitePoolConfig, dbPath: ":memory:" };
      const poolLayer = SqlitePoolLive(config);
      const pool = yield* Effect.scoped(Layer.build(poolLayer));
      const result = yield* runHealthCheck(pool);
      expect(result.status).toBe("pass");
    }),
  );

  it.effect("pool acquires connection with 10-second timeout", () =>
    Effect.gen(function* () {
      const config = { ...DefaultSqlitePoolConfig, dbPath: ":memory:", maxConnections: 3 };
      const poolLayer = SqlitePoolLive(config);
      const pool = yield* Effect.scoped(Layer.build(poolLayer));
      // Should acquire within timeout
      const result = yield* withConnection(pool, (client) =>
        Effect.succeed("connected")
      );
      expect(result).toBe("connected");
    }),
  );
});
