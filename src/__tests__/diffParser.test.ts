typescript
import { parseDiff, DiffResult, Hunk, LineChange } from '../diffParser';
import logger from '../utils/logger';

// Mock logger to avoid side effects and allow assertion on usage
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

/**
 * Unit tests for the diff parser module.
 * Uses Jest framework with TypeScript types.
 * All tests are isolated and validate parsing logic comprehensively.
 */
describe('parseDiff', () => {
  beforeAll(() => {
    // Setup mocks if needed
  });

  afterAll(() => {
    // Clean up mocks
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    logger.info('Starting individual test');
  });

  afterEach(() => {
    logger.info('Completed individual test');
  });

  /**
   * Parses a valid unified diff with a single file modification.
   * Verifies file path, hunks, line counts, and line content.
   */
  it('should parse a simple unified diff with one file', () => {
    const input = `diff --git a/src/foo.ts b/src/foo.ts
index abc123..def456 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,7 @@
 line1
-line2
+line2 modified
 line3
+new line
 line4
 line5`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('src/foo.ts');
    expect(result[0].hunks).toHaveLength(1);
    const hunk: Hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldLines).toBe(5);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newLines).toBe(7);
    expect(hunk.lines).toHaveLength(7);

    // Verify line content and types
    const deletions = hunk.lines.filter((l: LineChange) => l.type === 'delete');
    const additions = hunk.lines.filter((l: LineChange) => l.type === 'add');
    const contexts = hunk.lines.filter((l: LineChange) => l.type === 'context');
    expect(deletions).toHaveLength(1);
    expect(additions).toHaveLength(2);
    expect(contexts).toHaveLength(4);

    // Verify specific line content
    expect(hunk.lines[0].content).toBe('line1');
    expect(hunk.lines[0].type).toBe('context');
    expect(hunk.lines[1].content).toBe('line2');
    expect(hunk.lines[1].type).toBe('delete');
    expect(hunk.lines[2].content).toBe('line2 modified');
    expect(hunk.lines[2].type).toBe('add');
  });

  /**
   * Parses a diff containing multiple files and validates separation.
   */
  it('should parse a diff with multiple files', () => {
    const input = `diff --git a/file1.ts b/file1.ts
index 111..222 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,1 +1,2 @@
 a
+b
diff --git a/file2.ts b/file2.ts
index 333..444 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,1 +1,1 @@
-c
+d`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(2);
    expect(result[0].filePath).toBe('file1.ts');
    expect(result[1].filePath).toBe('file2.ts');
    expect(result[0].hunks).toHaveLength(1);
    expect(result[1].hunks).toHaveLength(1);
  });

  /**
   * Returns empty array for empty diff string.
   */
  it('should return an empty array for an empty diff string', () => {
    const result: DiffResult[] = parseDiff('');
    expect(result).toEqual([]);
  });

  /**
   * Returns empty array for whitespace-only diff strings.
   */
  it('should return an empty array for whitespace-only diff', () => {
    const result: DiffResult[] = parseDiff('   \n\n  ');
    expect(result).toEqual([]);
  });

  /**
   * Throws an error for null or undefined input to maintain type safety.
   */
  it('should throw an error for null input', () => {
    expect(() => parseDiff(null as unknown as string)).toThrow('Invalid diff input: expected a string');
  });

  it('should throw an error for undefined input', () => {
    expect(() => parseDiff(undefined as unknown as string)).toThrow('Invalid diff input: expected a string');
  });

  /**
   * Correctly identifies binary files and sets binary flag.
   */
  it('should parse a diff indicating a binary file', () => {
    const input = `diff --git a/image.png b/image.png
index 0000000..1234567 100644
Binary files /dev/null and b/image.png differ`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('image.png');
    expect(result[0].binary).toBe(true);
    expect(result[0].hunks).toHaveLength(0);
  });

  /**
   * Handles new file creation diffs with no previous content.
   */
  it('should parse a new file diff', () => {
    const input = `diff --git a/newfile.ts b/newfile.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/newfile.ts
@@ -0,0 +1,3 @@
+first
+second
+third`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('newfile.ts');
    expect(result[0].newFile).toBe(true);
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].lines).toHaveLength(3);
    // Verify all lines are additions
    result[0].hunks[0].lines.forEach((line: LineChange) => {
      expect(line.type).toBe('add');
    });
  });

  /**
   * Handles file deletion diffs (all lines removed).
   */
  it('should parse a file deletion diff', () => {
    const input = `diff --git a/obsolete.ts b/obsolete.ts
deleted file mode 100644
index abc1234..0000000
--- a/obsolete.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-line1
-line2`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('obsolete.ts');
    expect(result[0].deletedFile).toBe(true);
    expect(result[0].hunks).toHaveLength(1);
    expect(result[0].hunks[0].lines).toHaveLength(2);
    result[0].hunks[0].lines.forEach((line: LineChange) => {
      expect(line.type).toBe('delete');
    });
  });

  /**
   * Throws error for completely malformed input without any diff structure.
   */
  it('should throw an error for a malformed diff', () => {
    const input = 'this is not a valid diff';
    expect(() => parseDiff(input)).toThrow('Invalid diff format');
  });

  /**
   * Throws error when hunks appear without a preceding header.
   */
  it('should throw an error for diff with hunks but no header', () => {
    const input = `@@ -1,3 +1,4 @@
 a
-b
+c
 d`;
    expect(() => parseDiff(input)).toThrow('Invalid diff format');
  });

  /**
   * Parses multiple hunks in a single file.
   */
  it('should parse multiple hunks in one file', () => {
    const input = `diff --git a/multi.ts b/multi.ts
index 555..666 100644
--- a/multi.ts
+++ b/multi.ts
@@ -1,5 +1,5 @@
 unchanged
-removed
+added
 unchanged
@@ -10,3 +10,4 @@
 context
+newline
 context`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].hunks).toHaveLength(2);

    // Verify first hunk old/new lines
    expect(result[0].hunks[0].oldStart).toBe(1);
    expect(result[0].hunks[0].newStart).toBe(1);
    // Second hunk
    expect(result[0].hunks[1].oldStart).toBe(10);
    expect(result[0].hunks[1].newStart).toBe(10);
  });

  /**
   * Correctly parses rename-only diffs.
   */
  it('should handle rename-only diffs', () => {
    const input = `diff --git a/old.ts b/new.ts
similarity index 100%
rename from old.ts
rename to new.ts`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('new.ts');
    expect(result[0].renamedFrom).toBe('old.ts');
    expect(result[0].hunks).toHaveLength(0);
  });

  /**
   * Correctly parses copy diffs.
   */
  it('should handle copy diffs', () => {
    const input = `diff --git a/source.ts b/copy.ts
similarity index 100%
copy from source.ts
copy to copy.ts`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('copy.ts');
    expect(result[0].copiedFrom).toBe('source.ts');
    expect(result[0].hunks).toHaveLength(0);
  });

  /**
   * Handles mode change diffs without content changes.
   */
  it('should handle mode change diffs', () => {
    const input = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('script.sh');
    expect(result[0].oldMode).toBe('100644');
    expect(result[0].newMode).toBe('100755');
    expect(result[0].hunks).toHaveLength(0);
  });

  /**
   * Ignores leading/trailing non-diff lines (noise).
   */
  it('should ignore leading/trailing non-diff lines', () => {
    const input = `Some log line
diff --git a/file.ts b/file.ts
index 777..888 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 a
+b
End of log`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].filePath).toBe('file.ts');
  });

  /**
   * Verifies correct line number parsing from hunk headers.
   */
  it('should parse correct line numbers from hunk headers', () => {
    const input = `diff --git a/test.ts b/test.ts
index 999..aaa 100644
--- a/test.ts
+++ b/test.ts
@@ -10,4 +12,5 @@
 line10
 line11
-line12
+line12 modified
 line13`;

    const result: DiffResult[] = parseDiff(input);
    const hunk = result[0].hunks[0];
    expect(hunk.oldStart).toBe(10);
    expect(hunk.oldLines).toBe(4);
    expect(hunk.newStart).toBe(12);
    expect(hunk.newLines).toBe(5);
  });

  /**
   * Large diff parsing without performance issues.
   */
  it('should parse a large diff without throwing', () => {
    const header = `diff --git a/large.ts b/large.ts
index bbb..ccc 100644
--- a/large.ts
+++ b/large.ts
`;
    const hunkStart = `@@ -1,1000 +1,1001 @@\n`;
    const lines = Array.from({ length: 1000 }, (_, i) => (i % 2 === 0 ? ` line${i}` : `-line${i}`));
    const input = header + hunkStart + lines.join('\n');
    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].hunks[0].lines.length).toBe(1000);
  });

  /**
   * Handles hunk header with no lines (unusual but possible).
   */
  it('should handle a hunk with no lines', () => {
    const input = `diff --git a/empty.ts b/empty.ts
index aaa..bbb 100644
--- a/empty.ts
+++ b/empty.ts
@@ -0,0 +0,0 @@`;

    const result: DiffResult[] = parseDiff(input);
    expect(result).toHaveLength(1);
    expect(result[0].hunks[0].lines).toHaveLength(0);
  });

  /**
   * Verifies that the parser correctly throws when hunk header is malformed.
   */
  it('should throw for malformed hunk header', () => {
    const input = `diff --git a/test.ts b/test.ts
index 123..456 100644
--- a/test.ts
+++ b/test.ts
@@ invalid @@
 a
 b`;

    expect(() => parseDiff(input)).toThrow('Invalid hunk header format');
  });

  /**
   * Verifies that the old mode and new mode are parsed correctly.
   */
  it('should parse oldMode and newMode from mode change diff', () => {
    const input = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755`;

    const result: DiffResult[] = parseDiff(input);
    expect(result[0].oldMode).toBe('100644');
    expect(result[0].newMode).toBe('100755');
  });

  /**
   * Tests that logger.info was called during parsing (via mock).
   */
  it('should log parsing start and end', () => {
    const input = `diff --git a/file.ts b/file.ts
index 111..222 100644
--- a/file.ts
+++ b/file.ts
@@ -1,1 +1,2 @@
 a
+b`;
    parseDiff(input);
    expect(logger.info).toHaveBeenCalledWith('Starting diff parser');
    expect(logger.info).toHaveBeenCalledWith('Completed diff parser');
  });
});