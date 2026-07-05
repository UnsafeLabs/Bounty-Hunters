import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export interface SqliteHealthCheckResult {
  readonly ok: boolean;
  readonly details: ReadonlyArray<string>;
}

export const sqliteHealthCheck = Effect.fn("sqliteHealthCheck")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<Readonly<Record<string, unknown>>>`PRAGMA integrity_check`;
  const details = rows.map((row) => String(Object.values(row)[0] ?? ""));
  return {
    ok: details.length > 0 && details.every((detail) => detail.toLowerCase() === "ok"),
    details,
  } satisfies SqliteHealthCheckResult;
});
