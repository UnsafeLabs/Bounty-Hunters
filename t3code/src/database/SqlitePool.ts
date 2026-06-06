import { Effect, Pool, Option, Duration, Exit } from "effect"
import * as Sql from "@effect/sql"
import * as Sqlite from "@effect/sql-sqlite-bun"
import { BunFileSystem } from "@effect/platform-bun"

export interface SqlitePoolConfig {
  readonly filename: string
  readonly minConnections: number
  readonly maxConnections: number
  readonly acquireTimeout: Duration.Duration
}

export const defaultConfig: SqlitePoolConfig = {
  filename: ":memory:",
  minConnections: 1,
  maxConnections: 5,
  acquireTimeout: Duration.seconds(10)
}

const initializeConnection = (filename: string) => Effect.gen(function* () {
  const client = yield* Sqlite.client({
    filename
  })
  
  yield* client.execute("PRAGMA journal_mode=WAL")
  yield* client.execute("PRAGMA busy_timeout=5000")
  yield* client.execute("PRAGMA synchronous=NORMAL")
  
  return client
})

const resetConnection = (client: Sqlite.SqliteClient) => 
  client.execute("PRAGMA reset").pipe(
    Effect.orElse(() => Effect.succeed(undefined)),
    Effect.asUnit
  )

export const makeSqlitePool = (config: SqlitePoolConfig = defaultConfig) => Effect.gen(function* () {
  const pool = yield* Pool.make({
    acquire: initializeConnection(config.filename),
    min: config.minConnections,
    max: config.maxConnections,
    strategy: "fifo"
  })
  
  yield* Effect.log("SQLite pool initialized with WAL mode")
  
  return {
    pool,
    
    get: () => Effect.gen(function* () {
      const connection = yield* Effect.timeout(
        Pool.get(pool),
        config.acquireTimeout
      )
      return connection
    }),
    
    withConnection: <A, E, R>(effect: (client: Sqlite.SqliteClient) => Effect.Effect<A, E, R>) => 
      Effect.acquireUseRelease(
        Effect.timeout(Pool.get(pool), config.acquireTimeout),
        (client) => effect(client),
        (client) => resetConnection(client)
      ),
    
    execute: (sql: string) => Effect.gen(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.timeout(Pool.get(pool), config.acquireTimeout),
        (client) => client.execute(sql),
        (client) => resetConnection(client)
      )
    }),
    
    executeQuery: <A>(sql: string, params?: ReadonlyArray<unknown>) => Effect.gen(function* () {
      return yield* Effect.acquireUseRelease(
        Effect.timeout(Pool.get(pool), config.acquireTimeout),
        (client) => client.execute(sql, ...(params ?? [])),
        (client) => resetConnection(client)
      )
    }),
    
    healthCheck: () => Effect.gen(function* () {
      const result = yield* Effect.acquireUseRelease(
        Effect.timeout(Pool.get(pool), config.acquireTimeout),
        (client) => client.execute("PRAGMA integrity_check"),
        (client) => resetConnection(client)
      )
      
      const integrityResult = Array.isArray(result) && result.length > 0 
        ? result[0] 
        : result
      
      const isHealthy = 
        typeof integrityResult === "object" && 
        integrityResult !== null &&
        "integrity_check" in integrityResult &&
        integrityResult.integrity_check === "ok"
      
      return {
        status: isHealthy ? "pass" as const : "fail" as const,
        details: isHealthy 
          ? "Database integrity verified" 
          : `Integrity check failed: ${JSON.stringify(integrityResult)}`
      }
    }),
    
    getPoolSize: () => Effect.succeed(pool.size),
    
    getAvailable: () => Effect.succeed(pool.available),
    
    shutdown: () => pool.shutdown
  }
})

export interface SqlitePool extends Effect.Effect.Success<typeof makeSqlitePool> {}

export const SqlitePool = Effect.Tag<SqlitePool>("SqlitePool")

export const layer = (config?: SqlitePoolConfig) => Effect.gen(function* () {
  const pool = yield* makeSqlitePool(config)
  return { [SqlitePool.key]: pool }
}).pipe(
  Effect.provide(BunFileSystem.layer),
  Effect.map(pool => ({ [SqlitePool.key]: pool[SqlitePool.key] }))
)

export const layerConfig = (config: SqlitePoolConfig) => Effect.gen(function* () {
  const pool = yield* makeSqlitePool(config)
  return { [SqlitePool.key]: pool }
}).pipe(
  Effect.provide(BunFileSystem.layer),
  Effect.map(pool => ({ [SqlitePool.key]: pool[SqlitePool.key] }))
)