import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Add last_active_at for debounced activity tracking (issue #835). */
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

  if (!sessionColumns.some((column) => column.name === "device_name")) {
    yield* sql`
      ALTER TABLE auth_sessions
      ADD COLUMN device_name TEXT
    `;
  }
});
