/**
 * SqlitePersistence - SQLite persistence layer with WAL mode and connection pooling.
 *
 * Enables WAL journal mode for concurrent read/write access, implements
 * connection pooling via Effect.Pool, and provides health check capabilities.
 *
 * @module SqlitePersistence
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Pool from "effect/Pool";
import * as Ref from "effect/Ref";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};

const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

/**
 * Apply WAL mode and performance PRAGMAs to a SQLite connection.
 */
const applyWalMode = (sql: SqlClient.SqlClient) =>
  Effect.all([
    sql`PRAGMA journal_mode = WAL;`,
    sql`PRAGMA busy_timeout = 5000;`,
    sql`PRAGMA synchronous = NORMAL;`,
    sql`PRAGMA foreign_keys = ON;`,
  ]);

/**
 * Run integrity check on the database.
 */
const integrityCheck = (sql: SqlClient.SqlClient) =>
  sql`PRAGMA integrity_check;`.pipe(
    Effect.map((rows: any) => {
      const result = Array.isArray(rows) ? rows : [rows];
      const isHealthy = result.length === 1 && result[0]?.integrity_check === "ok";
      return {
        pass: isHealthy,
        details: result.map((r: any) => r?.integrity_check || JSON.stringify(r)),
      };
    }),
  );

const setup = Layer.effectDiscard(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* applyWalMode(sql);
    yield* runMigrations();
  }),
);

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });

  return Layer.provideMerge(
    setup,
    makeRuntimeSqliteLayer({
      filename: dbPath,
      spanAttributes: {
        "db.name": path.basename(dbPath),
        "service.name": "t3-server",
      },
    }),
  );
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.provideMerge(
  setup,
  makeRuntimeSqliteLayer({ filename: ":memory:" }),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);

// Connection Pool Configuration
export interface ConnectionPoolConfig {
  readonly minConnections: number;
  readonly maxConnections: number;
  readonly acquireTimeout: number; // milliseconds
}

export const defaultPoolConfig: ConnectionPoolConfig = {
  minConnections: 1,
  maxConnections: 5,
  acquireTimeout: 10000, // 10 seconds
};

export function getPoolConfig(): ConnectionPoolConfig {
  return {
    minConnections: parseInt(process.env.DB_POOL_MIN || String(defaultPoolConfig.minConnections)),
    maxConnections: parseInt(process.env.DB_POOL_MAX || String(defaultPoolConfig.maxConnections)),
    acquireTimeout: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT || String(defaultPoolConfig.acquireTimeout)),
  };
}

/**
 * Health check result interface.
 */
export interface HealthCheckResult {
  readonly pass: boolean;
  readonly details: ReadonlyArray<string>;
  readonly timestamp: string;
}

/**
 * SqliteHealthCheck service interface.
 */
export interface SqliteHealthCheckShape {
  readonly check: () => Effect.Effect<HealthCheckResult, Error>;
}

export const SqliteHealthCheck = Effect.GenericTag<SqliteHealthCheckShape>(
  "@services/SqliteHealthCheck",
);

/**
 * Live layer for SqliteHealthCheck.
 */
export const SqliteHealthCheckLive = Layer.effect(
  SqliteHealthCheck,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;

    const service: SqliteHealthCheckShape = {
      check: () =>
        Effect.gen(function* () {
          const result = yield* integrityCheck(sql);
          return {
            ...result,
            timestamp: new Date().toISOString(),
          };
        }),
    };

    return service;
  }),
);

/**
 * Connection pool metrics interface.
 */
export interface PoolMetrics {
  readonly size: number;
  readonly available: number;
  readonly inUse: number;
}

/**
 * SqliteConnectionPool service interface.
 */
export interface SqliteConnectionPoolShape {
  readonly execute: <A, E>(
    operation: (sql: SqlClient.SqlClient) => Effect.Effect<A, E>,
  ) => Effect.Effect<A, E | Error>;
  readonly getMetrics: () => Effect.Effect<PoolMetrics>;
  readonly reset: () => Effect.Effect<void>;
}

export const SqliteConnectionPool = Effect.GenericTag<SqliteConnectionPoolShape>(
  "@services/SqliteConnectionPool",
);

/**
 * Live layer for SqliteConnectionPool using Effect.Pool.
 */
export const SqliteConnectionPoolLive = Layer.effect(
  SqliteConnectionPool,
  Effect.gen(function* () {
    const config = getPoolConfig();
    const sql = yield* SqlClient.SqlClient;
    const activeConnections = yield* Ref.make(0);

    // Create a pool of SQL client "connections" (logical connections)
    // Note: SQLite doesn't have traditional connection pooling, but we can
    // manage concurrent access through a pool of operations
    const pool = yield* Pool.make({
      acquire: Effect.gen(function* () {
        yield* Ref.update(activeConnections, (n) => n + 1);
        return sql;
      }),
      release: (client) =>
        Effect.gen(function* () {
          yield* Ref.update(activeConnections, (n) => n - 1);
          // Reset connection state
          yield* client`PRAGMA reset;`.pipe(Effect.catchAll(() => Effect.void));
        }),
      size: config.maxConnections,
      min: config.minConnections,
    });

    const service: SqliteConnectionPoolShape = {
      execute: (operation) =>
        Effect.gen(function* () {
          const client = yield* Pool.get(pool).pipe(
            Effect.timeoutFail({
              duration: config.acquireTimeout,
              onTimeout: () => new Error("Connection pool acquire timeout"),
            }),
          );
          return yield* operation(client);
        }),

      getMetrics: () =>
        Effect.gen(function* () {
          const inUse = yield* Ref.get(activeConnections);
          return {
            size: config.maxConnections,
            available: config.maxConnections - inUse,
            inUse,
          };
        }),

      reset: () =>
        Effect.gen(function* () {
          yield* Pool.invalidateAll(pool);
          yield* Ref.set(activeConnections, 0);
        }),
    };

    return service;
  }),
);
