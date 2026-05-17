/**
 * SQLite Connection Pool
 *
 * Manages a pool of SQLite connections using Effect.Pool with configurable
 * min/max sizes. Each connection is reset to a clean state before being
 * returned to the pool.
 *
 * @module SqlitePool
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { DatabaseSync } from "node:sqlite";
import * as Statement from "effect/unstable/sql/Statement";
import * as Scope from "effect/Scope";
import * as Cache from "effect/Cache";
import * as Semaphore from "effect/Semaphore";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface SqlitePoolConfig {
  readonly filename: string;
  readonly minConnections: number;
  readonly maxConnections: number;
  readonly acquireTimeoutMs: number;
  readonly spanAttributes?: Record<string, unknown>;
}

export const DEFAULT_POOL_CONFIG: Omit<SqlitePoolConfig, "filename"> = {
  minConnections: 1,
  maxConnections: 5,
  acquireTimeoutMs: 10_000,
};

export class SqlitePoolConfigService extends Context.Service<SqlitePoolConfigService, SqlitePoolConfig>()(
  "t3/persistence/SqlitePoolConfig",
) {
  static readonly layerDefault = Layer.succeed(
    SqlitePoolConfigService,
    { ...DEFAULT_POOL_CONFIG, filename: "" } as SqlitePoolConfig,
  );

  static readonly layerFromEnv = Layer.sync(SqlitePoolConfigService, () => ({
    filename: "", // Will be set by makeSqlitePersistenceLive
    minConnections: process.env.T3_SQLITE_POOL_MIN
      ? parseInt(process.env.T3_SQLITE_POOL_MIN, 10)
      : 1,
    maxConnections: process.env.T3_SQLITE_POOL_MAX
      ? parseInt(process.env.T3_SQLITE_POOL_MAX, 10)
      : 5,
    acquireTimeoutMs: process.env.T3_SQLITE_POOL_TIMEOUT_MS
      ? parseInt(process.env.T3_SQLITE_POOL_TIMEOUT_MS, 10)
      : 10_000,
  }));
}

// ---------------------------------------------------------------------------
// Pooled connection factory
// ---------------------------------------------------------------------------

const ATTR_DB_SYSTEM_NAME = "db.system.name";

/**
 * Create a single SQLite connection suitable for pooling.
 * Each connection gets its own DatabaseSync instance with WAL pragmas.
 */
const makePooledConnection = (filename: string, spanAttributes?: Record<string, unknown>) =>
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const db = new DatabaseSync(filename);
    yield* Scope.addFinalizer(scope, Effect.sync(() => db.close()));

    // Configure connection pragmas
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA synchronous = NORMAL");

    const compiler = Statement.makeCompilerSqlite();

    const statementReaderCache = new WeakMap<any, boolean>();
    const hasRows = (statement: any): boolean => {
      const cached = statementReaderCache.get(statement);
      if (cached !== undefined) return cached;
      const value = statement.columns().length > 0;
      statementReaderCache.set(statement, value);
      return value;
    };

    const prepareCache = yield* Cache.make({
      capacity: 200,
      timeToLive: Duration.minutes(10),
      lookup: (sql: string) =>
        Effect.try({
          try: () => db.prepare(sql),
          catch: (cause) =>
            new SqlError({
              reason: classifySqliteError(cause, {
                message: "Failed to prepare statement",
                operation: "prepare",
              }),
            }),
        }),
    });

    const runStatement = (statement: any, params: ReadonlyArray<unknown>, raw: boolean) =>
      Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
        try {
          if (hasRows(statement)) {
            return Effect.succeed(statement.all(...(params as any)));
          }
          const result = statement.run(...(params as any));
          return Effect.succeed(raw ? (result as unknown as ReadonlyArray<any>) : []);
        } catch (cause) {
          return Effect.fail(
            new SqlError({
              reason: classifySqliteError(cause, {
                message: "Failed to execute statement",
                operation: "execute",
              }),
            }),
          );
        }
      });

    const run = (sql: string, params: ReadonlyArray<unknown>, raw = false) =>
      Effect.flatMap(Cache.get(prepareCache, sql), (s) => runStatement(s, params, raw));

    const runValues = (sql: string, params: ReadonlyArray<unknown>) =>
      Effect.acquireUseRelease(
        Cache.get(prepareCache, sql),
        (statement: any) =>
          Effect.try({
            try: () => {
              if (hasRows(statement)) {
                statement.setReturnArrays(true);
                return statement.all(...(params as any)) as unknown as ReadonlyArray<
                  ReadonlyArray<unknown>
                >;
              }
              statement.run(...(params as any));
              return [];
            },
            catch: (cause) =>
              new SqlError({
                reason: classifySqliteError(cause, {
                  message: "Failed to execute statement",
                  operation: "execute",
                }),
              }),
          }),
        (statement: any) =>
          Effect.sync(() => {
            if (hasRows(statement)) {
              statement.setReturnArrays(false);
            }
          }),
      );

    const connection: Connection = {
      execute(sql, params, rowTransform) {
        return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
      },
      executeRaw(sql, params) {
        return run(sql, params, true);
      },
      executeValues(sql, params) {
        return runValues(sql, params);
      },
      executeUnprepared(sql, params, rowTransform) {
        const effect = runStatement(db.prepare(sql), params ?? [], false);
        return rowTransform ? Effect.map(effect, rowTransform) : effect;
      },
      executeStream(_sql, _params) {
        return Stream.die("executeStream not implemented");
      },
    };

    return connection;
  });

