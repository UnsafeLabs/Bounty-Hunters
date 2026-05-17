/**
 * SQLite Health Check
 *
 * Provides a health check service that runs `PRAGMA integrity_check`
 * on the SQLite database and reports pass/fail with details.
 *
 * @module SqliteHealthCheck
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  readonly status: "pass" | "fail";
  readonly checks: ReadonlyArray<HealthCheckDetail>;
  readonly timestamp: string;
}

export interface HealthCheckDetail {
  readonly name: string;
  readonly status: "pass" | "fail";
  readonly message?: string;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SqliteHealthCheckService extends Context.Service<SqliteHealthCheckService>()(
  "t3/persistence/SqliteHealthCheck",
) {
  static readonly Live = Layer.effect(
    SqliteHealthCheckService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const runIntegrityCheck = Effect.fn(function* () {
        const startTime = Date.now();
        const rows = yield* sql<{ readonly integrity_check: string }>`PRAGMA integrity_check`;
        const durationMs = Date.now() - startTime;
        const result = rows[0]?.integrity_check ?? "unknown";

        return {
          name: "integrity_check",
          status: result === "ok" ? "pass" as const : "fail" as const,
          message: result === "ok" ? undefined : result,
          durationMs,
        } satisfies HealthCheckDetail;
      });

      const runWalCheck = Effect.fn(function* () {
        const startTime = Date.now();
        const rows = yield* sql<{ readonly journal_mode: string }>`PRAGMA journal_mode`;
        const durationMs = Date.now() - startTime;
        const mode = rows[0]?.journal_mode ?? "unknown";

        return {
          name: "journal_mode",
          status: mode === "wal" ? "pass" as const : "fail" as const,
          message: mode === "wal" ? undefined : `Expected WAL, got ${mode}`,
          durationMs,
        } satisfies HealthCheckDetail;
      });

      const check = Effect.fn(function* () {
        const checks = yield* Effect.all(
          [runIntegrityCheck(), runWalCheck()],
          { concurrency: "unbounded" },
        );

        const allPassed = checks.every((c) => c.status === "pass");

        return {
          status: allPassed ? "pass" : "fail",
          checks,
          timestamp: new Date().toISOString(),
        } satisfies HealthCheckResult;
      });

      return { check };
    }),
  );
}
