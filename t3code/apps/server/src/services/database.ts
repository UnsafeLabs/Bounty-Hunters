import { DatabaseSync } from "node:sqlite";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

export class DatabaseService extends Effect.Service<DatabaseService>()(
  "t3/server/services/Database",
  {
    effect: Effect.gen(function* () {
      const db = yield* Effect.sync(() => {
        const d = new DatabaseSync("data/t3code.db");
        d.exec("PRAGMA journal_mode = WAL");
        d.exec("PRAGMA synchronous = NORMAL");
        d.exec("PRAGMA cache_size = -64000");
        return d;
      });

      function query(sql: string, params: unknown[] = []): Effect.Effect<unknown[], Error> {
        return Effect.try({
          try: () => {
            const stmt = db.prepare(sql);
            return stmt.all(...params);
          },
          catch: (cause) => new Error(`Database query failed: ${cause}`),
        });
      }

      function execute(sql: string, params: unknown[] = []): Effect.Effect<number, Error> {
        return Effect.try({
          try: () => {
            const stmt = db.prepare(sql);
            const result = stmt.run(...params);
            return result.changes;
          },
          catch: (cause) => new Error(`Database execute failed: ${cause}`),
        });
      }

      return { query, execute };
    }),
  },
) {}
