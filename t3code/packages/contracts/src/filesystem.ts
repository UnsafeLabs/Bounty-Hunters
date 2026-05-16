import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const FILESYSTEM_PATH_MAX_LENGTH = 512;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
  isDirectory: Schema.Boolean,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export class FilesystemBrowseError extends Schema.TaggedErrorClass<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// -- Move file / directory --

export const FilesystemMoveInput = Schema.Struct({
  sourcePath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  destinationPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
});
export type FilesystemMoveInput = typeof FilesystemMoveInput.Type;

export const FilesystemMoveResult = Schema.Struct({
  success: Schema.Boolean,
});
export type FilesystemMoveResult = typeof FilesystemMoveResult.Type;

export class FilesystemMoveError extends Schema.TaggedErrorClass<FilesystemMoveError>()(
  "FilesystemMoveError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {}

// -- Undo file move --

export class FilesystemUndoError extends Schema.TaggedErrorClass<FilesystemUndoError>()(
  "FilesystemUndoError",
  {
    message: TrimmedNonEmptyString,
  },
) {}

export const FilesystemUndoInput = Schema.Struct({});
export type FilesystemUndoInput = typeof FilesystemUndoInput.Type;

export const FilesystemUndoResult = Schema.Struct({
  success: Schema.Boolean,
  undoneSourcePath: Schema.optional(TrimmedNonEmptyString),
  undoneDestPath: Schema.optional(TrimmedNonEmptyString),
});
export type FilesystemUndoResult = typeof FilesystemUndoResult.Type;
