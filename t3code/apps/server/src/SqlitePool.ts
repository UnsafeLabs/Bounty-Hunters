import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Duration from "effect/Duration";
import * as Schema from "effect/Schema";
import { SqlClient } from "@effect/sql-sqlite-bun";

/**
 * SQLite connection pool with WAL mode enabled.
 *
 * Features:
 * - WAL journal mode for better concurrent read/write performance
 * - Busy timeout to prevent immediate SQLITE_BUSY errors
 * - NORMAL synchronous mode for WAL-optimized write performance
 * - Connection pool (min 1, max 5) using Effect.Pool
 * - Health check via PRAGMA integrity_check
 */

export interface SqlitePoolConfig {
  readonly dbPath: string;
  readonly minConnections: number;
  readonly maxConnections: number;
  readonly busyTimeoutMs: number;
}

export const DefaultSqlitePoolConfig: SqlitePoolConfig = {
  dbPath: "",
  minConnections: 1,
  maxConnections: 5,
  busyTimeoutMs: 5000,
};

// Health check result schema
export const HealthCheckResult = Schema.Struct({
  status: Schema.Literal("pass", "fail"),
  details: Schema.String,
});
export type HealthCheckResult = typeof HealthCheckResult.Type;

/**
 * Initialize a single SQLite connection with WAL mode and pragmas.
 */
const initConnection = (dbPath: string): Effect.Effect<SqlClient, Error> =>
  Effect.gen(function* () {
    const client = yield* SqlClient.make({
      filename: dbPath,
    });

    // Enable WAL journal mode
    yield* client`PRAGMA journal_mode=WAL`;
    // Set busy timeout to wait before failing on lock contention
    yield* client`PRAGMA busy_timeout=${5000}`;
    // NORMAL synchronous mode for better write performance in WAL mode
    yield* client`PRAGMA synchronous=NORMAL`;

    return client;
  });

/**
 * Reset connection to clean state before returning to pool.
 */
const resetConnection = (client: SqlClient): Effect.Effect<void, Error> =>
  Effect.gen(function* () {
    yield* client`PRAGMA reset`;
  });

/**
 * Create the SQLite connection pool.
 */
export const SqlitePoolLive = (config: SqlitePoolConfig) =>
  Layer.effect(
    Pool.make({
      acquire: initConnection(config.dbPath),
      min: config.minConnections,
      max: config.maxConnections,
      reset: resetConnection,
    }),
  );

/**
 * Run a health check on the database using PRAGMA integrity_check.
 */
export const runHealthCheck = (pool: Pool.Pool<SqlClient, Error>): Effect.Effect<HealthCheckResult, Error> =>
  Effect.gen(function* () {
    const client = yield* Pool.get(pool).pipe(
      Effect.timeout(Duration.seconds(10)),
    );
    const result = yield* client`PRAGMA integrity_check`;
    const details = Array.isArray(result) ? result.map((r: any) => r.integrity_check ?? JSON.stringify(r)).join("; ") : String(result);
    const isHealthy = details === "ok";
    return {
      status: isHealthy ? "pass" as const : "fail" as const,
      details,
    };
  });

/**
 * Execute a query using a pooled connection.
 */
export const withConnection = <A, E, R>(
  pool: Pool.Pool<SqlClient, Error>,
  f: (client: SqlClient) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | Error, R> =>
  Effect.gen(function* () {
    const client = yield* Pool.get(pool).pipe(
      Effect.timeout(Duration.seconds(10)),
    );
    return yield* f(client);
  });
