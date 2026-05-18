typescript
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Represents a file change parsed from a unified diff.
 */
export interface DiffFileChange {
  /** Full file path from diff (new path for renames/copies) */
  filePath: string;
  /** Original file path (only for renames/copies, otherwise undefined) */
  originalFilePath?: string;
  /** Category: src, test, config, or other */
  category: 'src' | 'test' | 'config' | 'other';
  /** Changed line ranges (1-indexed, inclusive) */
  lineRanges: Array<{ start: number; end: number }>;
  /** Status: added, deleted, modified, renamed, copied */
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';
  /** Whether the file is binary */
  binary: boolean;
}

// ---------------------------------------------------------------------------
// Constants for regex patterns (pre-compiled for performance)
// ---------------------------------------------------------------------------
const DIFF_GIT_RE = /^diff --git a\/(.+) b\/(.*)$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const COPY_FROM_RE = /^copy from (.+)$/;
const COPY_TO_RE = /^copy to (.+)$/;
const NEW_FILE_MODE_RE = /^new file mode \d+$/;
const DELETED_FILE_MODE_RE = /^deleted file mode \d+$/;
const OLD_MODE_RE = /^old mode \d+$/;
const NEW_MODE_RE = /^new mode \d+$/;
const INDEX_RE = /^index [0-9a-f]+\.\.[0-9a-f]+( \d+)?$/;
const BINARY_DIFF_RE = /^Binary files (.+) and (.+) differ$/;
const MINUS_DEVNULL = /^--- a\/(.*)$/;
const PLUS_DEVNULL = /^\+\+\+ b\/(.*)$/;
const HUNK_HEADER_RE = /^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/;

