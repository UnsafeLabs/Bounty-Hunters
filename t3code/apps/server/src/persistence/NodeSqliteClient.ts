/**
 * Port of `@effect/sql-sqlite-node` that uses the native `node:sqlite`
 * bindings instead of `better-sqlite3`.
 *
 * @module SqliteClient
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError, isSqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";
export const SQLITE_POOL_MIN_SIZE = 1;
export const SQLITE_POOL_MAX_SIZE = 5;
export const SQLITE_POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);
const SQLITE_POOL_TTL = Duration.minutes(5);

export const TypeId: TypeId = "~local/sqlite-node/SqliteClient";

export type TypeId = "~local/sqlite-node/SqliteClient";

/**
 * SqliteClient - Effect service tag for the sqlite SQL client.
 */
export const SqliteClient = Context.Service<SqliteClient>("t3/persistence/NodeSqliteClient");

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly allowExtension?: boolean | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

export interface SqliteMemoryClientConfig extends Omit<
  SqliteClientConfig,
  "filename" | "readonly"
> {}

export interface SqliteHealthCheckResult {
  readonly ok: boolean;
  readonly details: ReadonlyArray<string>;
}

interface PooledConnection extends Connection {
  readonly reset: Effect.Effect<void, SqlError>;
  readonly healthCheck: Effect.Effect<SqliteHealthCheckResult, SqlError>;
}

export interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId;
  readonly pool: Pool.Pool<PooledConnection, SqlError>;
  readonly healthCheck: Effect.Effect<SqliteHealthCheckResult, SqlError>;
}

const makeSqlError = (cause: unknown, message: string, operation: string) =>
  new SqlError({
    reason: classifySqliteError(cause, {
      message,
      operation,
    }),
  });

const executePragma = (db: DatabaseSync, sql: string, operation: string) =>
  Effect.try({
    try: () => {
      db.exec(sql);
    },
    catch: (cause) => makeSqlError(cause, `Failed to ${operation}`, operation),
  });

const initializeConnection = (db: DatabaseSync, filename: string) =>
  Effect.all(
    [
      filename === ":memory:"
        ? Effect.void
        : executePragma(db, "PRAGMA journal_mode = WAL;", "enable WAL mode"),
      executePragma(db, "PRAGMA busy_timeout = 5000;", "set busy timeout"),
      executePragma(db, "PRAGMA synchronous = NORMAL;", "set synchronous mode"),
      executePragma(db, "PRAGMA foreign_keys = ON;", "enable foreign keys"),
    ],
    { discard: true },
  );

const resetConnection = (db: DatabaseSync) =>
  Effect.all(
    [
      executePragma(db, "PRAGMA busy_timeout = 5000;", "reset busy timeout"),
      executePragma(db, "PRAGMA synchronous = NORMAL;", "reset synchronous mode"),
      executePragma(db, "PRAGMA foreign_keys = ON;", "reset foreign keys"),
    ],
    { discard: true },
  );

const runIntegrityCheck = (db: DatabaseSync) =>
  Effect.map(
    Effect.try({
      try: () =>
        db
          .prepare("PRAGMA integrity_check;")
          .all()
          .map((row) => {
            const values = Object.values(row as Record<string, unknown>);
            return String((row as Record<string, unknown>).integrity_check ?? values[0] ?? "");
          }),
      catch: (cause) => makeSqlError(cause, "Failed to run integrity check", "integrity_check"),
    }),
    (details): SqliteHealthCheckResult => ({
      ok: details.length > 0 && details.every((detail) => detail === "ok"),
      details,
    }),
  );

/**
 * Verify that the current Node.js version includes the `node:sqlite` APIs
 * used by `NodeSqliteClient` — specifically `StatementSync.columns()` (added
 * in Node 22.16.0 / 23.11.0).
 *
 * @see https://github.com/nodejs/node/pull/57490
 */
const checkNodeSqliteCompat = () => {
  const parts = process.versions.node.split(".").map(Number);
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const supported = (major === 22 && minor >= 16) || (major === 23 && minor >= 11) || major >= 24;

  if (!supported) {
    return Effect.die(
      `Node.js ${process.versions.node} is missing required node:sqlite APIs ` +
        `(StatementSync.columns). Upgrade to Node.js >=22.16, >=23.11, or >=24.`,
    );
  }
  return Effect.void;
};

