/**
 * SQLite WAL mode and connection pooling configuration.
 * Enables Write-Ahead Logging for better concurrent access.
 */

import Database from "better-sqlite3";

interface WALConfig {
  /** Enable WAL mode (default: true) */
  enableWAL?: boolean;
  /** Journal size limit in pages (default: 6144 = 24MB) */
  journalSizeLimit?: number;
  /** Busy timeout in ms (default: 5000) */
  busyTimeout?: number;
  /** Synchronous mode: OFF | NORMAL | FULL | EXTRA (default: NORMAL) */
  synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
  /** Cache size in pages (default: -2000 = 2MB) */
  cacheSize?: number;
  /** Mmap size in bytes (default: 268435456 = 256MB) */
  mmapSize?: number;
}

/**
 * Configure SQLite database with WAL mode and optimized settings.
 */
export function configureSQLite(
  db: Database.Database,
  config: WALConfig = {}
): void {
  const {
    enableWAL = true,
    journalSizeLimit = 6144,
    busyTimeout = 5000,
    synchronous = "NORMAL",
    cacheSize = -2000,
    mmapSize = 268435456,
  } = config;

  // Enable WAL mode
  if (enableWAL) {
    db.pragma("journal_mode = WAL");
  }

  // Set journal size limit
  db.pragma(`journal_size_limit = ${journalSizeLimit}`);

  // Set busy timeout
  db.pragma(`busy_timeout = ${busyTimeout}`);

  // Set synchronous mode (NORMAL is safe with WAL)
  db.pragma(`synchronous = ${synchronous}`);

  // Set cache size (negative = KB, positive = pages)
  db.pragma(`cache_size = ${cacheSize}`);

  // Enable memory-mapped I/O
  db.pragma(`mmap_size = ${mmapSize}`);

  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  // Optimize for WAL mode
  db.pragma("wal_autocheckpoint = 1000");
}

/**
 * Create a connection pool for SQLite with WAL support.
 */
export function createSQLitePool(
  dbPath: string,
  poolSize: number = 4,
  config: WALConfig = {}
): Database.Database[] {
  const pool: Database.Database[] = [];

  for (let i = 0; i < poolSize; i++) {
    const db = new Database(dbPath, {
      readonly: i > 0, // First connection is read-write, rest are read-only
    });
    configureSQLite(db, config);
    pool.push(db);
  }

  return pool;
}

/**
 * Checkpoint the WAL file to prevent unbounded growth.
 */
export function checkpointWAL(db: Database.Database): void {
  db.pragma("wal_checkpoint(TRUNCATE)");
}
