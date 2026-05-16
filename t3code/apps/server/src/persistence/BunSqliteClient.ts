import { Database, type DatabaseOptions } from "bun:sqlite";

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
import { LockTimeoutError, SqlError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

import { sqlitePoolDefaults } from "./SqlitePoolConfig.ts";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

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
  readonly poolMin?: number | undefined;
  readonly poolMax?: number | undefined;
  readonly poolAcquireTimeout?: Duration.Input | undefined;
  readonly poolTimeToLive?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

interface PooledConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
}

const classifyError = (cause: unknown, message: string, operation: string) =>
  classifySqliteError(cause, {
    message,
    operation,
  });

const timeoutError = () =>
  new SqlError({
    reason: new LockTimeoutError({
      cause: "Timed out acquiring a SQLite connection from the Effect.Pool",
      message: "Timed out acquiring a SQLite connection from the Effect.Pool",
      operation: "pool.acquire",
    }),
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
      const databaseOptions: DatabaseOptions = {
        readwrite: options.readwrite ?? true,
        create: options.create ?? true,
        ...(options.readonly === undefined ? {} : { readonly: options.readonly }),
      };
      const db = new Database(options.filename, databaseOptions);
      yield* Scope.addFinalizer(
        yield* Effect.scope,
        Effect.sync(() => db.close()),
      );

      if (options.disableWAL !== true) {
        db.run("PRAGMA journal_mode = WAL;");
      }
      db.run("PRAGMA busy_timeout = 5000;");
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA foreign_keys = ON;");

      const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<ReadonlyArray<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed(statement.all(...(params as Array<any>)) ?? []);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifyError(cause, "Failed to execute statement", "execute"),
              }),
            );
          }
        });

      const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<ReadonlyArray<ReadonlyArray<unknown>>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-ignore bun-types missing safeIntegers method, fixed in https://github.com/oven-sh/bun/pull/26627
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed(statement.values(...(params as Array<any>)) ?? []);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifyError(cause, "Failed to execute statement", "execute"),
              }),
            );
          }
        });

      return identity<PooledConnection>({
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
          catch: (cause) =>
            new SqlError({
              reason: classifyError(cause, "Failed to export database", "export"),
            }),
        }),
        loadExtension: (path) =>
          Effect.try({
            try: () => db.loadExtension(path),
            catch: (cause) =>
              new SqlError({
                reason: classifyError(cause, "Failed to load extension", "loadExtension"),
              }),
          }),
      });
    });

    const resetConnection = (connection: Connection) =>
      Effect.gen(function* () {
        yield* connection.executeUnprepared("PRAGMA busy_timeout = 5000;", [], undefined);
        yield* connection.executeUnprepared("PRAGMA synchronous = NORMAL;", [], undefined);
        yield* connection.executeUnprepared("PRAGMA foreign_keys = ON;", [], undefined);
        yield* connection.executeUnprepared("PRAGMA query_only = OFF;", [], undefined);
        yield* connection.executeUnprepared("PRAGMA defer_foreign_keys = OFF;", [], undefined);
      }).pipe(Effect.catchCause(() => Effect.void));

    const poolAcquireTimeout = options.poolAcquireTimeout ?? sqlitePoolDefaults.acquireTimeout;
    const pool = yield* Pool.makeWithTTL({
      acquire: makeConnection,
      min: options.poolMin ?? sqlitePoolDefaults.min,
      max: options.poolMax ?? sqlitePoolDefaults.max,
      timeToLive: options.poolTimeToLive ?? sqlitePoolDefaults.timeToLive,
    });

    const acquirer = Effect.gen(function* () {
      const connection = yield* Pool.get(pool).pipe(
        Effect.timeoutOrElse({
          duration: poolAcquireTimeout,
          orElse: () => Effect.fail(timeoutError()),
        }),
      );
      const scope = yield* Effect.scope;
      yield* Scope.addFinalizer(scope, resetConnection(connection));
      return connection;
    });

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
        [TypeId]: TypeId,
        config: options,
        export: Effect.scoped(Effect.flatMap(acquirer, (_) => _.export)),
        loadExtension: (path: string) =>
          Effect.scoped(Effect.flatMap(acquirer, (_) => _.loadExtension(path))),
        updateValues: undefined as never,
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
