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
import * as Fiber from "effect/Fiber";
import { identity } from "effect/Function";
import * as Layer from "effect/Layer";
import * as Pool from "effect/Pool";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Context from "effect/Context";
import * as Stream from "effect/Stream";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { Connection } from "effect/unstable/sql/SqlConnection";
import { SqlError, UnknownError, classifySqliteError } from "effect/unstable/sql/SqlError";
import * as Statement from "effect/unstable/sql/Statement";

const ATTR_DB_SYSTEM_NAME = "db.system.name";

export const TypeId: TypeId = "~local/sqlite-node/SqliteClient";

export type TypeId = "~local/sqlite-node/SqliteClient";

/**
 * SqliteClient - Effect service tag for the sqlite SQL client.
 */
export const SqliteClient = Context.Service<Client.SqlClient>("t3/persistence/NodeSqliteClient");

export interface SqliteHealthResult {
  readonly ok: boolean;
  readonly details: ReadonlyArray<string>;
}

export interface SqliteHealthShape {
  readonly check: Effect.Effect<SqliteHealthResult, SqlError>;
}

export const SqliteHealth =
  Context.Service<SqliteHealthShape>("t3/persistence/NodeSqliteHealth");

export interface SqliteClientConfig {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly allowExtension?: boolean | undefined;
  readonly prepareCacheSize?: number | undefined;
  readonly prepareCacheTTL?: Duration.Input | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
  readonly poolMin?: number | undefined;
  readonly poolMax?: number | undefined;
  readonly acquireTimeout?: Duration.Input | undefined;
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

const makeWithDatabase = Effect.fn("makeWithDatabase")(function* (
  options: SqliteClientConfig,
  openDatabase: () => DatabaseSync,
): Effect.fn.Return<
  readonly [Client.SqlClient, SqliteHealthShape],
  never,
  Scope.Scope | Reactivity.Reactivity
> {
  yield* checkNodeSqliteCompat();

  const compiler = Statement.makeCompilerSqlite(options.transformQueryNames);
  const transformRows = options.transformResultNames
    ? Statement.defaultTransforms(options.transformResultNames).array
    : undefined;

  const makeConnection = Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const db = openDatabase();
    if (options.filename !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL;");
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("PRAGMA synchronous = NORMAL;");
    }
    db.exec("PRAGMA foreign_keys = ON;");
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

    return identity<Connection>({
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
  });

  const resetConnection = (connection: Connection) =>
    connection.executeUnprepared("PRAGMA reset;", [], undefined).pipe(
      Effect.andThen(connection.executeUnprepared("PRAGMA foreign_keys = ON;", [], undefined)),
      Effect.andThen(connection.executeUnprepared("PRAGMA busy_timeout = 5000;", [], undefined)),
      Effect.andThen(connection.executeUnprepared("PRAGMA synchronous = NORMAL;", [], undefined)),
      Effect.ignore,
    );

  const isMemory = options.filename === ":memory:";
  const semaphore = isMemory ? yield* Semaphore.make(1) : undefined;
  const directConnection = isMemory ? yield* makeConnection : undefined;
  const connectionPool = isMemory
    ? undefined
    : yield* Pool.makeWithTTL({
        acquire: makeConnection,
        min: options.poolMin ?? 1,
        max: options.poolMax ?? 5,
        timeToLive: Duration.minutes(5),
      });

  const acquireFromPool = Effect.acquireRelease(
    Pool.get(connectionPool!),
    resetConnection,
  ).pipe(
    Effect.timeout(options.acquireTimeout ?? "10 seconds"),
    Effect.mapError((cause) =>
      cause instanceof SqlError
        ? cause
        : new SqlError({
            reason: new UnknownError({
              cause,
              operation: "pool.acquire",
              message: "Timed out acquiring sqlite connection from pool",
            }),
          }),
    ),
  );

  const acquirer =
    directConnection !== undefined && semaphore !== undefined
      ? semaphore.withPermits(1)(Effect.succeed(directConnection))
      : acquireFromPool;
  const transactionAcquirer =
    directConnection !== undefined && semaphore !== undefined
      ? Effect.uninterruptibleMask((restore) => {
          const fiber = Fiber.getCurrent()!;
          const scope = Context.getUnsafe(fiber.context, Scope.Scope);
          return Effect.as(
            Effect.tap(restore(semaphore.take(1)), () =>
              Scope.addFinalizer(scope, semaphore.release(1)),
            ),
            directConnection,
          );
        })
      : acquireFromPool;

  const client = yield* Client.make({
    acquirer,
    compiler,
    transactionAcquirer,
    spanAttributes: [
      ...(options.spanAttributes ? Object.entries(options.spanAttributes) : []),
      [ATTR_DB_SYSTEM_NAME, "sqlite"],
    ],
    transformRows,
  });
  const health: SqliteHealthShape = {
    check: client`PRAGMA integrity_check;`.pipe(
      Effect.map((rows) => {
        const details = rows.flatMap((row) =>
          Object.values(row as Record<string, unknown>).map(String),
        );
        return {
          ok: details.length === 1 && details[0] === "ok",
          details,
        };
      }),
    ),
  };
  return [client, health] as const;
});

const make = (
  options: SqliteClientConfig,
): Effect.Effect<
  readonly [Client.SqlClient, SqliteHealthShape],
  never,
  Scope.Scope | Reactivity.Reactivity
> =>
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
): Effect.Effect<
  readonly [Client.SqlClient, SqliteHealthShape],
  never,
  Scope.Scope | Reactivity.Reactivity
> =>
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
) =>
  Layer.effectContext(
    Config.unwrap(config)
      .asEffect()
      .pipe(
        Effect.flatMap(make),
        Effect.map(([client, health]) =>
          Context.make(SqliteClient, client)
            .pipe(Context.add(Client.SqlClient, client))
            .pipe(Context.add(SqliteHealth, health)),
        ),
      ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layer = (config: SqliteClientConfig) =>
  Layer.effectContext(
    Effect.map(make(config), ([client, health]) =>
      Context.make(SqliteClient, client)
        .pipe(Context.add(Client.SqlClient, client))
        .pipe(Context.add(SqliteHealth, health)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));

export const layerMemory = (config: SqliteMemoryClientConfig = {}) =>
  Layer.effectContext(
    Effect.map(makeMemory(config), ([client, health]) =>
      Context.make(SqliteClient, client)
        .pipe(Context.add(Client.SqlClient, client))
        .pipe(Context.add(SqliteHealth, health)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
