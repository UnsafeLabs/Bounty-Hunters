import { OrchestrationCheckpointFile } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteByThreadIdInput,
  GetByThreadAndTurnCountInput,
  ListByThreadIdInput,
  ProjectionCheckpoint,
  ProjectionCheckpointRepository,
  PruneSnapshotsInput,
  PruneSnapshotsResult,
  type ProjectionCheckpointRepositoryShape,
} from "../Services/ProjectionCheckpoints.ts";

const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionCheckpointRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const clearCheckpointConflict = SqlSchema.void({
    Request: GetByThreadAndTurnCountInput,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  });

  const upsertProjectionCheckpointRow = SqlSchema.void({
    Request: ProjectionCheckpointDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          NULL,
          ${row.assistantMessageId},
          ${row.status === "error" ? "error" : "completed"},
          ${row.completedAt},
          ${row.completedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.status},
          ${row.files}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `,
  });

  const listProjectionCheckpointRows = SqlSchema.findAll({
    Request: ListByThreadIdInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getProjectionCheckpointRow = SqlSchema.findOneOption({
    Request: GetByThreadAndTurnCountInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  });

  const deleteProjectionCheckpointRows = SqlSchema.void({
    Request: DeleteByThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
      `,
  });

  const collectPrunableCheckpointStats = SqlSchema.findOne({
    Request: PruneSnapshotsInput,
    Result: PruneSnapshotsResult,
    execute: ({ olderThan, keepPerThread }: Schema.Schema.Type<typeof PruneSnapshotsInput>) =>
      sql`
        WITH ranked_checkpoints AS (
          SELECT
            row_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY completed_at DESC, checkpoint_turn_count DESC
            ) AS checkpoint_rank
          FROM projection_turns
          WHERE checkpoint_turn_count IS NOT NULL
        ),
        prunable AS (
          SELECT projection_turns.*
          FROM projection_turns
          INNER JOIN ranked_checkpoints
            ON ranked_checkpoints.row_id = projection_turns.row_id
          WHERE projection_turns.completed_at < ${olderThan}
            AND ranked_checkpoints.checkpoint_rank > ${keepPerThread}
        )
        SELECT
          COUNT(*) AS "snapshotsDeleted",
          COALESCE(SUM(
            LENGTH(COALESCE(checkpoint_ref, '')) +
            LENGTH(COALESCE(checkpoint_status, '')) +
            LENGTH(COALESCE(checkpoint_files_json, ''))
          ), 0) AS "bytesFreed"
        FROM prunable
      `,
  });

  const pruneProjectionCheckpointRows = SqlSchema.void({
    Request: PruneSnapshotsInput,
    execute: ({ olderThan, keepPerThread }: Schema.Schema.Type<typeof PruneSnapshotsInput>) =>
      sql`
        WITH ranked_checkpoints AS (
          SELECT
            row_id,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY completed_at DESC, checkpoint_turn_count DESC
            ) AS checkpoint_rank
          FROM projection_turns
          WHERE checkpoint_turn_count IS NOT NULL
        )
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE row_id IN (
          SELECT projection_turns.row_id
          FROM projection_turns
          INNER JOIN ranked_checkpoints
            ON ranked_checkpoints.row_id = projection_turns.row_id
          WHERE projection_turns.completed_at < ${olderThan}
            AND ranked_checkpoints.checkpoint_rank > ${keepPerThread}
        )
      `,
  });

  const compactCheckpointDatabase = SqlSchema.void({
    Request: Schema.Void,
    execute: () => sql`VACUUM`,
  });

  const upsertCheckpointRow = (row: Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>) =>
    sql.withTransaction(
      clearCheckpointConflict({
        threadId: row.threadId,
        checkpointTurnCount: row.checkpointTurnCount,
      }).pipe(Effect.flatMap(() => upsertProjectionCheckpointRow(row))),
    );

  const upsert: ProjectionCheckpointRepositoryShape["upsert"] = (row) =>
    upsertCheckpointRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.upsert:query",
          "ProjectionCheckpointRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ProjectionCheckpointRepositoryShape["listByThreadId"] = (input) =>
    listProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.listByThreadId:query",
          "ProjectionCheckpointRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionCheckpoint>>),
    );

  const getByThreadAndTurnCount: ProjectionCheckpointRepositoryShape["getByThreadAndTurnCount"] = (
    input,
  ) =>
    getProjectionCheckpointRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.getByThreadAndTurnCount:query",
          "ProjectionCheckpointRepository.getByThreadAndTurnCount:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionCheckpoint>)),
        }),
      ),
    );

  const deleteByThreadId: ProjectionCheckpointRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionCheckpointRepository.deleteByThreadId:query"),
      ),
    );

  const pruneSnapshots: ProjectionCheckpointRepositoryShape["pruneSnapshots"] = (input) =>
    sql.withTransaction(
      collectPrunableCheckpointStats(input).pipe(
        Effect.flatMap((stats) =>
          pruneProjectionCheckpointRows(input).pipe(Effect.as(stats)),
        ),
      ),
    ).pipe(
      Effect.tap((stats) =>
        stats.snapshotsDeleted > 0 ? compactCheckpointDatabase() : Effect.void,
      ),
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.pruneSnapshots:query",
          "ProjectionCheckpointRepository.pruneSnapshots:decodeResult",
        ),
      ),
    );

  return {
    upsert,
    listByThreadId,
    getByThreadAndTurnCount,
    deleteByThreadId,
    pruneSnapshots,
  } satisfies ProjectionCheckpointRepositoryShape;
});

export const ProjectionCheckpointRepositoryLive = Layer.effect(
  ProjectionCheckpointRepository,
  makeProjectionCheckpointRepository,
);
