import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS deferred_scheduler_commands (
      id TEXT PRIMARY KEY,
      command_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      schedule_type TEXT NOT NULL,
      schedule_config TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      next_run_at TEXT,
      last_error TEXT,
      run_count INTEGER NOT NULL DEFAULT 0
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deferred_scheduler_status
    ON deferred_scheduler_commands(status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_deferred_scheduler_next_run
    ON deferred_scheduler_commands(next_run_at)
  `;
});
