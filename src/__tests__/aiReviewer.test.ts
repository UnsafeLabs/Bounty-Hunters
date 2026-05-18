typescript
import { buildPrompt, parseResponse, type PromptInput, type AiReviewResult } from './aiReviewer';
import { describe, it, expect } from '@jest/globals';

// ---------------------------------------------------------------------------
// Constants & Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DIFF = `diff --git a/src/index.ts b/src/index.ts
index abc123..def456 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,4 @@
-const x = 1;
+const x = 0;
+console.log(x);
`;

const DEFAULT_CONTEXT = { repo: 'owner/repo', prNumber: 42 };

const DEFAULT_CRITERIA = [
  'Code compiles without errors',
  'No commented-out code left behind',
  'All new public functions are documented',
];

const DEFAULT_PROMPT_INPUT: PromptInput = {
  diff: DEFAULT_DIFF,
  acceptanceCriteria: DEFAULT_CRITERIA,
  context: DEFAULT_CONTEXT,
};

// ---------------------------------------------------------------------------
// Test Suite: buildPrompt
// ---------------------------------------------------------------------------

describe('aiReviewer – buildPrompt', () => {
  /**
   * Verifies that the generated prompt contains the diff and acceptance criteria.
   */
  it('should include the diff and acceptance criteria', () => {
    const prompt = buildPrompt(DEFAULT_PROMPT_INPUT);
    expect(prompt).toContain(DEFAULT_DIFF);
    DEFAULT_CRITERIA.forEach((criterion) => {
      expect(prompt).toContain(criterion);
    });
  });

  /**
   * Acceptance Criterion: The prompt must instruct the AI to start each review
   * comment with the name of the agent/tool.
   */
  it('should instruct the AI to prefix comments with the agent name', () => {
    const prompt = buildPrompt(DEFAULT_PROMPT_INPUT);
    expect(prompt).toMatch(
      /(?:prefix|begin|start)\s+(?:each|your|the)\s+(?:review\s+)?comment\s+(?:with\s+)?(?:the\s+)?(?:agent|tool)\s+name/i,
    );
  });

  /**
   * Acceptance Criterion: The prompt must ask the AI to reference specific
   * acceptance criteria from the linked issue.
   */
  it('should require referencing specific acceptance criteria', () => {
    const prompt = buildPrompt(DEFAULT_PROMPT_INPUT);
    expect(prompt).toMatch(
      /(?:reference|cite|mention|address)\s+(?:the\s+)?(?:specific\s+)?acceptance\s+(?:criteria|criterion)/i,
    );
  });

  /**
   * Acceptance Criterion: The prompt must instruct to flag files modified
   * outside the scope of the linked issue.
   */
  it('should instruct to flag out‑of‑scope file modifications', () => {
    const prompt = buildPrompt(DEFAULT_PROMPT_INPUT);
    expect(prompt).toMatch(
      /(?:flag|identify|note|highlight)\s+(?:files?\s+)?(?:modified|changed)\s+(?:outside\s+(?:the\s+)?scope|out.?of.?scope)/i,
    );
  });

  /**
   * Handles empty diff gracefully.
   */
  it('should handle empty diff gracefully', () => {
    const prompt = buildPrompt({ ...DEFAULT_PROMPT_INPUT, diff: '' });
    expect(prompt).toContain('No changes detected');
    expect(prompt).not.toContain('diff --git');
  });

  /**
   * Handles empty acceptance criteria gracefully.
   */
  it('should handle empty acceptance criteria gracefully', () => {
    const prompt = buildPrompt({ ...DEFAULT_PROMPT_INPUT, acceptanceCriteria: [] });
    expect(prompt).toContain('No specific acceptance criteria provided');
  });

  /**
   * Throws a descriptive error when required inputs are missing.
   */
  it('should throw on missing required input', () => {
    // @ts-expect-error – intentionally passing undefined
    expect(() => buildPrompt(undefined)).toThrow('PromptInput is required');
    expect(() => buildPrompt({} as PromptInput)).toThrow('diff is required');
    expect(() => buildPrompt({ diff: 'x' } as PromptInput)).toThrow('context is required');
  });

  /**
   * Handles very large diffs without performance issues.
   */
  it('should handle large diffs (performance check)', () => {
    const largeDiff = `diff --git a/file.txt b/file.txt\n` + `+line\n`.repeat(10_000) + `-removed\n`.repeat(5_000);
    const start = performance.now();
    buildPrompt({ ...DEFAULT_PROMPT_INPUT, diff: largeDiff });
    const duration = performance.now() - start;
    expect(duration).toBeLessThan(500); // should complete within 500ms
  });
});

// ---------------------------------------------------------------------------
// Test Suite: parseResponse
// ---------------------------------------------------------------------------

describe('aiReviewer – parseResponse', () => {
  /**
   * Parses a complete valid response with all optional fields present.
   */
  it('should parse a complete valid response', () => {
    const rawResponse = `[SomeAI]
    This looks correct overall. Needs improvement.

    Suggestion: Add error handling.

    Code block:
    \`\`\`
    try { ... } catch (err) {
      console.error(err);
    }
    \`\`\`
    `;
    const result = parseResponse(rawResponse);
    expect(result).toEqual<AiReviewResult>({
      agentName: 'SomeAI',
      approved: true,
      comment: 'This looks correct overall. Needs improvement.\n\nSuggestion: Add error handling.',
      suggestions: ['Add error handling.'],
      systemPrompt: `try { ... } catch (err) {
      console.error(err);
    }`,
    });
  });

  /**
   * Parses a response without suggestions and code block.
   */
  it('should parse response without suggestions and code block', () => {
    const rawResponse = `[SimpleAI]
    Looks fine.
    No further actions.`;
    const result = parseResponse(rawResponse);
    expect(result).toEqual<AiReviewResult>({
      agentName: 'SimpleAI',
      approved: true,
      comment: 'Looks fine.\nNo further actions.',
      suggestions: [],
      systemPrompt: undefined,
    });
  });

  /**
   * Marks approval as false when response contains disapproval keywords.
   */
  it('should mark approval as false for rejected reviews', () => {
    const rawResponse = `[ReviewBot]
    This PR is rejected. Major issues found.
    Suggestion: Fix the logic error.`;
    const result = parseResponse(rawResponse);
    expect(result.approved).toBe(false);
  });

  /**
   * Returns a failure indicator for empty response.
   */
  it('should return a failure indicator for empty response', () => {
    const result = parseResponse('');
    expect(result.approved).toBe(false);
    expect(result.comment).toContain('Failed to parse');
  });

  /**
   * Defaults agent name to "Unknown" when no brackets are present.
   */
  it('should default to unknown agent when name missing', () => {
    const rawResponse = 'No brackets here. Just plain text.';
    const result = parseResponse(rawResponse);
    expect(result.agentName).toBe('Unknown');
  });

  /**
   * Extracts the last code block when multiple are present.
   */
  it('should extract the last code block from response', () => {
    const rawResponse = `[Multi]
    First:
    \`\`\`
    code1
    \`\`\`
    Second:
    \`\`\`
    code2
    \`\`\`
    `;
    const result = parseResponse(rawResponse);
    expect(result.systemPrompt).toBe('code2');
  });

  /**
   * Ignores inline backticks inside text (not a code block).
   */
  it('should not treat inline backticks as a code block', () => {
    const rawResponse = `[TestBot]
    Use \`const\` instead of \`var\`.`;
    const result = parseResponse(rawResponse);
    expect(result.systemPrompt).toBeUndefined();
  });
});