import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;

  if (!sessionColumns.some((column) => column.name === "last_active_at")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN last_active_at TEXT
    `;
  }

  yield* sql`
    UPDATE auth_sessions
    SET last_active_at = COALESCE(last_active_at, last_connected_at, issued_at)
    WHERE last_active_at IS NULL
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_last_active
    ON auth_sessions(revoked_at, expires_at, last_active_at)
  `;
});
