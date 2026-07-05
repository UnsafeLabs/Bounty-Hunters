/**
 * Port of `@effect/sql-sqlite-node` that uses the native `node:sqlite`
 * bindings instead of `better-sqlite3`.
 *
 * @module SqliteClient
 */
import { DatabaseSync, type StatementSync } from "node:sqlite";

import * as Cache from "effect/Cache";
import * as Config from "effect/Config";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Scope from "effect/Scope";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, classifySqliteError, isSqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";
const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const DEFAULT_POOL_MIN_SIZE = 1;
const DEFAULT_POOL_MAX_SIZE = 5;
const DEFAULT_POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);
const DEFAULT_POOL_TTL = Duration.minutes(10);

export const TypeId: TypeId = "~local/sqlite-node/SqliteClient";

export type TypeId = "~local/sqlite-node/SqliteClient";

/**
 * SqliteClient - Effect service tag for the sqlite SQL client.
 */
export const SqliteClient = Context.Service<Client.SqlClient>("t3/persistence/NodeSqliteClient");

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly allowExtension?: boolean | undefined;
  readonly busyTimeoutMs?: number | undefined;
  readonly poolMinSize?: number | undefined;
  readonly poolMaxSize?: number | undefined;
  readonly poolAcquireTimeout?: Duration.Input | undefined;
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

interface ManagedConnection {
  readonly db: DatabaseSync;
  readonly connection: Connection;
}

const isMemoryFilename = (filename: string): boolean => filename === ":memory:";

const normalizedPoolSize = (value: number | undefined, fallback: number): number =>
  Math.max(1, Math.trunc(value ?? fallback));

const sqliteError = (cause: unknown, message: string, operation: string) =>
  new SqlError({
    reason: classifySqliteError(cause, {
      message,
      operation,
    }),
  });

const configureConnection = (db: DatabaseSync, options: SqliteClientConfig) =>
  Effect.try({
    try: () => {
      const busyTimeoutMs = Math.max(
        0,
        Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS),
      );
      db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      db.exec("PRAGMA synchronous = NORMAL;");
      db.exec("PRAGMA foreign_keys = ON;");

      if (!isMemoryFilename(options.filename) && options.readonly !== true) {
        const row = db.prepare("PRAGMA journal_mode = WAL;").get() as
          | { readonly journal_mode?: unknown }
          | undefined;
        const journalMode = String(row?.journal_mode ?? "").toLowerCase();
        if (journalMode !== "wal") {
          throw new Error(
            `SQLite did not enter WAL journal mode; received ${journalMode || "unknown"}`,
          );
        }
      }
    },
    catch: (cause) => sqliteError(cause, "Failed to configure sqlite connection", "configure"),
  });

const resetConnection = (db: DatabaseSync, options: SqliteClientConfig) =>
  Effect.sync(() => {
    try {
      const busyTimeoutMs = Math.max(
        0,
        Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS),
      );
      db.exec("PRAGMA reset;");
      db.exec(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      db.exec("PRAGMA synchronous = NORMAL;");
      db.exec("PRAGMA foreign_keys = ON;");
    } catch {
      // Pool release finalization is best-effort.
    }
  });

const closeDatabase = (db: DatabaseSync) =>
  Effect.sync(() => {
    try {
      db.close();
    } catch {
      // Closing is best-effort during scope finalization.
    }
  });

const makeWithDatabase = Effect.fn("makeWithDatabase")(function* (
  options: SqliteClientConfig,
  openDatabase: () => DatabaseSync,
): Effect.fn.Return<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> {
  yield* checkNodeSqliteCompat();

  const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
  const transformRows = options.transformResultNames
    ? Statement.defaultTransforms(options.transformResultNames).array
    : undefined;

  const makeConnection = Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const db = yield* Effect.try({
      try: openDatabase,
      catch: (cause) => sqliteError(cause, "Failed to open sqlite database", "connect"),
    });
    yield* configureConnection(db, options);
    yield* Scope.addFinalizer(scope, closeDatabase(db));

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

    const connection = identity<Connection>({
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
    });

    return identity<ManagedConnection>({
      db,
      connection,
    });
  });

  const minSize = isMemoryFilename(options.filename)
    ? 1
    : normalizedPoolSize(options.poolMinSize, DEFAULT_POOL_MIN_SIZE);
  const maxSize = isMemoryFilename(options.filename)
    ? 1
    : Math.max(minSize, normalizedPoolSize(options.poolMaxSize, DEFAULT_POOL_MAX_SIZE));
  const acquireTimeout = options.poolAcquireTimeout ?? DEFAULT_POOL_ACQUIRE_TIMEOUT;

  const connectionPool = yield* Pool.makeWithTTL({
    acquire: makeConnection,
    min: minSize,
    max: maxSize,
    timeToLive: DEFAULT_POOL_TTL,
  });

  const acquireManagedConnection = Pool.get(connectionPool).pipe(
    Effect.timeout(acquireTimeout),
    Effect.mapError((cause) =>
      isSqlError(cause)
        ? cause
        : sqliteError(cause, "Timed out acquiring sqlite connection from pool", "acquire"),
    ),
  );

  const acquirer = Effect.acquireRelease(acquireManagedConnection, (managed) =>
    resetConnection(managed.db, options),
  ).pipe(Effect.map((managed) => managed.connection));

  return yield* Client.make({
    acquirer,
    compiler,
    spanAttributes: [
      ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
      [ATTR_DB_SYSTEM_NAME, "sqlite"],
    ],
    transformRows,
  });
});

const make = (
  options: SqliteClientConfig,
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
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
): Effect.Effect<Client.SqlClient, never, Scope.Scope | Reactivity.Reactivity> =>
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
): Layer.Layer<Client.SqlClient, Config.ConfigError> =>
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

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerMemory = (config: SqliteMemoryClientConfig = {}): Layer.Layer<Client.SqlClient> =>
  Layer.effectContext(
    Effect.map(makeMemory(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
