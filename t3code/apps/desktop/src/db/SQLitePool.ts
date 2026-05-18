import { Effect, Pool, Schema, Ref } from "effect";

export const SQLitePoolConfig = Schema.Struct({
  databasePath: Schema.String,
  poolSize: Schema.Number.pipe(Schema.positive),
  walMode: Schema.Boolean,
  walAutoCheckpoint: Schema.Number.pipe(Schema.positive),
  busyTimeout: Schema.Number.pipe(SSchema.positive),
});

export class SQLiteDatabase {
  constructor(private readonly db: Database) {}

  exec(sql: string) {
    return Effect.try({ try: () => this.db.exec(sql), catch: (e) => new Error(`SQLite: ${e}`) });
  }

  query<T>(sql: string, params: unknown[] = []) {
    return Effect.try({
      try: () => this.db.prepare(sql).all(...params) as T[],
      catch: (e) => new Error(`SQLite query: ${e}`),
    });
  }

  run(sql: string, params: unknown[] = []) {
    return Effect.try({
      try: () => this.db.prepare(sql).run(...params),
      catch: (e) => new Error(`SQLite run: ${e}`),
    });
  }

  close() {
    return Effect.sync(() => this.db.close());
  }
}

export const SQLitePool = Effect.gen(function* (_) {
  const config = yield* _(
    Effect.config(SQLitePoolConfig).pipe(
      Effect.orElseSucceed(() => ({
        databasePath: ":memory:",
        poolSize: 10,
        walMode: true,
        walAutoCheckpoint: 1000,
        busyTimeout: 5000,
      }))
    )
  );

  const createConnection = Effect.gen(function* (_) {
    const Database = require("better-sqlite3");
    const db = new Database(config.databasePath);

    // Enable WAL mode for concurrent reads
    if (config.walMode) {
      db.pragma("journal_mode = WAL");
      db.pragma(`wal_autocheckpoint = ${config.walAutoCheckpoint}`);
    }

    // Busy timeout for write contention
    db.pragma(`busy_timeout = ${config.busyTimeout}`);

    // Optimizations
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000"); // 64MB cache
    db.pragma("temp_store = MEMORY");

    return new SQLiteDatabase(db);
  });

  const pool = yield* _(
    Pool.make({
      acquire: createConnection,
      size: config.poolSize,
    })
  );

  const use = <A, E>(f: (db: SQLiteDatabase) => Effect.Effect<A, E>) =>
    pool.use(f);

  const getStats = Effect.gen(function* (_) {
    return {
      poolSize: config.poolSize,
      walMode: config.walMode,
      available: pool.size,
    };
  });

  return { use, getStats };
});