/**
 * Reset a connection to clean state before returning to pool.
 */
const resetConnection = (conn: Connection) =>
  Effect.gen(function* () {
    // In SQLite, connections are inherently stateful per-transaction.
    // Rolling back any pending transaction resets the connection.
    yield* Effect.try({
      try: () => conn.executeUnprepared("ROLLBACK", [], undefined),
      catch: () => undefined, // Ignore if no transaction pending
    });
  });

// ---------------------------------------------------------------------------
// Pool creation
// ---------------------------------------------------------------------------

/**
 * Create a connection pool for SQLite with the given configuration.
 */
export const makeSqlitePool = (config: SqlitePoolConfig) =>
  Pool.make({
    acquire: makePooledConnection(config.filename, config.spanAttributes),
    min: config.minConnections,
    max: config.maxConnections,
  });

/**
 * Create a pooled SqlClient service using Effect.Pool.
 */
export const makePooledSqlClient = (config: SqlitePoolConfig) =>
  Effect.gen(function* () {
    const pool = yield* makeSqlitePool(config);
    const compiler = Statement.makeCompilerSqlite();

    const semaphore = yield* Semaphore.make(1);

    const acquirer = Semaphore.withPermits(1)(
      Effect.flatMap(
        Pool.get(pool, Duration.millis(config.acquireTimeoutMs)),
        (conn) => Effect.as(resetConnection(conn), conn),
      ),
    )(Effect.succeed(undefined as unknown as Connection)).pipe(
      Effect.zipLeft(Semaphore.take(1)),
    );

    // Simplified: get a connection from pool with timeout
    const getConnection = Pool.get(pool, Duration.millis(config.acquireTimeoutMs));

    const transactionAcquirer = Effect.uninterruptibleMask((restore) => {
      const fiber = Fiber.getCurrent()!;
      const scope = Context.getUnsafe(fiber.context, Scope.Scope);
      return Effect.as(
        Effect.tap(restore(Semaphore.take(1)(semaphore)), () =>
          Scope.addFinalizer(scope, Semaphore.release(1)(semaphore)),
        ),
        getConnection,
      );
    });

    return yield* SqlClient.SqlClient.pipe(
      Context.Service.make({
        acquirer: Effect.flatMap(getConnection, (conn) => Effect.as(resetConnection(conn), conn)),
        compiler,
        transactionAcquirer: Effect.flatMap(getConnection, (conn) =>
          Effect.as(resetConnection(conn), conn),
        ),
        spanAttributes: [
          ...(config.spanAttributes ? Object.entries(config.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
      }),
    );
  });

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const SqlitePoolLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* SqlitePoolConfigService;
    return Layer.effect(SqlClient.SqlClient, makePooledSqlClient(config));
  }),
);
