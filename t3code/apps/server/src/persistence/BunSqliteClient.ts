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
import { classifySqliteError, SqlError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";
const ACQUIRE_TIMEOUT = Duration.seconds(10);
const POOL_MIN_SIZE = 1;
const POOL_MAX_SIZE = 5;
const POOL_TTL = Duration.minutes(10);

const classifyError = (cause: unknown, message: string, operation: string) =>
  classifySqliteError(cause, { message, operation });

const acquireTimeoutError = (cause: unknown) =>
  new SqlError({
    reason: classifyError(cause, "Timed out acquiring sqlite connection", "acquire"),
  });

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

  readonly spanAttributes?: Record<string, unknown> | undefined;

  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
}

interface SqliteConnection extends Connection {
  readonly export: Effect.Effect<Uint8Array, SqlError>;
  readonly loadExtension: (path: string) => Effect.Effect<void, SqlError>;
}

const isMemoryDatabase = (filename: string) => filename === ":memory:";

const configureDatabase = (db: Database, options: SqliteClientConfig) =>
  Effect.try({
    try: () => {
      if (
        options.disableWAL !== true &&
        options.readonly !== true &&
        !isMemoryDatabase(options.filename)
      ) {
        db.run("PRAGMA journal_mode = WAL;");
      }
      db.run("PRAGMA busy_timeout = 5000;");
      db.run("PRAGMA synchronous = NORMAL;");
      db.run("PRAGMA foreign_keys = ON;");
    },
    catch: (cause) =>
      new SqlError({
        reason: classifyError(cause, "Failed to configure sqlite connection", "configure"),
      }),
  });

const resetConnection = (connection: Connection) =>
  Effect.all(
    [
      connection.executeUnprepared("PRAGMA busy_timeout = 5000", [], undefined),
      connection.executeUnprepared("PRAGMA synchronous = NORMAL", [], undefined),
      connection.executeUnprepared("PRAGMA foreign_keys = ON", [], undefined),
    ],
    { discard: true },
  );

export const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, never, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
    const transformRows = options.transformResultNames
      ? Statement.defaultTransforms(options.transformResultNames).array
      : undefined;

    const makeConnection = Effect.gen(function* () {
      const db = new Database(options.filename, {
        readonly: options.readonly,
        readwrite: options.readwrite ?? true,
        create: options.create ?? true,
      } as any);
      yield* Effect.addFinalizer(() => Effect.sync(() => db.close()));
      yield* configureDatabase(db, options);

      const run = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-ignore bun-types may lag the safeIntegers API.
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.all(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifyError(cause, "Failed to execute statement", "execute"),
              }),
            );
          }
        });

      const runValues = (sql: string, params: ReadonlyArray<unknown> = []) =>
        Effect.withFiber<Array<any>, SqlError>((fiber) => {
          const statement = db.query(sql);
          const useSafeIntegers = Context.get(fiber.context, Client.SafeIntegers);
          // @ts-ignore bun-types may lag the safeIntegers API.
          statement.safeIntegers(useSafeIntegers);
          try {
            return Effect.succeed((statement.values(...(params as any)) ?? []) as Array<any>);
          } catch (cause) {
            return Effect.fail(
              new SqlError({
                reason: classifyError(cause, "Failed to execute statement", "execute"),
              }),
            );
          }
        });

      return identity<SqliteConnection>({
        execute(sql, params, transformRows) {
          return transformRows ? Effect.map(run(sql, params), transformRows) : run(sql, params);
        },
        executeRaw(sql, params) {
          return run(sql, params);
        },
        executeValues(sql, params) {
          return runValues(sql, params);
        },
        executeUnprepared(sql, params, transformRows) {
          return this.execute(sql, params, transformRows);
        },
        executeStream(_sql, _params) {
          return Stream.die("executeStream not implemented");
        },
        export: Effect.try({
          try: () => db.serialize(),
          catch: (cause) =>
            new SqlError({ reason: classifyError(cause, "Failed to export database", "export") }),
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

    const pool = yield* isMemoryDatabase(options.filename)
      ? Pool.make({
          acquire: makeConnection,
          size: 1,
        })
      : Pool.makeWithTTL({
          acquire: makeConnection,
          min: POOL_MIN_SIZE,
          max: POOL_MAX_SIZE,
          timeToLive: POOL_TTL,
        });
    const makePooledAcquirer = <A extends Connection>(pool: Pool.Pool<A, SqlError>) =>
      Effect.acquireRelease(
        Effect.mapError(Effect.timeout(Pool.get(pool), ACQUIRE_TIMEOUT), acquireTimeoutError),
        (connection) => Effect.orDie(resetConnection(connection)),
      );
    const acquirer = makePooledAcquirer(pool);

    return Object.assign(
      (yield* Client.make({
        acquirer,
        compiler,
        transactionAcquirer: acquirer,
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
