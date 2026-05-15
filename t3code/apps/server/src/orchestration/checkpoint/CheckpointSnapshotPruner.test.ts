// @effect-diagnostics nodeBuiltinImport:off
import path from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { CheckpointRef, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { CheckpointStoreLive } from "../../checkpointing/Layers/CheckpointStore.ts";
import type { CheckpointStoreError } from "../../checkpointing/Errors.ts";
import { CheckpointStore } from "../../checkpointing/Services/CheckpointStore.ts";
import { checkpointRefForThreadTurn } from "../../checkpointing/Utils.ts";
import { ServerConfig } from "../../config.ts";
import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import type { VcsError } from "@t3tools/contracts";
import * as VcsProcess from "../../vcs/VcsProcess.ts";
import {
  CheckpointSnapshotPruner,
  CheckpointSnapshotPrunerLive,
} from "./CheckpointSnapshotPruner.ts";

const NOW_MS = DateTime.toEpochMillis(DateTime.makeUnsafe("2026-05-15T00:00:00.000Z"));
const OLD_COMPLETED_AT = "2026-05-01T00:00:00.000Z";
const RECENT_COMPLETED_AT = "2026-05-14T00:00:00.000Z";

const ServerConfigLayer = ServerConfig.layerTest(process.cwd(), {
  prefix: "t3-checkpoint-pruner-test-",
});
const CheckpointStoreTestLayer = CheckpointStoreLive.pipe(Layer.provide(VcsDriverRegistry.layer));
const TestLayer = Layer.empty.pipe(
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(CheckpointStoreTestLayer),
  Layer.provideMerge(
    CheckpointSnapshotPrunerLive.pipe(
      Layer.provideMerge(CheckpointStoreTestLayer),
      Layer.provideMerge(SqlitePersistenceMemory),
    ),
  ),
  Layer.provideMerge(VcsProcess.layer),
  Layer.provideMerge(ServerConfigLayer),
  Layer.provideMerge(NodeServices.layer),
);

function makeTmpDir(
  prefix = "checkpoint-pruner-test-",
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Scope.Scope> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    return yield* fileSystem.makeTempDirectoryScoped({ prefix });
  });
}

function writeTextFile(
  filePath: string,
  contents: string,
): Effect.Effect<void, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    yield* fileSystem.writeFileString(filePath, contents);
  });
}

function git(
  cwd: string,
  args: ReadonlyArray<string>,
): Effect.Effect<string, VcsError, VcsProcess.VcsProcess> {
  return Effect.gen(function* () {
    const process = yield* VcsProcess.VcsProcess;
    const result = yield* process.run({
      operation: "CheckpointSnapshotPruner.test.git",
      command: "git",
      cwd,
      args,
      timeoutMs: 10_000,
    });
    return result.stdout.trim();
  });
}

function initRepoWithCommit(
  cwd: string,
): Effect.Effect<
  void,
  VcsError | PlatformError.PlatformError,
  VcsProcess.VcsProcess | FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    yield* git(cwd, ["init"]);
    yield* git(cwd, ["config", "user.email", "test@test.com"]);
    yield* git(cwd, ["config", "user.name", "Test"]);
    yield* writeTextFile(path.join(cwd, "README.md"), "# test\n");
    yield* git(cwd, ["add", "."]);
    yield* git(cwd, ["commit", "-m", "initial commit"]);
  });
}

function seedThread(input: {
  readonly cwd: string;
  readonly threadId: ThreadId;
}): Effect.Effect<void, SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const projectId = `project-${input.threadId}`;
    yield* sql`
      INSERT INTO projection_projects (
        project_id,
        title,
        workspace_root,
        scripts_json,
        created_at,
        updated_at,
        deleted_at,
        default_model_selection_json
      )
      VALUES (
        ${projectId},
        'Checkpoint Pruner Project',
        ${input.cwd},
        '[]',
        ${OLD_COMPLETED_AT},
        ${OLD_COMPLETED_AT},
        NULL,
        NULL
      )
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id,
        project_id,
        title,
        branch,
        worktree_path,
        latest_turn_id,
        created_at,
        updated_at,
        deleted_at,
        archived_at,
        runtime_mode,
        interaction_mode,
        latest_user_message_at,
        pending_approval_count,
        pending_user_input_count,
        has_actionable_proposed_plan,
        model_selection_json
      )
      VALUES (
        ${input.threadId},
        ${projectId},
        'Checkpoint Pruner Thread',
        NULL,
        NULL,
        NULL,
        ${OLD_COMPLETED_AT},
        ${OLD_COMPLETED_AT},
        NULL,
        NULL,
        'full-access',
        'default',
        NULL,
        0,
        0,
        0,
        NULL
      )
    `;
  });
}

function captureProjectionCheckpoint(input: {
  readonly cwd: string;
  readonly threadId: ThreadId;
  readonly turnCount: number;
  readonly completedAt: string;
}): Effect.Effect<
  CheckpointRef,
  CheckpointStoreError | PlatformError.PlatformError | SqlError,
  CheckpointStore | FileSystem.FileSystem | SqlClient.SqlClient
