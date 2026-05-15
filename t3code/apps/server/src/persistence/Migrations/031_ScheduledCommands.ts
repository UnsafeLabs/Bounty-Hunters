import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS scheduled_commands (
      command_id TEXT PRIMARY KEY NOT NULL,
      command_json TEXT NOT NULL,
      scheduled_at TEXT NOT NULL,
      repeat_interval TEXT,
      max_retries INTEGER NOT NULL DEFAULT 0 CHECK (max_retries >= 0),
      retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
      run_count INTEGER NOT NULL DEFAULT 0 CHECK (run_count >= 0),
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
      ),
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_scheduled_commands_due
    ON scheduled_commands(status, scheduled_at)
  `;
});
