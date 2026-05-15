import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Pool from "effect/Pool";
import * as Semaphore from "effect/Semaphore";
import * as Scope from "effect/Scope";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { LockTimeoutError, SqlError, UnknownError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";
import type * as Reactivity from "effect/unstable/reactivity/Reactivity";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const SQLITE_POOL_MIN_SIZE = 1;
export const SQLITE_POOL_MAX_SIZE = 5;
export const SQLITE_POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);
export const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_POOL_TTL = Duration.minutes(5);

export interface SqlitePoolConfig {
  readonly minSize?: number | undefined;
  readonly maxSize?: number | undefined;
  readonly acquireTimeout?: Duration.Input | undefined;
  readonly timeToLive?: Duration.Input | undefined;
}

export interface SqlitePoolSettings {
  readonly minSize: number;
  readonly maxSize: number;
  readonly acquireTimeout: Duration.Duration;
  readonly timeToLive: Duration.Duration;
}

export interface SqlitePoolStats {
  readonly minSize: number;
  readonly maxSize: number;
  readonly activeConnections: number;
  readonly availableConnections: number;
  readonly acquiredConnections: number;
  readonly waiters: number;
}

export interface SqliteHealthCheck {
  readonly ok: boolean;
  readonly details: ReadonlyArray<string>;
}

export interface PooledSqliteClient extends Client.SqlClient {
  readonly poolSettings: SqlitePoolSettings;
  readonly poolStats: Effect.Effect<SqlitePoolStats>;
  readonly healthCheck: Effect.Effect<SqliteHealthCheck, SqlError>;
}

export interface PooledSqliteOptions {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
  readonly pool?: SqlitePoolConfig | undefined;
  readonly disableWAL?: boolean | undefined;
}

const isInMemoryDatabase = (filename: string) => filename === ":memory:";

export function normalizePoolSettings(options: PooledSqliteOptions): SqlitePoolSettings {
  if (isInMemoryDatabase(options.filename)) {
    return {
      minSize: 1,
      maxSize: 1,
      acquireTimeout: Duration.fromInputUnsafe(
        options.pool?.acquireTimeout ?? SQLITE_POOL_ACQUIRE_TIMEOUT,
      ),
      timeToLive: Duration.fromInputUnsafe(options.pool?.timeToLive ?? SQLITE_POOL_TTL),
    };
  }

  const minSize = Math.max(1, options.pool?.minSize ?? SQLITE_POOL_MIN_SIZE);
  const maxSize = Math.max(minSize, options.pool?.maxSize ?? SQLITE_POOL_MAX_SIZE);

  return {
    minSize,
    maxSize,
    acquireTimeout: Duration.fromInputUnsafe(
      options.pool?.acquireTimeout ?? SQLITE_POOL_ACQUIRE_TIMEOUT,
    ),
    timeToLive: Duration.fromInputUnsafe(options.pool?.timeToLive ?? SQLITE_POOL_TTL),
  };
}

const makePoolTimeoutError = () =>
  new SqlError({
    reason: new LockTimeoutError({
      cause: new Error("Timed out acquiring SQLite connection from the pool."),
      message: "Timed out acquiring SQLite connection from the pool.",
      operation: "pool.acquire",
    }),
  });

const makePragmaVerificationError = (message: string, operation: string) =>
  new SqlError({
    reason: new UnknownError({
      cause: new Error(message),
      message,
      operation,
    }),
  });

const executePragma = (connection: Connection, sql: string) =>
  Effect.asVoid(connection.executeUnprepared(sql, [], undefined));

const readPragma = (connection: Connection, sql: string) =>
  connection.executeUnprepared(sql, [], undefined);

const firstColumnAsString = (rows: ReadonlyArray<unknown>, column: string): string | undefined => {
  const row = rows[0];
  if (row === undefined || row === null || typeof row !== "object") {
    return undefined;
  }
  const value = (row as Record<string, unknown>)[column];
  return value === undefined ? undefined : String(value);
};

