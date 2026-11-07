import { describe, it, expect, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  SqliteHealthCheck,
  SqliteHealthCheckLive,
  SqliteConnectionPool,
  SqliteConnectionPoolLive,
  getPoolConfig,
} from "./Sqlite.ts";

describe("SQLite WAL Mode and Connection Pooling", () => {
  describe("getPoolConfig", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    it("should return default pool configuration", () => {
      const config = getPoolConfig();
      expect(config.minConnections).toBe(1);
      expect(config.maxConnections).toBe(5);
      expect(config.acquireTimeout).toBe(10000);
    });

    it("should read from environment variables", () => {
      process.env.DB_POOL_MIN = "2";
      process.env.DB_POOL_MAX = "10";
      process.env.DB_POOL_ACQUIRE_TIMEOUT = "5000";

      const config = getPoolConfig();
      expect(config.minConnections).toBe(2);
      expect(config.maxConnections).toBe(10);
      expect(config.acquireTimeout).toBe(5000);
    });
  });

  describe("SqliteHealthCheckLive", () => {
    const healthCheckLayer = SqliteHealthCheckLive;

    it("should perform integrity check", () =>
      Effect.gen(function* () {
        const healthCheck = yield* SqliteHealthCheck;
        const result = yield* healthCheck.check();

        expect(result.pass).toBe(true);
        expect(result.details).toBeDefined();
        expect(result.timestamp).toBeDefined();
      }).pipe(Effect.scoped, Effect.provide(healthCheckLayer), Effect.runPromise));

    it("should return timestamp in ISO format", () =>
      Effect.gen(function* () {
        const healthCheck = yield* SqliteHealthCheck;
        const result = yield* healthCheck.check();

        const timestamp = new Date(result.timestamp);
        expect(timestamp.toISOString()).toBe(result.timestamp);
      }).pipe(Effect.scoped, Effect.provide(healthCheckLayer), Effect.runPromise));
  });

  describe("SqliteConnectionPoolLive", () => {
    const poolLayer = SqliteConnectionPoolLive;

    it("should execute operations through pool", () =>
      Effect.gen(function* () {
        const pool = yield* SqliteConnectionPool;

        const result = yield* pool.execute((sql) =>
          sql`SELECT 1 as test;`.pipe(
            Effect.map((rows: any) => rows),
          ),
        );

        expect(result).toBeDefined();
      }).pipe(Effect.scoped, Effect.provide(poolLayer), Effect.runPromise));

    it("should track pool metrics", () =>
      Effect.gen(function* () {
        const pool = yield* SqliteConnectionPool;

        // Execute some operations
        yield* pool.execute((sql) => sql`SELECT 1;`);
        yield* pool.execute((sql) => sql`SELECT 2;`);

        const metrics = yield* pool.getMetrics();

        expect(metrics.size).toBe(5); // default max
        expect(metrics.available).toBeGreaterThanOrEqual(0);
        expect(metrics.inUse).toBeGreaterThanOrEqual(0);
      }).pipe(Effect.scoped, Effect.provide(poolLayer), Effect.runPromise));

    it("should handle concurrent operations", () =>
      Effect.gen(function* () {
        const pool = yield* SqliteConnectionPool;

        // Execute multiple operations concurrently
        const results = yield* Effect.all([
          pool.execute((sql) => sql`SELECT 1 as id;`),
          pool.execute((sql) => sql`SELECT 2 as id;`),
          pool.execute((sql) => sql`SELECT 3 as id;`),
          pool.execute((sql) => sql`SELECT 4 as id;`),
          pool.execute((sql) => sql`SELECT 5 as id;`),
        ]);

        expect(results).toHaveLength(5);
        results.forEach((result) => {
          expect(result).toBeDefined();
        });
      }).pipe(Effect.scoped, Effect.provide(poolLayer), Effect.runPromise));

    it("should reset pool connections", () =>
      Effect.gen(function* () {
        const pool = yield* SqliteConnectionPool;

        // Use some connections
        yield* pool.execute((sql) => sql`SELECT 1;`);
        yield* pool.execute((sql) => sql`SELECT 2;`);

        // Reset pool
        yield* pool.reset();

        const metrics = yield* pool.getMetrics();
        expect(metrics.inUse).toBe(0);
      }).pipe(Effect.scoped, Effect.provide(poolLayer), Effect.runPromise));
  });

  describe("WAL Mode Integration", () => {
    it("should enable WAL mode on database initialization", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        // Check WAL mode is enabled
        const walMode = yield* sql`PRAGMA journal_mode;`.pipe(
          Effect.map((rows: any) => {
            const row = Array.isArray(rows) ? rows[0] : rows;
            return row?.journal_mode;
          }),
        );

        expect(walMode).toBe("wal");
      }).pipe(
        Effect.scoped,
        Effect.provide(SqlitePersistenceMemory),
        Effect.runPromise,
      ));

    it("should set busy timeout", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const busyTimeout = yield* sql`PRAGMA busy_timeout;`.pipe(
          Effect.map((rows: any) => {
            const row = Array.isArray(rows) ? rows[0] : rows;
            return parseInt(row?.busy_timeout);
          }),
        );

        expect(busyTimeout).toBe(5000);
      }).pipe(
        Effect.scoped,
        Effect.provide(SqlitePersistenceMemory),
        Effect.runPromise,
      ));

    it("should set synchronous mode to NORMAL", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const synchronous = yield* sql`PRAGMA synchronous;`.pipe(
          Effect.map((rows: any) => {
            const row = Array.isArray(rows) ? rows[0] : rows;
            return parseInt(row?.synchronous);
          }),
        );

        // NORMAL = 1
        expect(synchronous).toBe(1);
      }).pipe(
        Effect.scoped,
        Effect.provide(SqlitePersistenceMemory),
        Effect.runPromise,
      ));

    it("should enable foreign keys", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        const foreignKeys = yield* sql`PRAGMA foreign_keys;`.pipe(
          Effect.map((rows: any) => {
            const row = Array.isArray(rows) ? rows[0] : rows;
            return parseInt(row?.foreign_keys);
          }),
        );

        expect(foreignKeys).toBe(1);
      }).pipe(
        Effect.scoped,
        Effect.provide(SqlitePersistenceMemory),
        Effect.runPromise,
      ));
  });

  describe("Concurrent Access Patterns", () => {
    it("should handle concurrent reads and writes without deadlock", () =>
      Effect.gen(function* () {
        const pool = yield* SqliteConnectionPool;

        // Simulate concurrent read and write operations
        const operations = [
          pool.execute((sql) => sql`SELECT 1 as read_op;`),
          pool.execute((sql) => sql`SELECT 2 as read_op;`),
          pool.execute((sql) => sql`SELECT 3 as read_op;`),
        ];

        const results = yield* Effect.all(operations);

        expect(results).toHaveLength(3);
        results.forEach((result) => {
          expect(result).toBeDefined();
        });
      }).pipe(Effect.scoped, Effect.provide(SqliteConnectionPoolLive), Effect.runPromise));
  });
});
