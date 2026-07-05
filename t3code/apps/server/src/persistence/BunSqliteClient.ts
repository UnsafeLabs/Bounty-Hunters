/**
 * Local Bun SQLite client with pooled connections for the server persistence layer.
 *
 * @module BunSqliteClient
 */
import { Database } from "bun:sqlite";

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
const DEFAULT_BUSY_TIMEOUT_MS = 5000;
const DEFAULT_POOL_MIN_SIZE = 1;
const DEFAULT_POOL_MAX_SIZE = 5;
const DEFAULT_POOL_ACQUIRE_TIMEOUT = Duration.seconds(10);
const DEFAULT_POOL_TTL = Duration.minutes(10);

export const TypeId: TypeId = "~local/sqlite-bun/SqliteClient";
export type TypeId = "~local/sqlite-bun/SqliteClient";

export interface SqliteClient extends Client.SqlClient {
  readonly [TypeId]: TypeId;
  readonly config: SqliteClientConfig;
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
  readonly updateValues: never;
}

export const SqliteClient = Context.Service<SqliteClient>("t3/persistence/BunSqliteClient");

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly create?: boolean | undefined;
  readonly readwrite?: boolean | undefined;
  readonly disableWAL?: boolean | undefined;
  readonly busyTimeoutMs?: number | undefined;
  readonly poolMinSize?: number | undefined;
  readonly poolMaxSize?: number | undefined;
  readonly poolAcquireTimeout?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

interface SqliteConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
}

interface ManagedConnection extends SqliteConnection {
  readonly db: Database;
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

const configureConnection = (db: Database, options: SqliteClientConfig) =>
  Effect.try({
    try: () => {
      const busyTimeoutMs = Math.max(
        0,
        Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS),
      );
      db.run(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA foreign_keys = ON;");

      if (
        options.disableWAL !== true &&
        !isMemoryFilename(options.filename) &&
        options.readonly !== true
      ) {
        const row = db.query("PRAGMA journal_mode = WAL;").get() as
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

const resetConnection = (db: Database, options: SqliteClientConfig) =>
  Effect.sync(() => {
    try {
      const busyTimeoutMs = Math.max(
        0,
        Math.trunc(options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS),
      );
      db.run("PRAGMA reset;");
      db.run(`PRAGMA busy_timeout = ${busyTimeoutMs};`);
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA foreign_keys = ON;");
    } catch {
      // Pool release finalization is best-effort.
    }
  });

const closeDatabase = (db: Database) =>
  Effect.sync(() => {
    try {
      db.close();
    } catch {
      // Closing is best-effort during scope finalization.
    }
  });

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const db = yield* Effect.try({
        try: () =>
          new Database(options.filename, {
            readonly: options.readonly,
            readwrite: options.readwrite ?? true,
            create: options.create ?? true,
          } as any),
        catch: (cause) => sqliteError(cause, "Failed to open sqlite database", "connect"),
      });
      yield* Effect.addFinalizer(() => closeDatabase(db));
      yield* configureConnection(db, options);

      const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-expect-error bun-types missing safeIntegers method, fixed in newer Bun releases.
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.all(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(sqliteError(cause, "Failed to execute statement", "execute"));
          }
        });

      const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-expect-error bun-types missing safeIntegers method, fixed in newer Bun releases.
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.values(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(sqliteError(cause, "Failed to execute statement", "execute"));
          }
        });

      return identity<ManagedConnection>({
        db,
        execute(sql, params, rowTransform) {
          return rowTransform ? Effect.map(run(sql, params), rowTransform) : run(sql, params);
        },
        executeRaw(sql, params) {
          return run(sql, params);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, rowTransform) {
          return this.execute(sql, params, rowTransform);
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
        export: Effect.try({
          try: () => db.serialize(),
          catch: (cause) => sqliteError(cause, "Failed to export database", "export"),
        }),
        loadExtension: (path) =>
          Effect.try({
            try: () => db.loadExtension(path),
            catch: (cause) => sqliteError(cause, "Failed to load extension", "loadExtension"),
          }),
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
    );

    return Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        spanAttributes: [
          ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
          [ATTR_DB_SYSTEM_NAME, "sqlite"],
        ],
        transformRows,
      })) as SqliteClient,
      {
        [TypeId]: TypeId as TypeId,
        config: options,
        export: Effect.scoped(Effect.flatMap(acquirer, (_) => _.export)),
        loadExtension: (path: string) =>
          Effect.scoped(Effect.flatMap(acquirer, (_) => _.loadExtension(path))),
      },
    );
  });

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