export const configureSqliteConnection = (
  connection: Connection,
  options: PooledSqliteOptions,
): Effect.Effect<void, SqlError> =>
  Effect.gen(function* () {
    if (!options.readonly && options.disableWAL !== true && !isInMemoryDatabase(options.filename)) {
      const currentRows = yield* readPragma(connection, "PRAGMA journal_mode;");
      let journalMode = firstColumnAsString(currentRows, "journal_mode")?.toLowerCase();
      if (journalMode !== "wal") {
        const updatedRows = yield* readPragma(connection, "PRAGMA journal_mode = WAL;");
        journalMode = firstColumnAsString(updatedRows, "journal_mode")?.toLowerCase();
      }
      if (journalMode !== "wal") {
        return yield* makePragmaVerificationError(
          `SQLite WAL mode verification failed; journal_mode is ${journalMode ?? "unknown"}.`,
          "pragma.journal_mode",
        );
      }
    }

    yield* executePragma(connection, `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`);
    yield* executePragma(connection, "PRAGMA synchronous = NORMAL;");
    yield* executePragma(connection, "PRAGMA foreign_keys = ON;");
  });

const resetSqliteConnection = (connection: Connection): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* executePragma(connection, "ROLLBACK;").pipe(Effect.ignore);
    yield* executePragma(connection, "PRAGMA reset;").pipe(Effect.ignore);
    yield* executePragma(connection, `PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};`).pipe(
      Effect.ignore,
    );
    yield* executePragma(connection, "PRAGMA synchronous = NORMAL;").pipe(Effect.ignore);
    yield* executePragma(connection, "PRAGMA foreign_keys = ON;").pipe(Effect.ignore);
  });

export const sqliteHealthCheck = (
  sql: Client.SqlClient,
): Effect.Effect<SqliteHealthCheck, SqlError> =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly integrity_check: string }>`
      PRAGMA integrity_check
    `;
    const details = rows.map((row) => row.integrity_check);
    return {
      ok: details.length > 0 && details.every((detail) => detail === "ok"),
      details,
    };
  });

export const makePooledSqliteClient = <R>(
  options: PooledSqliteOptions,
  acquireConnection: Effect.Effect<Connection, SqlError, R>,
): Effect.Effect<PooledSqliteClient, SqlError, R | Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const poolSettings = normalizePoolSettings(options);
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const pool = yield* Pool.makeWithTTL({
      acquire: Effect.tap(acquireConnection, (connection) =>
        configureSqliteConnection(connection, options),
      ),
      min: poolSettings.minSize,
      max: poolSettings.maxSize,
      timeToLive: poolSettings.timeToLive,
    });

    yield* Effect.scoped(Pool.get(pool));
    const poolGetSemaphore = yield* Semaphore.make(1);
    const leaseSemaphore = yield* Semaphore.make(poolSettings.maxSize);

    const poolStats = Effect.sync(() => {
      let acquiredConnections = 0;
      for (const item of pool.state.items) {
        acquiredConnections += item.refCount;
      }
      return {
        minSize: pool.config.minSize,
        maxSize: pool.config.maxSize,
        activeConnections: pool.state.items.size - pool.state.invalidated.size,
        availableConnections: pool.state.available.size,
        acquiredConnections,
        waiters: pool.state.waiters,
      };
    });

    const takeLease = Effect.flatMap(
      Effect.timeoutOption(leaseSemaphore.take(1), poolSettings.acquireTimeout),
      (lease) => (Option.isSome(lease) ? Effect.void : Effect.fail(makePoolTimeoutError())),
    );

    const acquirePooledConnection = Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        yield* restore(takeLease);
        const poolScope = yield* Scope.make();
        const connection = yield* restore(
          poolGetSemaphore.withPermits(1)(Scope.provide(Pool.get(pool), poolScope)),
        ).pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              yield* Scope.close(poolScope, Exit.failCause(cause)).pipe(Effect.ignore);
              yield* leaseSemaphore.release(1);
              return yield* Effect.failCause(cause);
            }),
          ),
        );
        return { connection, poolScope };
      }),
    );

    const releasePooledConnection = ({
      connection,
      poolScope,
    }: {
      readonly connection: Connection;
      readonly poolScope: Scope.Closeable;
    }) =>
      Effect.gen(function* () {
        yield* resetSqliteConnection(connection);
        yield* Scope.close(poolScope, Exit.void);
      }).pipe(Effect.ensuring(leaseSemaphore.release(1)));

    const acquirer = Effect.map(
      Effect.acquireRelease(acquirePooledConnection, releasePooledConnection),
      ({ connection }) => connection,
    );

    const client = yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer: acquirer,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transformRows,
    });

    return Object.assign(client, {
      poolSettings,
      poolStats,
      healthCheck: sqliteHealthCheck(client),
    });
  });
