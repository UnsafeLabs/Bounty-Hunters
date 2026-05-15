import * as BunSqliteClient from "@effect/sql-sqlite-bun/SqliteClient";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Reactivity from "effect/unstable/reactivity/Reactivity";
import * as Client from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  makePooledSqliteClient,
  type PooledSqliteClient,
  type PooledSqliteOptions,
  type SqlitePoolConfig,
} from "./SqlitePooledClient.ts";

export const TypeId: TypeId = "~local/sqlite-bun/SqliteClient";

export type TypeId = "~local/sqlite-bun/SqliteClient";

export const SqliteClient = Context.Service<SqliteClient>("t3/persistence/BunSqliteClient");

export interface SqliteClient extends PooledSqliteClient {
  readonly [TypeId]: TypeId;
  readonly config: SqliteClientConfig;
}

export interface SqliteClientConfig extends PooledSqliteOptions {
  readonly filename: string;
  readonly readonly?: boolean | undefined;
  readonly create?: boolean | undefined;
  readonly readwrite?: boolean | undefined;
  readonly disableWAL?: boolean | undefined;
  readonly spanAttributes?: Record<string, unknown> | undefined;
  readonly transformResultNames?: ((str: string) => string) | undefined;
  readonly transformQueryNames?: ((str: string) => string) | undefined;
  readonly pool?: SqlitePoolConfig | undefined;
}

const make = (
  options: SqliteClientConfig,
): Effect.Effect<SqliteClient, SqlError, Scope.Scope | Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const acquireConnection = Effect.gen(function* () {
      const client = yield* BunSqliteClient.make(options);
      return yield* client.reserve;
    });

    const client = yield* makePooledSqliteClient(options, acquireConnection);
    return Object.assign(client, {
      [TypeId]: TypeId,
      config: options,
    });
  });

export const layerConfig = (
  config: Config.Wrap<SqliteClientConfig>,
): Layer.Layer<Client.SqlClient, Config.ConfigError | SqlError> =>
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

export const layer = (config: SqliteClientConfig): Layer.Layer<Client.SqlClient, SqlError> =>
  Layer.effectContext(
    Effect.map(make(config), (client) =>
      Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client)),
    ),
  ).pipe(Layer.provide(Reactivity.layer));
