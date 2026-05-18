';
const DEFAULT_ACCEPTANCE_CRITERIA: string[] = [
  'Auth tokens are validated correctly',
  'Error messages are user-friendly',
];

const VALID_REVIEW_COMMENT = `[OpenAI Codex] This PR looks good overall. The token validation is solid, but consider adding more test cases for edge inputs.
Actionable suggestion: extend test coverage for invalid tokens.
${SYSTEM_PROMPT_CODE_BLOCK}`;

const NO_ISSUE_COMMENT = `[Copilot] Please link the relevant issue number to this PR.
${SYSTEM_PROMPT_CODE_BLOCK}`;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------
/** Creates a minimal PullRequest with sensible defaults. */
function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 1,
    title: 'Default PR',
    html_url: 'https://github.com/owner/repo/pull/1',
    head: { ref: 'fix-branch' },
    base: { ref: 'main' },
    ...overrides,
  };
}

/** Creates a minimal DiffEntry with sensible defaults. */
function makeDiff(overrides: Partial<DiffEntry> = {}): DiffEntry {
  return {
    file: 'src/index.ts',
    added: 10,
    removed: 2,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator test suite
// ---------------------------------------------------------------------------
describe('Orchestrator', () => {
  let orchestrator: Orchestrator;
  let mockGitHubClient: jest.Mocked<GitHubClient>;
  let mockIssueAnalyzer: jest.Mocked<IssueAnalyzer>;
  let mockDiffParser: jest.Mocked<DiffParser>;
  let mockAiReviewer: jest.Mocked<AiReviewer>;
  let mockCommentPoster: jest.Mocked<CommentPoster>;
  let mockLogger: jest.Mocked<Logger>;

  // Shared PR/diff fixtures
  const samplePrs: PullRequest[] = [
    makePr({ number: 1, title: 'Fix bug in auth', head: { ref: 'fix-auth' } }),
    makePr({ number: 2, title: 'Add new feature', head: { ref: 'feat-new' } }),
  ];

  const sampleDiffs: DiffEntry[] = [
    makeDiff({ file: 'src/auth.ts', added: 10, removed: 2 }),
    makeDiff({ file: 'src/feature.ts', added: 50, removed: 0 }),
  ];

  beforeEach(() => {
    mockGitHubClient = new MockGitHubClient() as jest.Mocked<GitHubClient>;
    mockIssueAnalyzer = new MockIssueAnalyzer() as jest.Mocked<IssueAnalyzer>;
    mockDiffParser = new MockDiffParser() as jest.Mocked<DiffParser>;
    mockAiReviewer = new MockAiReviewer() as jest.Mocked<AiReviewer>;
    mockCommentPoster = new MockCommentPoster() as jest.Mocked<CommentPoster>;
    mockLogger = new MockLogger() as jest.Mocked<Logger>;

    orchestrator = new Orchestrator(
      mockGitHubClient,
      mockIssueAnalyzer,
      mockDiffParser,
      mockAiReviewer,
      mockCommentPoster,
      mockLogger
    );
  });

  /**
   * Configures all mocks with default successful responses for a full review flow.
   * @param prs - The list of pull requests the client should return.
   */
  function setupDefaultMocks(prs: PullRequest[] = samplePrs): void {
    mockGitHubClient.listPullRequests.mockResolvedValue(prs);
    prs.forEach(() => {
      mockGitHubClient.getPullRequestDiff.mockResolvedValue(sampleDiffs);
    });
    mockIssueAnalyzer.extractAcceptanceCriteria.mockResolvedValue(DEFAULT_ACCEPTANCE_CRITERIA);
    mockDiffParser.parse.mockResolvedValue({ changedFiles: sampleDiffs, outOfScopeFiles: [] } as ParseResult);
    mockAiReviewer.generateReview.mockResolvedValue(VALID_REVIEW_COMMENT);
    mockCommentPoster.postComment.mockResolvedValue(undefined);
  }

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // run
  // -----------------------------------------------------------------------
  describe('run', () => {
    /**
     * Verifies the full happy path: all PRs are reviewed and comments posted.
     * Includes exactly one assertion per interaction.
     */
    test('should process all open PRs and post review comments', async () => {
      expect.assertions(8);
      setupDefaultMocks();

      await orchestrator.run();

      expect(mockGitHubClient.listPullRequests).toHaveBeenCalledTimes(1);
      expect(mockGitHubClient.getPullRequestDiff).toHaveBeenCalledTimes(2);
      expect(mockIssueAnalyzer.extractAcceptanceCriteria).toHaveBeenCalledTimes(2);
      expect(mockDiffParser.parse).toHaveBeenCalledTimes(2);
      expect(mockAiReviewer.generateReview).toHaveBeenCalledTimes(2);
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(2);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #1'));
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #2'));
    });

    /**
     * When there are no open PRs, the orchestrator should log a message and exit.
     */
    test('should handle no open PRs gracefully', async () => {
      expect.assertions(4);
      mockGitHubClient.listPullRequests.mockResolvedValue([]);

      await orchestrator.run();

      expect(mockGitHubClient.listPullRequests).toHaveBeenCalledTimes(1);
      expect(mockIssueAnalyzer.extractAcceptanceCriteria).not.toHaveBeenCalled();
      expect(mockCommentPoster.postComment).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('No open PRs found'));
    });

    /**
     * When listPullRequests throws an error, the orchestrator should log the error
     * and not proceed with any review.
     */
    test('should handle API error when listing PRs', async () => {
      expect.assertions(3);
      const error = new Error('Network failure');
      mockGitHubClient.listPullRequests.mockRejectedValue(error);

      await expect(orchestrator.run()).rejects.toThrow('Network failure');
      expect(mockIssueAnalyzer.extractAcceptanceCriteria).not.toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to list pull requests', error);
    });

    /**
     * If getPullRequestDiff fails for a particular PR, the orchestrator should
     * log the error and continue with the remaining PRs.
     */
    test('should continue processing if diff retrieval fails for one PR', async () => {
      expect.assertions(6);
      setupDefaultMocks();
      mockGitHubClient.getPullRequestDiff
        .mockResolvedValueOnce(sampleDiffs)
        .mockRejectedValueOnce(new Error('Diff unavailable'));

      await orchestrator.run();

      expect(mockGitHubClient.listPullRequests).toHaveBeenCalledTimes(1);
      expect(mockGitHubClient.getPullRequestDiff).toHaveBeenCalledTimes(2);
      // Only first PR should have been fully processed
      expect(mockDiffParser.parse).toHaveBeenCalledTimes(1);
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process PR #2'),
        expect.any(Error)
      );
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #1'));
    });

    /**
     * PR without a linked issue – reviewer generates comment requesting issue number.
     */
    test('should handle PR without linked issue by requesting issue number in review comment', async () => {
      expect.assertions(5);
      const prWithoutIssue = makePr({ number: 3, title: 'Random change' });
      mockGitHubClient.listPullRequests.mockResolvedValue([prWithoutIssue]);
      mockGitHubClient.getPullRequestDiff.mockResolvedValue(sampleDiffs);
      mockIssueAnalyzer.extractAcceptanceCriteria.mockResolvedValue(null);
      mockDiffParser.parse.mockResolvedValue({ changedFiles: sampleDiffs, outOfScopeFiles: [] } as ParseResult);
      mockAiReviewer.generateReview.mockResolvedValue(NO_ISSUE_COMMENT);
      mockCommentPoster.postComment.mockResolvedValue(undefined);

      await orchestrator.run();

      expect(mockIssueAnalyzer.extractAcceptanceCriteria).toHaveBeenCalledWith(3);
      expect(mockAiReviewer.generateReview).toHaveBeenCalledWith(
        expect.objectContaining({ acceptanceCriteria: null })
      );
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(1);
      // Ensure comment ends with system prompt code block
      expect(mockCommentPoster.postComment.mock.calls[0][1]).toEqual(NO_ISSUE_COMMENT);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #3'));
    });

    /**
     * PR that modifies files outside the scope of the linked issue.
     */
    test('should flag out-of-scope files in review comment', async () => {
      expect.assertions(4);
      const pr = samplePrs[0];
      mockGitHubClient.listPullRequests.mockResolvedValue([pr]);
      mockGitHubClient.getPullRequestDiff.mockResolvedValue(sampleDiffs);
      mockIssueAnalyzer.extractAcceptanceCriteria.mockResolvedValue(DEFAULT_ACCEPTANCE_CRITERIA);
      const outOfScopeParseResult: ParseResult = {
        changedFiles: sampleDiffs,
        outOfScopeFiles: ['package.json', 'README.md'],
      };
      mockDiffParser.parse.mockResolvedValue(outOfScopeParseResult);
      mockAiReviewer.generateReview.mockImplementation(async (input) => {
        // Simulate that the AI reviewer mentions out-of-scope files in its comment
        const files = input.outOfScopeFiles!.join(', ');
        return `[OpenAI Codex] The following files are out of scope: ${files}\nActionable suggestion: revert changes to these files.\n${SYSTEM_PROMPT_CODE_BLOCK}`;
      });
      mockCommentPoster.postComment.mockResolvedValue(undefined);

      await orchestrator.run();

      expect(mockDiffParser.parse).toHaveBeenCalledWith(expect.anything());
      expect(mockAiReviewer.generateReview).toHaveBeenCalledWith(
        expect.objectContaining({
          outOfScopeFiles: expect.arrayContaining(['package.json', 'README.md']),
        })
      );
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(1);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('out of scope'));
    });

    /**
     * If the review comment does not end with a system prompt code block,
     * the orchestrator should log a warning and still post the comment.
     */
    test('should warn when review comment lacks system prompt code block', async () => {
      expect.assertions(2);
      setupDefaultMocks();
      const incompleteComment = `[OpenAI Codex] Some review.\nActionable suggestion: improve tests.`;
      mockAiReviewer.generateReview.mockResolvedValue(incompleteComment);

      await orchestrator.run();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Review comment for PR #1 does not contain system prompt code block')
      );
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(2); // still posted for both
    });

    /**
     * If postComment fails, the orchestrator should log an error but continue.
     */
    test('should log error if posting comment fails', async () => {
      expect.assertions(3);
      setupDefaultMocks([samplePrs[0]]);
      mockCommentPoster.postComment.mockRejectedValue(new Error('403 Forbidden'));

      await orchestrator.run();

      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post comment on PR #1'),
        expect.any(Error)
      );
      expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('Review posted'));
    });

    /**
     * Acceptance criteria extraction returning an empty array should be treated
     * as a valid state (PR has no linked issue or issue has no criteria).
     */
    test('should handle empty acceptance criteria array', async () => {
      expect.assertions(3);
      mockGitHubClient.listPullRequests.mockResolvedValue([samplePrs[0]]);
      mockGitHubClient.getPullRequestDiff.mockResolvedValue(sampleDiffs);
      mockIssueAnalyzer.extractAcceptanceCriteria.mockResolvedValue([]);
      mockDiffParser.parse.mockResolvedValue({ changedFiles: sampleDiffs, outOfScopeFiles: [] } as ParseResult);
      const emptyCriteriaComment = `[Copilot] No acceptance criteria found for this PR. Please link an issue or add criteria.\n${SYSTEM_PROMPT_CODE_BLOCK}`;
      mockAiReviewer.generateReview.mockResolvedValue(emptyCriteriaComment);
      mockCommentPoster.postComment.mockResolvedValue(undefined);

      await orchestrator.run();

      expect(mockAiReviewer.generateReview).toHaveBeenCalledWith(
        expect.objectContaining({ acceptanceCriteria: [] })
      );
      expect(mockCommentPoster.postComment).toHaveBeenCalledWith(
        samplePrs[0].number,
        expect.stringContaining('No acceptance criteria found')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #1'));
    });

    /**
     * Verifies that each PR is processed independently and in order.
     * Also checks that the acceptance criteria for each PR are passed correctly to the AI reviewer.
     */
    test('should pass correct acceptance criteria per PR', async () => {
      expect.assertions(4);
      const pr1 = makePr({ number: 1, title: 'PR1', head: { ref: 'b1' } });
      const pr2 = makePr({ number: 2, title: 'PR2', head: { ref: 'b2' } });
      mockGitHubClient.listPullRequests.mockResolvedValue([pr1, pr2]);
      mockGitHubClient.getPullRequestDiff.mockResolvedValue(sampleDiffs);
      mockIssueAnalyzer.extractAcceptanceCriteria
        .mockResolvedValueOnce(['Criteria A', 'Criteria B'])
        .mockResolvedValueOnce(['Criteria C']);
      mockDiffParser.parse.mockResolvedValue({ changedFiles: sampleDiffs, outOfScopeFiles: [] } as ParseResult);
      mockAiReviewer.generateReview.mockResolvedValue(VALID_REVIEW_COMMENT);
      mockCommentPoster.postComment.mockResolvedValue(undefined);

      await orchestrator.run();

      expect(mockIssueAnalyzer.extractAcceptanceCriteria).toHaveBeenNthCalledWith(1, 1);
      expect(mockIssueAnalyzer.extractAcceptanceCriteria).toHaveBeenNthCalledWith(2, 2);
      expect(mockAiReviewer.generateReview).toHaveBeenNthCalledWith(1,
        expect.objectContaining({ acceptanceCriteria: ['Criteria A', 'Criteria B'] })
      );
      expect(mockAiReviewer.generateReview).toHaveBeenNthCalledWith(2,
        expect.objectContaining({ acceptanceCriteria: ['Criteria C'] })
      );
    });

    /**
     * When all partial failures occur (diff fails, then issue analyzer fails, then comment fails),
     * the orchestrator should handle each gracefully without crashing.
     */
    test('should handle multiple consecutive failures without crashing', async () => {
      expect.assertions(5);
      const pr1 = makePr({ number: 1, title: 'PR1' });
      const pr2 = makePr({ number: 2, title: 'PR2' });
      const pr3 = makePr({ number: 3, title: 'PR3' });
      mockGitHubClient.listPullRequests.mockResolvedValue([pr1, pr2, pr3]);

      // PR1: diff retrieval fails
      mockGitHubClient.getPullRequestDiff
        .mockRejectedValueOnce(new Error('Network timeout'))
      // PR2: issue analyzer fails
        .mockResolvedValueOnce(sampleDiffs)
      // PR3: all OK
        .mockResolvedValueOnce(sampleDiffs);

      mockIssueAnalyzer.extractAcceptanceCriteria
        .mockRejectedValueOnce(new Error('API limit'))
        .mockResolvedValueOnce(DEFAULT_ACCEPTANCE_CRITERIA);

      mockDiffParser.parse.mockResolvedValue({ changedFiles: sampleDiffs, outOfScopeFiles: [] } as ParseResult);
      mockAiReviewer.generateReview.mockResolvedValue(VALID_REVIEW_COMMENT);

      // PR2: posting fails
      mockCommentPoster.postComment
        .mockRejectedValueOnce(new Error('Forbidden'))
        .mockResolvedValueOnce(undefined);

      await orchestrator.run();

      // Errors should be logged
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process PR #1'),
        expect.any(Error)
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to process PR #2'),
        expect.any(Error)
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to post comment on PR #2'),
        expect.any(Error)
      );
      // PR3 should have succeeded
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Review posted for PR #3'));
      // Only PR3 comment was actually posted
      expect(mockCommentPoster.postComment).toHaveBeenCalledTimes(2); // PR2 attempt (failed) + PR3
    });

    /**
     * Ensures that the system prompt code block is present at the end of every review comment.
     * This test enforces the acceptance criteria from the linked issue.
     */
    test('ensures every review comment ends with system prompt code block', async () => {
      expect.assertions(3);
      setupDefaultMocks();

      await orchestrator.run();

      const calls = mockCommentPoster.postComment.mock.calls;
      calls.forEach(([, comment]) => {
        expect(comment).toMatch(/