> {
  return Effect.gen(function* () {
    const checkpointStore = yield* CheckpointStore;
    const sql = yield* SqlClient.SqlClient;
    const checkpointRef = checkpointRefForThreadTurn(input.threadId, input.turnCount);

    yield* writeTextFile(path.join(input.cwd, "README.md"), `# test\nturn ${input.turnCount}\n`);
    yield* checkpointStore.captureCheckpoint({
      cwd: input.cwd,
      checkpointRef,
    });
    yield* sql`
      INSERT INTO projection_turns (
        thread_id,
        turn_id,
        pending_message_id,
        source_proposed_plan_thread_id,
        source_proposed_plan_id,
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
        ${input.threadId},
        ${`turn-${input.turnCount}`},
        NULL,
        NULL,
        NULL,
        ${`assistant-${input.turnCount}`},
        'completed',
        ${input.completedAt},
        ${input.completedAt},
        ${input.completedAt},
        ${input.turnCount},
        ${checkpointRef},
        'ready',
        '[{"path":"README.md","kind":"modified","additions":1,"deletions":0}]'
      )
    `;
    yield* sql`
      INSERT INTO checkpoint_diff_blobs (
        thread_id,
        from_turn_count,
        to_turn_count,
        diff,
        created_at
      )
      VALUES (
        ${input.threadId},
        ${Math.max(0, input.turnCount - 1)},
        ${input.turnCount},
        ${`diff-${input.turnCount}`},
        ${input.completedAt}
      )
    `;

    return checkpointRef;
  });
}

function listRemainingCheckpointTurnCounts(
  threadId: ThreadId,
): Effect.Effect<ReadonlyArray<number>, SqlError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const rows = yield* sql<{ readonly checkpointTurnCount: number }>`
      SELECT checkpoint_turn_count AS "checkpointTurnCount"
      FROM projection_turns
      WHERE checkpoint_turn_count IS NOT NULL
        AND thread_id = ${threadId}
      ORDER BY checkpoint_turn_count ASC
    `;
    return rows.map((row) => row.checkpointTurnCount);
  });
}

function checkpointRefExists(cwd: string, checkpointRef: CheckpointRef) {
  return Effect.gen(function* () {
    const checkpointStore = yield* CheckpointStore;
    return yield* checkpointStore.hasCheckpointRef({
      cwd,
      checkpointRef,
    });
  });
}

it.layer(TestLayer)("CheckpointSnapshotPruner", (it) => {
  it.effect("prunes snapshots older than retention while preserving the latest three", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      yield* initRepoWithCommit(cwd);
      const threadId = ThreadId.make("thread-prune-retention");
      yield* seedThread({ cwd, threadId });

      const refs = yield* Effect.forEach([1, 2, 3, 4, 5], (turnCount) =>
        captureProjectionCheckpoint({
          cwd,
          threadId,
          turnCount,
          completedAt: turnCount <= 3 ? OLD_COMPLETED_AT : RECENT_COMPLETED_AT,
        }),
      );
      const [ref1, ref2, ref3, ref4, ref5] = refs as [
        CheckpointRef,
        CheckpointRef,
        CheckpointRef,
        CheckpointRef,
        CheckpointRef,
      ];

      const pruner = yield* CheckpointSnapshotPruner;
      const result = yield* pruner.pruneSnapshots({
        retentionDays: 7,
        nowMs: NOW_MS,
      });

      assert.equal(result.snapshotsDeleted, 2);
      assert.equal(result.bytesFreed > 0, true);
      assert.deepEqual(yield* listRemainingCheckpointTurnCounts(threadId), [3, 4, 5]);
      assert.equal(yield* checkpointRefExists(cwd, ref1), false);
      assert.equal(yield* checkpointRefExists(cwd, ref2), false);
      assert.equal(yield* checkpointRefExists(cwd, ref3), true);
      assert.equal(yield* checkpointRefExists(cwd, ref4), true);
      assert.equal(yield* checkpointRefExists(cwd, ref5), true);
    }),
  );

  it.effect("keeps at least three snapshots per session regardless of age", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      yield* initRepoWithCommit(cwd);
      const threadId = ThreadId.make("thread-prune-minimum");
      yield* seedThread({ cwd, threadId });

      const refs = yield* Effect.forEach([1, 2, 3], (turnCount) =>
        captureProjectionCheckpoint({
          cwd,
          threadId,
          turnCount,
          completedAt: OLD_COMPLETED_AT,
        }),
      );

      const pruner = yield* CheckpointSnapshotPruner;
      const result = yield* pruner.pruneSnapshots({
        retentionDays: 7,
        nowMs: NOW_MS,
      });

      assert.equal(result.snapshotsDeleted, 0);
      assert.deepEqual(yield* listRemainingCheckpointTurnCounts(threadId), [1, 2, 3]);
      for (const ref of refs) {
        assert.equal(yield* checkpointRefExists(cwd, ref), true);
      }
    }),
  );

  it.effect("allows checkpoint capture to proceed while pruning runs", () =>
    Effect.gen(function* () {
      const cwd = yield* makeTmpDir();
      yield* initRepoWithCommit(cwd);
      const threadId = ThreadId.make("thread-prune-concurrent");
      yield* seedThread({ cwd, threadId });
      yield* Effect.forEach([1, 2, 3, 4, 5, 6], (turnCount) =>
        captureProjectionCheckpoint({
          cwd,
          threadId,
          turnCount,
          completedAt: OLD_COMPLETED_AT,
        }),
      );

      const pruner = yield* CheckpointSnapshotPruner;
      const checkpointStore = yield* CheckpointStore;
      const concurrentRef = checkpointRefForThreadTurn(threadId, 99);
      const [result] = yield* Effect.all(
        [
          pruner.pruneSnapshots({ retentionDays: 7, nowMs: NOW_MS }),
          Effect.gen(function* () {
            yield* writeTextFile(path.join(cwd, "README.md"), "# concurrent\n");
            yield* checkpointStore.captureCheckpoint({
              cwd,
              checkpointRef: concurrentRef,
            });
          }),
        ],
        { concurrency: 2 },
      );

      assert.equal(result.snapshotsDeleted, 3);
      assert.deepEqual(yield* listRemainingCheckpointTurnCounts(threadId), [4, 5, 6]);
      assert.equal(yield* checkpointRefExists(cwd, concurrentRef), true);
    }),
  );
});
