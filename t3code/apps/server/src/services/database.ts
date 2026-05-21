import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
export interface DatabaseShape {
  readonly query: (sql: string, params?: readonly unknown[]) => Effect.Effect<readonly unknown[], Error>;
  readonly execute: (sql: string, params?: readonly unknown[]) => Effect.Effect<number, Error>;
}
export class Database extends Context.Service<Database, DatabaseShape>()("t3/server/services/Database") {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      const db = yield* Effect.sync(() => {
        const D = require("better-sqlite3");
        const d = new D("data/t3code.db");
        d.pragma("journal_mode = WAL");
        d.pragma("synchronous = NORMAL");
        d.pragma("cache_size = -64000");
        return d;
      });
      const query = (sql: string, params: readonly unknown[] = []): Effect.Effect<readonly unknown[], Error> =>
        Effect.sync(() => db.prepare(sql).all(...params));
      const execute = (sql: string, params: readonly unknown[] = []): Effect.Effect<number, Error> =>
        Effect.sync(() => db.prepare(sql).run(...params).changes);
      return { query, execute };
    }),
  );
}
