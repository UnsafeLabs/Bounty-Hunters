typescript
/* eslint-env jest */
/**
 * Unit tests for PrAnalyzer.
 *
 * @module tests/prAnalyzer.test
 */

import { PrAnalyzer, ScopeResult } from '../src/prAnalyzer';
import { GitHubClient } from '../src/githubClient';
import { Issue, PullRequest } from '../src/types';

// ---------------------------------------------------------------------------
// Mock the GitHubClient module
// ---------------------------------------------------------------------------
jest.mock('../src/githubClient');

/**
 * Minimal mock implementation covering all methods used by PrAnalyzer.
 */
const mockGitHubClient = {
  getIssue: jest.fn<Promise<Issue | null>, [number]>(),
  getDiff: jest.fn<Promise<string>, [number]>(),
  getChangedFiles: jest.fn<Promise<string[]>, [number]>(),
} as jest.Mocked<GitHubClient>;

describe('PrAnalyzer', (): void => {
  let analyzer: PrAnalyzer;

  // -------------------------------------------------------------------------
  // Shared test fixtures
  // -------------------------------------------------------------------------
  const mockPR: PullRequest = {
    number: 42,
    title: 'Fix landing page bug',
    body: 'Closes #17',
    head: { sha: 'abc123' },
    base: { sha: 'def456' },
  };

  const mockIssue: Issue = {
    number: 17,
    title: 'Landing page image not loading',
    body: [
      'Acceptance criteria:',
      '- Image loads on desktop',
      '- Image loads on mobile',
      '- Error message shown on failure',
    ].join('\n'),
  };

  const mockFiles: string[] = [
    'src/components/HeroImage.tsx',
    'src/constants/images.ts',
  ];

  const mockDiff: string = '...diff content...';

  // -------------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------------
  beforeEach((): void => {
    jest.clearAllMocks();
    analyzer = new PrAnalyzer(mockGitHubClient);
  });

  // -------------------------------------------------------------------------
  // Unit: analyzePullRequest
  // -------------------------------------------------------------------------
  describe('analyzePullRequest', (): void => {
    /**
     * Happy path – all acceptance criteria matched.
     * Verifies that:
     * - linked issue is detected
     * - no scope issues
     * - acceptance criteria are correctly parsed
     * - changed files match
     * - no error is set
     */
    it('should return in-scope changes with matched acceptance criteria', async (): Promise<void> => {
      expect.assertions(5);

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue(mockFiles);

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.isLinkedIssue).toBe(true);
      expect(result.scopeIssues).toHaveLength(0);
      expect(result.acceptanceCriteria).toEqual([
        'Image loads on desktop',
        'Image loads on mobile',
        'Error message shown on failure',
      ]);
      expect(result.changedFiles).toEqual(mockFiles);
      expect(result.error).toBeUndefined();
    });

    /**
     * Files outside the scope of any acceptance criterion are flagged.
     * Verifies that each out‑of‑scope file appears in:
     * - `outOfScopeFiles`
     * - `scopeIssues` with a descriptive reason
     */
    it('should flag out-of-scope files that do not relate to any acceptance criterion', async (): Promise<void> => {
      expect.assertions(5);

      const filesWithIrrelevant: string[] = [
        ...mockFiles,
        'src/config/database.ts',
      ];

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue(filesWithIrrelevant);

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      // Verify the file is flagged as out‑of‑scope
      expect(result.outOfScopeFiles).toContain('src/config/database.ts');
      expect(result.changedFiles).toHaveLength(3);
      expect(result.isLinkedIssue).toBe(true);

      // scopeIssues should contain an object for the out‑of‑scope file
      expect(result.scopeIssues).toContainEqual(
        expect.objectContaining({
          file: 'src/config/database.ts',
          reason: expect.stringMatching(/does not relate to any acceptance criterion/i),
        }),
      );
    });

    /**
     * When no issue is linked, the result must indicate the absence and contain
     * a descriptive error.
     */
    it('should return error when no linked issue is found', async (): Promise<void> => {
      expect.assertions(3);

      const prWithoutIssue: PullRequest = {
        ...mockPR,
        body: 'Fix some stuff',
      };

      mockGitHubClient.getIssue.mockResolvedValue(null);

      const result: ScopeResult = await analyzer.analyzePullRequest(prWithoutIssue);

      expect(result.isLinkedIssue).toBe(false);
      expect(result.error).toEqual(
        'No linked issue found. Author must reference an issue number in PR description.',
      );
      expect(result.acceptanceCriteria).toEqual([]);
    });

    /**
     * Graceful handling of PRs that have zero changed files.
     */
    it('should handle PRs with no changed files gracefully', async (): Promise<void> => {
      expect.assertions(4);

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue([]);

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.changedFiles).toEqual([]);
      expect(result.outOfScopeFiles).toEqual([]);
      expect(result.scopeIssues).toHaveLength(0);
      expect(result.isLinkedIssue).toBe(true);
    });

    /**
     * Warnings must be emitted when acceptance criteria cannot be extracted
     * from the issue body. The warning should reference the **actual linked
     * issue number** (from the PR body), not the issue object used for mock.
     */
    it('should log warnings when acceptance criteria cannot be parsed from issue body', async (): Promise<void> => {
      expect.assertions(3);

      const badIssue: Issue = {
        number: 18,
        title: 'No criteria',
        body: 'Just a note',
      };

      mockGitHubClient.getIssue.mockResolvedValue(badIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue(mockFiles);

      const consoleWarnSpy: jest.SpyInstance = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.acceptanceCriteria).toHaveLength(0);
      // The warning must mention #17, because the PR references issue #17.
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unable to extract acceptance criteria from issue #17'),
      );
      expect(result.isLinkedIssue).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    /**
     * Empty acceptance criteria (no bullet points, no keyword).
     * All files should be considered out‑of‑scope, and each should have an
     * entry in `scopeIssues` with an appropriate reason.
     */
    it('should handle issue body with no acceptance criteria keyword gracefully', async (): Promise<void> => {
      expect.assertions(5);

      const noCriteriaIssue: Issue = {
        number: 20,
        title: 'No acceptance criteria',
        body: 'This is a simple request without any formal criteria.',
      };

      mockGitHubClient.getIssue.mockResolvedValue(noCriteriaIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue(mockFiles);

      const consoleWarnSpy: jest.SpyInstance = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => {});

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);
      consoleWarnSpy.mockRestore();

      expect(result.acceptanceCriteria).toHaveLength(0);
      expect(result.outOfScopeFiles).toEqual(mockFiles);
      expect(result.scopeIssues).toHaveLength(mockFiles.length);
      // Each file should have a reason indicating no acceptance criteria
      result.scopeIssues.forEach(
        (issue: { file: string; reason: string }): void => {
          expect(issue.reason).toMatch(
            /does not relate to any acceptance criterion/i,
          );
        },
      );
      expect(result.isLinkedIssue).toBe(true);
      expect(result.error).toBeUndefined();
    });

    /**
     * Error handling when getIssue throws an unexpected error.
     * The analyzer should catch the error and return an appropriate result.
     */
    it('should handle getIssue throwing an error', async (): Promise<void> => {
      expect.assertions(3);

      const errorMessage = 'Network error';
      mockGitHubClient.getIssue.mockRejectedValue(new Error(errorMessage));

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.isLinkedIssue).toBe(false);
      expect(result.error).toContain(errorMessage);
      expect(result.acceptanceCriteria).toEqual([]);
    });

    /**
     * Error handling when getDiff throws an error.
     */
    it('should handle getDiff throwing an error', async (): Promise<void> => {
      expect.assertions(4);

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      const errorMessage = 'Diff fetch failed';
      mockGitHubClient.getDiff.mockRejectedValue(new Error(errorMessage));

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.isLinkedIssue).toBe(true);
      expect(result.error).toContain(errorMessage);
      expect(result.changedFiles).toBeUndefined();
      expect(result.scopeIssues).toHaveLength(0);
    });

    /**
     * Error handling when getChangedFiles throws an error.
     */
    it('should handle getChangedFiles throwing an error', async (): Promise<void> => {
      expect.assertions(4);

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      const errorMessage = 'Changed files fetch failed';
      mockGitHubClient.getChangedFiles.mockRejectedValue(new Error(errorMessage));

      const result: ScopeResult = await analyzer.analyzePullRequest(mockPR);

      expect(result.isLinkedIssue).toBe(true);
      expect(result.error).toContain(errorMessage);
      expect(result.changedFiles).toBeUndefined();
      expect(result.scopeIssues).toHaveLength(0);
    });

    /**
     * Linked issue with multiple references – ensure the correct issue is fetched.
     */
    it('should fetch the linked issue even if multiple issues are referenced', async (): Promise<void> => {
      expect.assertions(2);

      const prWithMultipleRefs: PullRequest = {
        ...mockPR,
        body: 'Closes #17, see also #23',
      };

      mockGitHubClient.getIssue.mockResolvedValue(mockIssue);
      mockGitHubClient.getDiff.mockResolvedValue(mockDiff);
      mockGitHubClient.getChangedFiles.mockResolvedValue(mockFiles);

      await analyzer.analyzePullRequest(prWithMultipleRefs);

      // Must have called getIssue for number 17 only
      expect(mockGitHubClient.getIssue).toHaveBeenCalledTimes(1);
      expect(mockGitHubClient.getIssue).toHaveBeenCalledWith(17);
    });

    /**
     * PR body with no references – error case already tested.
     */
    it('should handle PR body with no issue references', async (): Promise<void> => {
      expect.assertions(3);

      const prNoRef: PullRequest = {
        ...mockPR,
        body: 'This is a general fix.',
      };

      mockGitHubClient.getIssue.mockResolvedValue(null);

      const result: ScopeResult = await analyzer.analyzePullRequest(prNoRef);

      expect(result.isLinkedIssue).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.acceptanceCriteria).toEqual([]);
    });
  });
});