import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_commands (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      command_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      repeat_interval_ms INTEGER,
      max_retries INTEGER NOT NULL DEFAULT 3,
      retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_commands_status_due
    ON scheduled_commands(status, scheduled_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_commands_command_id
    ON scheduled_commands(command_id)
  `;
});
