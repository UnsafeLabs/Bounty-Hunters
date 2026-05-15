import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("031_AuthSessionLastActiveAt", (it) => {
  it.effect("adds and backfills last_active_at for existing auth sessions", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 30 });
      yield* sql`
        INSERT INTO auth_sessions (
          session_id,
          subject,
          role,
          method,
          issued_at,
          expires_at,
          last_connected_at,
          revoked_at
        )
        VALUES (
          'session-1',
          'owner',
          'owner',
          'browser-session-cookie',
          '2026-05-15T00:00:00.000Z',
          '2026-06-15T00:00:00.000Z',
          '2026-05-15T00:10:00.000Z',
          NULL
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 31 });

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(auth_sessions)
      `;
      assert.ok(columns.some((column) => column.name === "last_active_at"));

      const rows = yield* sql<{ readonly lastActiveAt: string }>`
        SELECT last_active_at AS "lastActiveAt"
        FROM auth_sessions
        WHERE session_id = 'session-1'
      `;
      assert.equal(rows[0]?.lastActiveAt, "2026-05-15T00:10:00.000Z");
    }),
  );
});