// ---------------------------------------------------------------------------
// Structured logger (can be replaced with winston/pino in production)
// ---------------------------------------------------------------------------
const logger = {
  debug: (msg: string, ...args: unknown[]) =>
    console.debug(`[DEBUG] ${msg}`, ...args),
  info: (msg: string, ...args: unknown[]) =>
    console.info(`[INFO] ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    console.warn(`[WARN] ${msg}`, ...args),
  error: (msg: string, ...args: unknown[]) =>
    console.error(`[ERROR] ${msg}`, ...args),
};

// ---------------------------------------------------------------------------
// Custom error classes for specific failure modes
// ---------------------------------------------------------------------------
class EmptyDiffError extends Error {
  constructor() {
    super('Diff string is empty or contains only whitespace');
    this.name = 'EmptyDiffError';
  }
}

class InvalidDiffError extends Error {
  constructor(reason: string) {
    super(`Invalid diff: ${reason}`);
    this.name = 'InvalidDiffError';
  }
}

class DiffParsingError extends Error {
  constructor(reason: string) {
    super(`Diff parsing error: ${reason}`);
    this.name = 'DiffParsingError';
  }
}

// ---------------------------------------------------------------------------
// Line generator – avoids allocating an array of all lines at once
// ---------------------------------------------------------------------------
/**
 * Generator that yields each line from a string, stripping line endings
 * (handles \n, \r\n, \r).
 *
 * @param text - Input string
 * @returns Generator yielding individual lines
 */
function* lineGenerator(text: string): Generator<string> {
  let start = 0;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (char === '\n') {
      yield text.slice(start, i);
      start = i + 1;
      i = start;
    } else if (char === '\r') {
      const next = text[i + 1];
      if (next === '\n') {
        yield text.slice(start, i);
        start = i + 2;
        i = start;
      } else {
        // bare \r
        yield text.slice(start, i);
        start = i + 1;
        i = start;
      }
    } else {
      i++;
    }
  }

  // Last line without trailing newline
  if (start < text.length) {
    yield text.slice(start);
  }
}

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Classify a file path into one of four categories.
 *
 * @param filePath - Normalized file path (forward slashes)
 * @returns The determined category
 */
function classifyFile(filePath: string): DiffFileChange['category'] {
  const normalized = filePath.replace(/\\/g, '/');

  // Source files (excluding test directories/files)
  if (
    normalized.startsWith('src/') &&
    !normalized.includes('__tests__') &&
    !normalized.includes('test/') &&
    !normalized.includes('spec/')
  ) {
    return 'src';
  }

  // Test files
  if (
    normalized.includes('test/') ||
    normalized.includes('__tests__/') ||
    normalized.includes('spec/') ||
    /\.(spec|test)\.[jt]sx?$/.test(normalized)
  ) {
    return 'test';
  }

  // Configuration files
  if (
    /\.(json|ya?ml|env)$/.test(normalized) ||
    /\.config\.(ts|js)$/.test(normalized) ||
    normalized.startsWith('config/') ||
    normalized.includes('/config/') ||
    normalized.includes('/.github/') ||
    normalized === 'tsconfig.json' ||
    normalized === 'package.json' ||
    normalized.startsWith('.eslintrc') ||
    normalized.startsWith('.prettierrc')
  ) {
    return 'config';
  }

  return 'other';
}

/**
 * Build a DiffFileChange object from accumulated state.
 */
function buildChange(
  file: string,
  originalFile: string | undefined,
  status: DiffFileChange['status'],
  binary: boolean,
  lineRanges: Array<{ start: number; end: number }>,
): DiffFileChange {
  const category = classifyFile(file);
  const change: DiffFileChange = {
    filePath: file,
    category,
    lineRanges,
    status,
    binary,
  };
  if (originalFile !== undefined) {
    change.originalFilePath = originalFile;
  }
  logger.info(
    `Parsed change: ${file} (status=${status}, category=${category}, binary=${binary}, lines=${lineRanges.length})`,
  );
  return change;
}

/**
 * Merge a new line number into the ranges array, combining adjacent ranges.
 *
 * @param ranges - Current list of ranges (modified in place)
 * @param lineNum - New line number to add (1‑based)
 */
function mergeLineRange(
  ranges: Array<{ start: number; end: number }>,
  lineNum: number,
): void {
  if (ranges.length === 0) {
    ranges.push({ start: lineNum, end: lineNum });
    return;
  }
  const last = ranges[ranges.length - 1];
  if (last.end + 1 === lineNum) {
    last.end = lineNum;
  } else {
    ranges.push({ start: lineNum, end: lineNum });
  }
}

/**
 * Parse a hunk header and extract line numbers and optional counts.
 *
 * Hunk header format: @@ -oldStart[,oldCount] +newStart[,newCount] @@
 * If count is missing, it defaults to 1.
 *
 * @param header - The raw hunk header line
 * @returns Parsed hunk info or null if header is malformed
 */
function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} | null {
  const match = header.match(HUNK_HEADER_RE);
  if (!match) return null;

  const oldStart = parseInt(match[1], 10);
  const oldCount = match[2] ? parseInt(match[2], 10) : 1;
  const newStart = parseInt(match[3], 10);
  const newCount = match[4] ? parseInt(match[4], 10) : 1;

  // Validate that line numbers are positive (0 is allowed for new/deleted files)
  if (oldStart < 0 || newStart < 0) return null;

  // When oldStart is 0 (new file), context count must be 0.
  // When newStart is 0 (deleted file), context count must be 0.
  // This is handled naturally; we only check to avoid negative counts.
  if (oldCount < 1 && oldStart > 0) return null;
  if (newCount < 1 && newStart > 0) return null;

  return { oldStart, oldCount, newStart, newCount };
}

/**
 * Validate that the number of lines observed in a hunk matches the expected
 * counts from the header. Logs a warning if mismatched.
 *
 * @param headerInfo - Parsed hunk header
 * @param contextLines - Number of context lines seen
 * @param addedLines - Number of added lines (starting with '+')
 * @param deletedLines - Number of deleted lines (starting with '-')
 */
function validateHunkCounts(
  headerInfo: { oldCount: number; newCount: number },
  contextLines: number,
  addedLines: number,
  deletedLines: number,
): void {
  const expectedOldTotal = headerInfo.oldCount;
  const actualOldTotal = contextLines + deletedLines;
  const expectedNewTotal = headerInfo.newCount;
  const actualNewTotal = contextLines + addedLines;

  if (expectedOldTotal !== actualOldTotal) {
    logger.warn(
      `Hunk line count mismatch: expected ${expectedOldTotal} old lines, got ${actualOldTotal}. ` +
      `(context=${contextLines}, deleted=${deletedLines})`,
    );
  }
  if (expectedNewTotal !== actualNewTotal) {
    logger.warn(
      `Hunk line count mismatch: expected ${expectedNewTotal} new lines, got ${actualNewTotal}. ` +
      `(context=${contextLines}, added=${addedLines})`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main parsing function
// ---------------------------------------------------------------------------

/**
 * Parses a unified diff string and extracts structured file changes.
 *
 * Implements a finite state machine that processes lines from a generator
 * (memory‑efficient for large diffs). It tracks:
 * - Current file path (from `diff --git` or `---/+++` headers)
 * - File status (added, deleted, modified, renamed, copied)
 * - Binary flag
 * - Line ranges of added lines within each hunk
 *
 * The parser handles renaming, copying, new files, deletions, and binary diffs.
 * All added lines are accumulated into contiguous ranges.
 *
 * @param diff - The raw unified diff text (UTF-8 encoded)
 * @returns Array of DiffFileChange objects, one per file affected
 * @throws {EmptyDiffError} If diff string is empty/whitespace only
 * @throws {InvalidDiffError} If the diff structure is fundamentally broken
 */
export function parseUnifiedDiff(diff: string): DiffFileChange[] {
  if (!diff || typeof diff !== 'string') {
    const error = new InvalidDiffError('Input must be a non‑empty string');
    logger.error(error.message);
    throw error;
  }
  if (diff.trim().length === 0) {
    const error = new EmptyDiffError();
    logger.error(error.message);
    throw error;
  }

  const changes: DiffFileChange[] = [];

  // State variables for the current file being processed
  let currentFile: string | null = null;
  let originalFile: string | undefined = undefined;
  let currentStatus: DiffFileChange['status'] = 'modified';
  let currentBinary = false;
  let currentRanges: Array<{ start: number; end: number }> = [];
  let inHunk = false;

  // Hunk‑level tracking
  let newFileStartLine = 0; // starting line (1‑based) for the new file in current hunk
  let addedLinesCount = 0;  // added lines encountered so far in current hunk
  let hunkContextLines = 0; // context lines seen in current hunk
  let hunkDeletedLines = 0; // deleted lines seen in current hunk
  let pendingHeaderInfo: { newStart: number; newCount: number; oldCount: number } | null = null;

  /**
   * Finalize the current file change and push it to the result array.
   */
  function finalizeFileChange(): void {
    if (currentFile !== null) {
      changes.push(
        buildChange(currentFile, originalFile, currentStatus, currentBinary, currentRanges),
      );
    }
    // Reset state for next file
    currentFile = null;
    originalFile = undefined;
    currentStatus = 'modified';
    currentBinary = false;
    currentRanges = [];
    inHunk = false;
    newFileStartLine = 0;
    addedLinesCount = 0;
    hunkContextLines = 0;
    hunkDeletedLines = 0;
    pendingHeaderInfo = null;
  }

  /**
   * Process the end of a hunk (either because a new hunk header appears or the
   * file ends). Validates line counts if header info was stored.
   */
  function finalizeHunk(): void {
    if (pendingHeaderInfo !== null) {
      validateHunkCounts(
        { oldCount: pendingHeaderInfo.oldCount, newCount: pendingHeaderInfo.newCount },
        hunkContextLines,
        addedLinesCount,
        hunkDeletedLines,
      );
    }
    pendingHeaderInfo = null;
    hunkContextLines = 0;
    hunkDeletedLines = 0;
    addedLinesCount = 0;
    inHunk = false;
  }

  // Use generator to avoid loading the entire diff into memory as an array
  const lines = lineGenerator(diff);

  for (const line of lines) {
    // -----------------------------------------------------------------------
    // 1. Detect start of a new file (diff --git header)
    // -----------------------------------------------------------------------
    const diffGitMatch = line.match(DIFF_GIT_RE);
    if (diffGitMatch) {
      finalizeFileChange();
      currentFile = diffGitMatch[2]; // new file path (b/...)
      continue;
    }

    // -----------------------------------------------------------------------
    // 2. Rename / copy headers
    // -----------------------------------------------------------------------
    const renameFromMatch = line.match(RENAME_FROM_RE);
    if (renameFromMatch) {
      if (originalFile && originalFile !== renameFromMatch[1]) {
        logger.warn(`Duplicate rename from: ${renameFromMatch[1]}, ignoring`);
      }
      originalFile = renameFromMatch[1];
      currentStatus = 'renamed';
      continue;
    }

    const renameToMatch = line.match(RENAME_TO_RE);
    if (renameToMatch) {
      if (!currentFile) {
        currentFile = renameToMatch[1];
      } else if (currentFile !== renameToMatch[1]) {
        logger.warn(`Rename to path mismatch: ${renameToMatch[1]} vs ${currentFile}`);
      }
      if (currentStatus !== 'renamed') currentStatus = 'renamed';
      continue;
    }

    const copyFromMatch = line.match(COPY_FROM_RE);
    if (copyFromMatch) {
      originalFile = copyFromMatch[1];
      currentStatus = 'copied';
      continue;
    }

    const copyToMatch = line.match(COPY_TO_RE);
    if (copyToMatch) {
      if (!currentFile) {
        currentFile = copyToMatch[1];
      }
      if (currentStatus !== 'copied') currentStatus = 'copied';
      continue;
    }

    // -----------------------------------------------------------------------
    // 3. Mode changes and index lines – informational, no state change
    // -----------------------------------------------------------------------
    if (NEW_FILE_MODE_RE.test(line)) {
      currentStatus = 'added';
      continue;
    }
    if (DELETED_FILE_MODE_RE.test(line)) {
      currentStatus = 'deleted';
      continue;
    }
    if (OLD_MODE_RE.test(line) || NEW_MODE_RE.test(line) || INDEX_RE.test(line)) {
      continue;
    }

    // -----------------------------------------------------------------------
    // 4. Binary diff
    // -----------------------------------------------------------------------
    if (BINARY_DIFF_RE.test(line)) {
      currentBinary = true;
      continue;
    }

    // -----------------------------------------------------------------------
    // 5. --- / +++ headers – used to determine file paths if missing in diff --git
    // -----------------------------------------------------------------------
    const minusMatch = line.match(MINUS_DEVNULL);
    if (minusMatch) {
      // Typically "--- a/file" – we may use it to set originalFile if not set
      if (!originalFile && minusMatch[1] !== '/dev/null') {
        originalFile = minusMatch[1];
      }
      continue;
    }

    const plusMatch = line.match(PLUS_DEVNULL);
    if (plusMatch) {
      if (!currentFile && plusMatch[1] !== '/dev/null') {
        currentFile = plusMatch[1];
      }
      continue;
    }

    // -----------------------------------------------------------------------
    // 6. Hunk headers
    // -----------------------------------------------------------------------
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      // Finalize previous hunk if we were in one
      finalizeHunk();

      const headerInfo = parseHunkHeader(line);
      if (headerInfo === null) {
        throw new InvalidDiffError(`Malformed hunk header: ${line.slice(0, 50)}`);
      }

      newFileStartLine = headerInfo.newStart;
      // When newStart is 0 (deleted file), there are no added lines, so we set
      // newFileStartLine to 0 and added lines will not occur. This is intentional.
      // For zero context lines (e.g., @@ -0,0 +1,3 @@), newStart = 1, works.
      inHunk = true;
      addedLinesCount = 0;
      hunkContextLines = 0;
      hunkDeletedLines = 0;
      pendingHeaderInfo = {
        newStart: headerInfo.newStart,
        newCount: headerInfo.newCount,
        oldCount: headerInfo.oldCount,
      };
      continue;
    }

    // -----------------------------------------------------------------------
    // 7. Content lines (inside a hunk)
    // -----------------------------------------------------------------------
    if (!inHunk && currentFile !== null) {
      // If we are not in a hunk but have a file, this might be trailing diff
      // headers or comments; ignore or warn.
      logger.debug(`Unexpected line outside hunk: ${line.slice(0, 80)}`);
      continue;
    }

    if (inHunk) {
      if (line.startsWith(' ')) {
        // Context line
        hunkContextLines++;
        addedLinesCount++;
        hunkDeletedLines++;
      } else if (line.startsWith('+')) {
        // Added line
        addedLinesCount++;
        const absoluteLineNumber = newFileStartLine + addedLinesCount;
        // For added lines, the line number in the new file is:
        //   newFileStartLine + number of added lines so far (including this one)
        mergeLineRange(currentRanges, absoluteLineNumber);
      } else if (line.startsWith('-')) {
        // Deleted line – not added, but affects context count
        hunkDeletedLines++;
        // Deletions are not recorded as line ranges (only added lines matter)
        // However, we still need to account for them in the old file line count.
      } else if (line.startsWith('\\')) {
        // Line without newline at end of file – ignore, still part of hunk
        continue;
      } else {
        // Unknown line type – could be noise; warn and skip
        logger.warn(`Unknown content line in hunk: ${line.slice(0, 80)}`);
        continue;
      }
    }
  }

  // Finalize the last hunk and file
  finalizeHunk();
  finalizeFileChange();

  if (changes.length === 0) {
    logger.warn('No file changes parsed from diff. The diff may be empty or malformed.');
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Utility function to read a diff file from disk (for convenience)
// ---------------------------------------------------------------------------

/**
 * Reads a unified diff from a file and parses it.
 *
 * @param filePath - Path to the diff file
 * @returns Parsed file changes
 * @throws {EmptyDiffError} If file does not exist or is empty
 * @throws {InvalidDiffError} If file content is not a valid diff
 */
export function parseDiffFile(filePath: string): DiffFileChange[] {
  if (!existsSync(filePath)) {
    throw new EmptyDiffError(`File not found: ${filePath}`);
  }
  const content = readFileSync(filePath, 'utf-8');
  return parseUnifiedDiff(content);
}