/**
 * WorkspaceEntries - Effect service contract for cached workspace entry search.
 *
 * Owns indexed workspace entry search plus cache invalidation for workspace
 * file operations.
 */

import type {
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
} from "@t3tools/contracts";
import type {
  FilesystemBrowseInput,
  FilesystemBrowseResult,
  FilesystemMoveInput,
  FilesystemMoveResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "@t3tools/contracts/baseSchemas";

export class WorkspaceEntriesError extends Schema.TaggedErrorClass<WorkspaceEntriesError>()(
  "WorkspaceEntriesError",
  {
    message: TrimmedNonEmptyString,
    detail: Schema.optional(TrimmedNonEmptyString),
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class WorkspaceEntriesBrowseError extends Schema.TaggedErrorClass<WorkspaceEntriesBrowseError>()(
  "WorkspaceEntriesBrowseError",
  {
    message: TrimmedNonEmptyString,
    cwd: TrimmedNonEmptyString,
    partialPath: TrimmedNonEmptyString,
    operation: TrimmedNonEmptyString,
    detail: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export class WorkspaceEntriesMoveError extends Schema.TaggedErrorClass<WorkspaceEntriesMoveError>()(
  "WorkspaceEntriesMoveError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface WorkspaceEntriesShape {
  /**
   * Browse matching directories for the provided partial path.
   */
  readonly browse: (
    input: FilesystemBrowseInput,
  ) => Effect.Effect<FilesystemBrowseResult, WorkspaceEntriesBrowseError>;

  /**
   * Search indexed workspace entries for files and directories matching the
   * provided query.
   */
  readonly search: (
    input: ProjectSearchEntriesInput,
  ) => Effect.Effect<ProjectSearchEntriesResult, WorkspaceEntriesError>;

  /**
   * Drop any cached workspace entries for the given workspace root.
   */
  readonly invalidate: (cwd: string) => Effect.Effect<void>;

  /**
   * Move a file or directory within the workspace using git mv (tracked) or
   * fs rename (untracked).
   */
  readonly move: (
    input: FilesystemMoveInput,
  ) => Effect.Effect<FilesystemMoveResult, WorkspaceEntriesMoveError>;
}

/**
 * WorkspaceEntries - Service tag for cached workspace entry search.
 */
export class WorkspaceEntries extends Context.Service<WorkspaceEntries, WorkspaceEntriesShape>()(
  "WorkspaceEntries",
) {}
