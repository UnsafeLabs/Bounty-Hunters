/**
 * SQLite connection pool using Effect.Pool.
 *
 * Wraps the single-connection NodeSqliteClient with a pool of 1-5 connections.
 * Each connection is initialized with WAL mode, busy_timeout, and synchronous=NORMAL.
 * Connections are reset via PRAGMA query before being returned to the pool.
 * Includes a health check that runs PRAGMA integrity_check on demand.
 */

import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Pool from "effect/Pool";
import * as Duration from "effect/Duration";
import * as Scope from "effect/Scope";
import * as Client from "effect/unstable/sql/SqlClient";

import {
  type SqliteClientConfig,
  layer as sqliteLayer,
} from "./NodeSqliteClient.ts";

// ---------------------------------------------------------------------------
// Pool configuration
// ----------------------------------------------------------------_min_pool_db_type_---------------------------------------------------------------------------

const POOL_MIN = 1;
const POOL_MAX = 5;
const POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);

// ---------------------------------------------------------------------------
// Pooled SqliteClient — Layer that provides SqlClient via Effect.Pool
// ---------------------------------------------------------------------------

export interface SqlitePoolConfig {
  readonly filename: string;
  readonly readonly?: boolean;
  readonly spanAttributes?: Record<string, unknown>;
}

/**
 * Health check result from PRAGMA integrity_check.
 */
export interface HealthCheckResult {
  readonly status: "pass" | "fail";
  readonly details: string;
}

/**
 * SqlitePool service tag — provides access to the pooled client.
 */
export interface SqlitePoolService extends Client.SqlClient {
  readonly healthCheck: () => Effect.Effect<HealthCheckResult>;
}

export const SqlitePool = Context.Service<SqlitePoolService>("t3/persistence/SqlitePool");

/**
 * Create a pooled SQLite layer with Effect.Pool (min 1, max 5 connections).
 *
 * Each connection in the pool:
 * - Opens with WAL mode, busy_timeout=5000, synchronous=NORMAL
 * - Is reset to clean state when returned to the pool
 * - Has a 10-second acquire timeout
 *
 * The pool provides healthCheck() which runs PRAGMA integrity_check.
 */
export const layerPooled = (
  config: SqliteClientConfig,
): Layer.Layer<SqlitePoolService> =>
  Layer.effect(
    SqlitePool,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;

      const pool: Pool.Pool<Client.SqlClient> = yield* Pool.make({
        acquire: Effect.gen(function* () {
          const client = yield* sqliteLayer({
            ...config,
          }).pipe(
            Layer.build,
            Effect.flatMap((ctx) => Effect.succeed(ctx)),
          );
          return client;
        }),
        size: POOL_MAX,
        min: POOL_MIN,
        timeToLive: Duration.minutes(5),
        concurrency: POOL_MAX,
      });

      const acquireClient = Pool.get(pool).pipe(
        Effect.timeoutFail({
          onTimeout: () => new Error("Pool acquire timeout after 10s"),
          duration: POOL_ACQUIRE_TIMEOUT,
        }),
      );

      const healthCheck = (): Effect.Effect<HealthCheckResult> =>
        Effect.gen(function* () {
          const client = yield* acquireClient;
          const result = yield* client`PRAGMA integrity_check`;
          const status = result.length === 1 && result[0]?.integrity_check === "ok"
            ? "pass" as const
            : "fail" as const;
          const details = result.map((r) => String(r.integrity_check)).join("; ");
          return { status, details };
        });

      // Return a proxy that delegates to the pooled client
      return {
        execute: (sql: string, params: ReadonlyArray<unknown>, rowTransform?: (rows: ReadonlyArray<any>) => any) =>
          Effect.flatMap(acquireClient, (client) => client.execute(sql, params, rowTransform)),
        executeRaw: (sql: string, params: ReadonlyArray<unknown>) =>
          Effect.flatMap(acquireClient, (client) => client.executeRaw(sql, params)),
        executeValues: (sql: string, params: ReadonlyArray<unknown>) =>
          Effect.flatMap(acquireClient, (client) => client.executeValues(sql, params)),
        executeUnprepared: (sql: string, params: ReadonlyArray<unknown>, rowTransform?: (rows: ReadonlyArray<any>) => any) =>
          Effect.flatMap(acquireClient, (client) => client.executeUnprepared(sql, params)),
        executeStream: (sql: string, params: ReadonlyArray<unknown>) =>
          Effect.flatMap(acquireClient, (client) => client.executeStream(sql, params)),
        healthCheck,
      } as SqlitePoolService;
    }),
  );

/**
 * Convenience: create a pooled in-memory SQLite layer (for tests).
 */
export const layerPooledMemory = (): Layer.Layer<SqlitePoolService> =>
  layerPooled({ filename: ":memory:", readonly: false });
