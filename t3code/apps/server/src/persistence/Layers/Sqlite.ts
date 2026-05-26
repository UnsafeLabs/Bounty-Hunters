import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Pool from "effect/Pool";
import * as Duration from "effect/Duration";
import * as Scope from "effect/Scope";
import * as Context from "effect/Context";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";

import { runMigrations } from "../Migrations.ts";
import { ServerConfig } from "../../config.ts";

type RuntimeSqliteLayerConfig = {
  readonly filename: string;
  readonly spanAttributes?: Record<string, unknown>;
};

type Loader = {
  layer: (config: RuntimeSqliteLayerConfig) => Layer.Layer<SqlClient.SqlClient>;
};
const defaultSqliteClientLoaders = {
  bun: () => import("@effect/sql-sqlite-bun/SqliteClient"),
  node: () => import("../NodeSqliteClient.ts"),
} satisfies Record<string, () => Promise<Loader>>;

const makeRuntimeSqliteLayer = Effect.fn("makeRuntimeSqliteLayer")(function* (
  config: RuntimeSqliteLayerConfig,
) {
  const runtime = process.versions.bun !== undefined ? "bun" : "node";
  const loader = defaultSqliteClientLoaders[runtime];
  const clientModule = yield* Effect.promise<Loader>(loader);
  return clientModule.layer(config);
}, Layer.unwrap);

const acquireConnection = (config: RuntimeSqliteLayerConfig) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(makeRuntimeSqliteLayer(config));
    const client = Context.get(context, SqlClient.SqlClient);
    const connection = yield* client.reserve;

    yield* connection.executeUnprepared("PRAGMA journal_mode = WAL;", [], undefined);
    yield* connection.executeUnprepared("PRAGMA busy_timeout = 5000;", [], undefined);
    yield* connection.executeUnprepared("PRAGMA synchronous = NORMAL;", [], undefined);
    yield* connection.executeUnprepared("PRAGMA foreign_keys = ON;", [], undefined);

    return connection;
  });

export const makeSqlitePersistenceLive = Effect.fn("makeSqlitePersistenceLive")(function* (
  dbPath: string,
) {
  if (dbPath !== ":memory:") {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(path.dirname(dbPath), { recursive: true });
  }

  const config: RuntimeSqliteLayerConfig = {
    filename: dbPath,
    spanAttributes: {
      "db.name": dbPath === ":memory:" ? ":memory:" : "t3-server",
      "service.name": "t3-server",
    },
  };

  return Layer.effect(
    SqlClient.SqlClient,
    Effect.gen(function* () {
      const pool = yield* Pool.makeWithTTL({
        acquire: acquireConnection(config),
        min: dbPath === ":memory:" ? 1 : 1,
        max: dbPath === ":memory:" ? 1 : 5,
        timeToLive: Duration.seconds(60),
      });

      const baseContext = yield* Layer.build(makeRuntimeSqliteLayer(config));
      const baseClient = Context.get(baseContext, SqlClient.SqlClient);

      const tempStatement = baseClient`SELECT 1`;
      const compiler = tempStatement.compiler;
      const spanAttributes = tempStatement.spanAttributes;
      const transformRows = tempStatement.transformRows;

      const pooledAcquirer = Pool.get(pool).pipe(
        Effect.tap((connection) =>
          Effect.addFinalizer(() =>
            connection.executeUnprepared("PRAGMA reset;", [], undefined).pipe(Effect.orDie)
          )
        ),
        Effect.timeoutOrElse({
          duration: Duration.seconds(10),
          orElse: () => Effect.fail(new Error("Database connection acquisition timeout (10s)")),
        }),
      );

      const client = yield* SqlClient.make({
        acquirer: pooledAcquirer,
        compiler,
        transactionAcquirer: pooledAcquirer,
        spanAttributes,
        transformRows,
      });

      const healthCheck = () =>
        Effect.gen(function* () {
          const result = yield* client.unsafe("PRAGMA integrity_check;");
          const firstRow = result[0];
          const details = firstRow ? (Object.values(firstRow)[0] as string) : "";
          const status = details === "ok" ? "pass" : "fail";
          return { status, details };
        });

      const sqlClient = Object.assign(client, { healthCheck });

      // Run migrations on the pooled client!
      const context = Context.make(SqlClient.SqlClient, sqlClient);
      yield* runMigrations().pipe(Effect.provide(context));

      return sqlClient;
    }),
  ).pipe(Layer.provide(Reactivity.layer));
}, Layer.unwrap);

export const SqlitePersistenceMemory = Layer.unwrap(
  Effect.succeed(makeSqlitePersistenceLive(":memory:")),
);

export const layerConfig = Layer.unwrap(
  Effect.map(Effect.service(ServerConfig), ({ dbPath }) => makeSqlitePersistenceLive(dbPath)),
);
