import { Effect, Layer, Pool, Exit, Duration, Either } from "effect"
import * as Sql from "@effect/sql"
import * as Sqlite from "@effect/sql-sqlite-bun"
import { BunFileSystem } from "@effect/platform-bun"

// Database configuration
export const DB_CONFIG = {
  minConnections: 1,
  maxConnections: 5,
  acquireTimeout: Duration.seconds(10),
  busyTimeout: 5000,
}

// Connection pool tag for dependency injection
export class DatabasePool extends Effect.Tag("DatabasePool")<
  DatabasePool,
  Pool.Pool<Sqlite.SqliteClient, never>
>() {}

// Create a single database client with WAL mode enabled
const createClient = Effect.gen(function* () {
  const client = yield* Sqlite.SqliteClient

  // Enable WAL mode for better concurrent access
  yield* client.execute("PRAGMA journal_mode=WAL")
  yield* client.execute(`PRAGMA busy_timeout=${DB_CONFIG.busyTimeout}`)
  yield* client.execute("PRAGMA synchronous=NORMAL")

  // Verify WAL mode is enabled
  const journalMode = yield* client.execute("PRAGMA journal_mode")
  if (journalMode[0]?.journal_mode !== "wal") {
    yield* Effect.fail(new Error("Failed to enable WAL mode"))
  }

  return client
})

// Reset a connection back to clean state before returning to pool
const resetConnection = (client: Sqlite.SqliteClient) =>
  Effect.gen(function* () {
    yield* client.execute("PRAGMA reset")
    return client
  }).pipe(
    Effect.orElseSucceed(() => client)
  )

// Create the connection pool
const makePool = Effect.gen(function* () {
  const pool = yield* Pool.make({
    acquire: createClient,
    minSize: DB_CONFIG.minConnections,
    maxSize: DB_CONFIG.maxConnections,
    acquireTimeout: DB_CONFIG.acquireTimeout,
  })

  return pool
})

// Database pool layer
export const DatabasePoolLive = Layer.effect(DatabasePool, makePool)

// Helper to use a connection from the pool with automatic reset
export const withConnection = <A, E, R>(
  effect: (client: Sqlite.SqliteClient) => Effect.Effect<A, E, R>
) =>
  Effect.gen(function* () {
    const pool = yield* DatabasePool
    return yield* Effect.acquireUseRelease(
      Pool.get(pool),
      (client) => effect(client),
      (client, exit) =>
        Exit.match(exit, {
          onFailure: () => resetConnection(client),
          onSuccess: () => resetConnection(client),
        })
    )
  })

// Execute a query using a pooled connection
export const execute = (sql: string) =>
  withConnection((client) => client.execute(sql))

// Execute a query with parameters using a pooled connection
export const executeRaw = (sql: string, ...params: unknown[]) =>
  withConnection((client) => client.execute(sql, ...params))

// Health check that runs PRAGMA integrity_check
export const healthCheck = Effect.gen(function* () {
  const startTime = Date.now()

  const result = yield* withConnection((client) =>
    client.execute("PRAGMA integrity_check")
  ).pipe(
    Effect.timeout(Duration.seconds(30)),
    Effect.either
  )

  const duration = Date.now() - startTime

  return Either.match(result, {
    onLeft: (error) => ({
      status: "fail" as const,
      healthy: false,
      error: error instanceof Error ? error.message : String(error),
      duration,
      details: null,
    }),
    onRight: (rows) => {
      const integrityResult = rows[0]?.integrity_check
      const passed = integrityResult === "ok"

      return {
        status: passed ? ("pass" as const) : ("fail" as const),
        healthy: passed,
        error: passed ? null : `Integrity check failed: ${integrityResult}`,
        duration,
        details: {
          integrity_check: integrityResult,
        },
      }
    },
  })
})

// Initialize database with schema
export const initializeDatabase = (schema: string) =>
  Effect.gen(function* () {
    yield* execute(schema)
    yield* Effect.log("Database initialized with WAL mode enabled")
  })

// Verify WAL mode is active
export const verifyWalMode = Effect.gen(function* () {
  const result = yield* execute("PRAGMA journal_mode")
  return result[0]?.journal_mode === "wal"
})