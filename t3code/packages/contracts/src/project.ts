import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROJECT_SEARCH_ENTRIES_MAX_LIMIT = 200;
const PROJECT_WRITE_FILE_PATH_MAX_LENGTH = 512;

export const ProjectSearchEntriesInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_SEARCH_ENTRIES_MAX_LIMIT)),
});
export type ProjectSearchEntriesInput = typeof ProjectSearchEntriesInput.Type;

const ProjectEntryKind = Schema.Literals(["file", "directory"]);

export const ProjectEntry = Schema.Struct({
  path: TrimmedNonEmptyString,
  kind: ProjectEntryKind,
  parentPath: Schema.optional(TrimmedNonEmptyString),
});
export type ProjectEntry = typeof ProjectEntry.Type;

export const ProjectSearchEntriesResult = Schema.Struct({
  entries: Schema.Array(ProjectEntry),
  truncated: Schema.Boolean,
});
export type ProjectSearchEntriesResult = typeof ProjectSearchEntriesResult.Type;

export class ProjectSearchEntriesError extends Schema.TaggedErrorClass<ProjectSearchEntriesError>()(
  "ProjectSearchEntriesError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

const PROJECT_GLOBAL_SEARCH_MAX_LIMIT = 100;

export const ProjectGlobalSearchInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  query: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  limit: PositiveInt.check(Schema.isLessThanOrEqualTo(PROJECT_GLOBAL_SEARCH_MAX_LIMIT)),
  regex: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  caseSensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});
export type ProjectGlobalSearchInput = typeof ProjectGlobalSearchInput.Type;

export const ProjectGlobalSearchFileMatch = Schema.Struct({
  path: TrimmedNonEmptyString,
  lineNumber: PositiveInt,
  preview: Schema.String.check(Schema.isMaxLength(1_000)),
});
export type ProjectGlobalSearchFileMatch = typeof ProjectGlobalSearchFileMatch.Type;

export const ProjectGlobalSearchGitMatch = Schema.Struct({
  sha: TrimmedNonEmptyString,
  shortSha: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
  author: TrimmedNonEmptyString,
  committedAt: TrimmedNonEmptyString,
});
export type ProjectGlobalSearchGitMatch = typeof ProjectGlobalSearchGitMatch.Type;

export const ProjectGlobalSearchResult = Schema.Struct({
  fileMatches: Schema.Array(ProjectGlobalSearchFileMatch),
  gitMatches: Schema.Array(ProjectGlobalSearchGitMatch),
  filesTruncated: Schema.Boolean,
  gitTruncated: Schema.Boolean,
});
export type ProjectGlobalSearchResult = typeof ProjectGlobalSearchResult.Type;

export class ProjectGlobalSearchError extends Schema.TaggedErrorClass<ProjectGlobalSearchError>()(
  "ProjectGlobalSearchError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export const ProjectWriteFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(PROJECT_WRITE_FILE_PATH_MAX_LENGTH)),
  contents: Schema.String,
});
export type ProjectWriteFileInput = typeof ProjectWriteFileInput.Type;

export const ProjectWriteFileResult = Schema.Struct({
  relativePath: TrimmedNonEmptyString,
});
export type ProjectWriteFileResult = typeof ProjectWriteFileResult.Type;

export class ProjectWriteFileError extends Schema.TaggedErrorClass<ProjectWriteFileError>()(
  "ProjectWriteFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}