const makeWithDatabase = Effect.fn("makeWithDatabase")(function* (
  options: SqliteClientConfig,
  openDatabase: () => DatabaseSync,
): Effect.fn.Return<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> {
  yield* checkNodeSqliteCompat();

  const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
  const transformRows = options.transformResultNames
    ? Statement.defaultTransforms(options.transformResultNames).array
    : undefined;

  const makeConnection = Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const db = openDatabase();
    yield* initializeConnection(db, options.filename);
    yield* Scope.addFinalizer(
      scope,
      Effect.sync(() => db.close()),
    );

    const statementReaderCache = new WeakMap<StatementSync, boolean>();
    const hasRows = (statement: StatementSync): boolean => {
      const cached = statementReaderCache.get(statement);
      if (cached !== undefined) {
        return cached;
      }
      const value = statement.columns().length > 0;
      statementReaderCache.set(statement, value);
      return value;
    };

    const prepareCache = yield* Cache.make({
      capacity: options.prepareCacheSize ?? 200,
      timeToLive: options.prepareCacheTTL ?? Duration.minutes(10),
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

    const runStatement = (statement: StatementSync, params: ReadonlyArray<unknown>, raw: boolean) =>
      Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
        statement.setReadBigInts(Boolean(Context.get(fiber.context, Client.SafeIntegers)));
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
        (statement) =>
          Effect.try({
            try: () => {
              if (hasRows(statement)) {
                statement.setReturnArrays(true);
                // Safe to cast to array after we've setReturnArrays(true)
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
        (statement) =>
          Effect.sync(() => {
            if (hasRows(statement)) {
              statement.setReturnArrays(false);
            }
          }),
      );

    return identity<PooledConnection>({
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
      reset: resetConnection(db),
      healthCheck: runIntegrityCheck(db),
    });
  });

  const poolBounds =
    options.filename === ":memory:"
      ? { min: 1, max: 1 }
      : { min: SQLITE_POOL_MIN_SIZE, max: SQLITE_POOL_MAX_SIZE };
  const pool = yield* Pool.makeWithTTL({
    acquire: makeConnection,
    min: poolBounds.min,
    max: poolBounds.max,
    timeToLive: SQLITE_POOL_TTL,
  });

  const acquirer: Effect.Effect<PooledConnection, SqlError, Scope.Scope> = Pool.get(pool).pipe(
    Effect.timeout(SQLITE_POOL_ACQUIRE_TIMEOUT),
    Effect.mapError((cause) =>
      isSqlError(cause)
        ? cause
        : makeSqlError(cause, "Timed out acquiring sqlite connection", "acquire"),
    ),
    Effect.tap((connection) =>
      Effect.addFinalizer(() => connection.reset.pipe(Effect.catch(() => Effect.void))),
    ),
  );

  return Object.assign(
    yield* Client.make({
      acquirer,
      compiler,
      transactionAcquirer: acquirer,
      spanAttributes: [
        ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
        [ATTR_DB_SYSTEM_NAME, "sqlite"],
      ],
      transformRows,
    }),
    {
      [TypeId]: TypeId as TypeId,
      pool,
      healthCheck: Effect.scoped(Effect.flatMap(acquirer, (connection) => connection.healthCheck)),
    },
  );
});

const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  makeWithDatabase(
    options,
    () =>
      new DatabaseSync(options.filename, {
        readOnly: options.readonly ?? false,
        allowExtension: options.allowExtension ?? false,
      }),
  );

const makeMemory = (
  config: SqliteMemoryClientConfig = {},
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  makeWithDatabase(
    {
      ...config,
      filename: ":memory:",
      readonly: false,
    },
    () => {
      const database = new DatabaseSync(":memory:", {
        allowExtension: config.allowExtension ?? false,
      });
      return database;
    },
  );

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<SqliteClient | Client.SqlClient, Config.ConfigError> =>
  Layer.effectContext(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(make),
        Effect.map((client) =>
          Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig): Layer.Layer<SqliteClient | Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerMemory = (
  config: SqliteMemoryClientConfig = {},
): Layer.Layer<SqliteClient | Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(makeMemory(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
