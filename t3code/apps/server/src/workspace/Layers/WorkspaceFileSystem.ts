import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import {
  WorkspaceFileSystem,
  WorkspaceFileSystemError,
  type WorkspaceFileSystemShape,
} from "../Services/WorkspaceFileSystem.ts";
import { WorkspaceEntries } from "../Services/WorkspaceEntries.ts";
import { WorkspacePaths } from "../Services/WorkspacePaths.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";

export const makeWorkspaceFileSystem = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const workspacePaths = yield* WorkspacePaths;
  const workspaceEntries = yield* WorkspaceEntries;
  const gitVcsDriver = yield* GitVcsDriver;

  const writeFile: WorkspaceFileSystemShape["writeFile"] = Effect.fn(
    "WorkspaceFileSystem.writeFile",
  )(function* (input) {
    const target = yield* workspacePaths.resolveRelativePathWithinRoot({
      workspaceRoot: input.cwd,
      relativePath: input.relativePath,
    });

    yield* fileSystem.makeDirectory(path.dirname(target.absolutePath), { recursive: true }).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.makeDirectory",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* fileSystem.writeFileString(target.absolutePath, input.contents).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceFileSystemError({
            cwd: input.cwd,
            relativePath: input.relativePath,
            operation: "workspaceFileSystem.writeFile",
            detail: cause.message,
            cause,
          }),
      ),
    );
    yield* workspaceEntries.invalidate(input.cwd);
    return { relativePath: target.relativePath };
  });

  const moveFile: WorkspaceFileSystemShape["moveFile"] = Effect.fn(
    "WorkspaceFileSystem.moveFile",
  )(function* (input) {
    const movedPaths: Array<{ sourceRelativePath: string; destinationRelativePath: string }> = [];

    for (const sourceRelativePath of input.sourceRelativePaths) {
      const sourceTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: sourceRelativePath,
      });

      const filename = path.basename(sourceTarget.relativePath);
      const destinationRelativePath = input.destinationDirectoryRelativePath
        ? path.join(input.destinationDirectoryRelativePath, filename)
        : filename;

      const destinationTarget = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: destinationRelativePath,
      });

      if (sourceTarget.relativePath === destinationTarget.relativePath) {
        continue;
      }

      const sourceParent = path.dirname(sourceTarget.relativePath);
      const destParent = input.destinationDirectoryRelativePath;
      const normSourceParent = path.normalize(sourceParent).replace(/^\.?\/?|^\/||\/?$/, "");
      const normDestParent = path.normalize(destParent).replace(/^\.?\/?|^\/||\/?$/, "");
      if (normSourceParent === normDestParent) {
        continue;
      }

      yield* fileSystem.makeDirectory(path.dirname(destinationTarget.absolutePath), { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemError({
              cwd: input.cwd,
              relativePath: destinationRelativePath,
              operation: "workspaceFileSystem.moveFile.makeDirectory",
              detail: cause.message,
              cause,
            }),
        ),
      );

      const checkTracked = yield* gitVcsDriver.execute({
        operation: "WorkspaceFileSystem.moveFile.checkTracked",
        cwd: input.cwd,
        args: ["ls-files", "--error-unmatch", sourceTarget.relativePath],
        allowNonZeroExit: true,
      });

      const isTracked = checkTracked.exitCode === 0;

      if (isTracked) {
        yield* gitVcsDriver.execute({
          operation: "WorkspaceFileSystem.moveFile.gitMv",
          cwd: input.cwd,
          args: ["mv", sourceTarget.relativePath, destinationTarget.relativePath],
        }).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: sourceTarget.relativePath,
                operation: "WorkspaceFileSystem.moveFile.gitMv",
                detail: cause.message,
                cause,
              }),
          ),
        );
      } else {
        yield* fileSystem.rename(sourceTarget.absolutePath, destinationTarget.absolutePath).pipe(
          Effect.mapError(
            (cause) =>
              new WorkspaceFileSystemError({
                cwd: input.cwd,
                relativePath: sourceTarget.relativePath,
                operation: "workspaceFileSystem.moveFile.rename",
                detail: cause.message,
                cause,
              }),
          ),
        );
      }

      movedPaths.push({
        sourceRelativePath: sourceTarget.relativePath,
        destinationRelativePath: destinationTarget.relativePath,
      });
    }

    yield* workspaceEntries.invalidate(input.cwd);
    return { movedPaths };
  });

  return { writeFile, moveFile } satisfies WorkspaceFileSystemShape;
});

export const WorkspaceFileSystemLive = Layer.effect(WorkspaceFileSystem, makeWorkspaceFileSystem);
