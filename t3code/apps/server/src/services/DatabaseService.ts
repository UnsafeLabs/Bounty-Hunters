/**
 * DatabaseService — Effect.Pool-based SQLite connection pooling with WAL mode.
 *
 * Provides a pool of `node:sqlite` connections for concurrent read/write access
 * in WAL mode. Supports configurable pool size and graceful shutdown via
 * Effect's Scope-based resource management.
 *
 * Each connection in the pool enables WAL journal mode and foreign keys.
 * Pool lifecycle is fully managed by Effect.Scope — when the owning scope
 * closes, all connections are gracefully closed.
 *
 * @module DatabaseService
 */

import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import type * as Scope from "effect/Scope";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Service interface & tag
// ---------------------------------------------------------------------------

export interface DatabaseService {
  /** Execute a SQL statement (INSERT, UPDATE, DELETE, DDL, PRAGMA, etc.). */
  readonly exec: (
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Effect.Effect<void, DatabaseError>;

  /** Run a SELECT query and return all rows as plain objects. */
  readonly query: <T = Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ) => Effect.Effect<Array<T>, DatabaseError>;
}

export const DatabaseService = Context.Service<DatabaseService>(
  "t3/DatabaseService",
);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface DatabaseServiceConfig {
  readonly filename: string;
  readonly poolSize: number;
}

export const DatabaseServiceConfig = Config.all({
  filename: Config.string("DB_PATH").pipe(Config.withDefault(":memory:")),
  poolSize: Config.integer("DB_POOL_SIZE").pipe(Config.withDefault(5)),
});

// ---------------------------------------------------------------------------
// Layer constructor
// ---------------------------------------------------------------------------

/**
 * Create a `DatabaseService` layer backed by an Effect.Pool of `node:sqlite`
 * connections.  Each connection enables WAL journal mode and foreign keys.
 *
 * Pool lifecycle is managed by Effect.Scope — when the scope closes all
 * underlying `DatabaseSync` handles are closed via the release action of
 * `Effect.acquireRelease`.
 */
export const makeDatabaseServiceLayer = (
  config: DatabaseServiceConfig,
): Layer.Layer<DatabaseService> =>
  Layer.scopedContext(
    Effect.map(
      Pool.make({
        acquire: Effect.acquireRelease(
          Effect.sync(() => {
            const db = new DatabaseSync(config.filename);
            db.exec("PRAGMA journal_mode = WAL;");
            db.exec("PRAGMA foreign_keys = ON;");
            return db;
          }),
          (db) =>
            Effect.sync(() => {
              db.close();
            }),
        ),
        size: config.poolSize,
      }),
      (pool): Context.Context<DatabaseService> => {
        const service: DatabaseService = {
          exec: (sql, params) =>
            Effect.scoped(
              Effect.flatMap(
                Pool.get(pool),
                (conn): Effect.Effect<void, DatabaseError> =>
                  Effect.try({
                    try: () => {
                      if (params && params.length > 0) {
                        conn.prepare(sql).run(...params);
                      } else {
                        conn.exec(sql);
                      }
                    },
                    catch: (cause) =>
                      new DatabaseError({
                        message: "Failed to execute SQL",
                        cause,
                      }),
                  }),
              ),
            ),

          query: (sql, params) =>
            Effect.scoped(
              Effect.flatMap(
                Pool.get(pool),
                (conn): Effect.Effect<Array<Record<string, unknown>>, DatabaseError> =>
                  Effect.try({
                    try: () => {
                      const stmt = conn.prepare(sql);
                      if (params && params.length > 0) {
                        return stmt.all(...params) as Array<Record<string, unknown>>;
                      }
                      return stmt.all() as Array<Record<string, unknown>>;
                    },
                    catch: (cause) =>
                      new DatabaseError({
                        message: "Failed to query SQL",
                        cause,
                      }),
                  }),
              ),
            ),
        };
        return Context.make(DatabaseService, service);
      },
    ),
  );

/**
 * Convenience layer that reads config from environment variables:
 * - `DB_PATH` (default `:memory:`)
 * - `DB_POOL_SIZE` (default `5`)
 */
export const DatabaseServiceLive: Layer.Layer<
  DatabaseService,
  Config.ConfigError
> = Layer.unwrapEffect(
  Effect.map(DatabaseServiceConfig, (cfg) => makeDatabaseServiceLayer(cfg)),
);
