import { ReviewOrchestrator } from '../src/orchestrator';
import { GithubClient } from '../src/github';
import { PRAnalyzer } from '../src/analyzer';
import { CommentGenerator } from '../src/comment-generator';
import { Logger } from '../src/logger';

jest.mock('../src/github');
jest.mock('../src/analyzer');
jest.mock('../src/comment-generator');
jest.mock('../src/logger');

const mockedGithub = jest.mocked(GithubClient);
const mockedAnalyzer = jest.mocked(PRAnalyzer);
const mockedGenerator = jest.mocked(CommentGenerator);
const mockedLogger = jest.mocked(Logger);

describe('ReviewOrchestrator - Integration style with mocks', () => {
  let orchestrator: ReviewOrchestrator;
  let githubClient: jest.Mocked<GithubClient>;
  let analyzer: jest.Mocked<PRAnalyzer>;
  let generator: jest.Mocked<CommentGenerator>;
  let logger: jest.Mocked<Logger>;

  const mockPr = {
    number: 42,
    title: 'Fix login bug',
    body: 'Closes #123',
    head: { ref: 'feature' },
    base: { ref: 'main' },
    html_url: 'https://github.com/owner/repo/pull/42',
  };

  const mockLinkedIssue = {
    number: 123,
    title: 'Login fails on mobile',
    body: '## Acceptance Criteria\n- User can log in on mobile devices\n- Error message shown on failure',
  };

  const mockDiff = 'diff --git a/src/auth.ts b/src/auth.ts\n...';

  const mockComment = `[Claude Code] Feedback\n\n- Looks correct: handles mobile login\n- Needs improvement: missing error handling\n\n\`\`\`\nYour system prompt here\n\`\`\``;

  beforeEach(() => {
    jest.clearAllMocks();

    githubClient = new GithubClient('token') as jest.Mocked<GithubClient>;
    analyzer = new PRAnalyzer(githubClient) as jest.Mocked<PRAnalyzer>;
    generator = new CommentGenerator('api-key') as jest.Mocked<CommentGenerator>;
    logger = new Logger() as jest.Mocked<Logger>;

    orchestrator = new ReviewOrchestrator(
      githubClient,
      analyzer,
      generator,
      logger,
      { owner: 'owner', repo: 'repo', agentName: 'Claude Code', systemPrompt: 'You are an AI code reviewer...' }
    );

    // Default mock implementations
    githubClient.fetchOpenPRs.mockResolvedValue([mockPr]);
    githubClient.getPullRequestDiff.mockResolvedValue(mockDiff);
    githubClient.postReviewComment.mockResolvedValue(undefined);
    analyzer.getLinkedIssueNumber.mockResolvedValue(123);
    analyzer.getAcceptanceCriteria.mockResolvedValue([
      'User can log in on mobile devices',
      'Error message shown on failure',
    ]);
    analyzer.getModifiedFiles.mockResolvedValue(['src/auth.ts']);
    analyzer.isFileOutOfScope.mockResolvedValue(false);
    generator.generateComment.mockResolvedValue(mockComment);
    logger.info.mockImplementation(() => {});
    logger.error.mockImplementation(() => {});
    logger.warn.mockImplementation(() => {});
  });

  it('should fetch all open PRs and process them end-to-end', async () => {
    await orchestrator.reviewAllPRs();

    expect(githubClient.fetchOpenPRs).toHaveBeenCalledTimes(1);
    expect(analyzer.getLinkedIssueNumber).toHaveBeenCalledWith(mockPr.number, mockPr.body);
    expect(analyzer.getAcceptanceCriteria).toHaveBeenCalledWith(123);
    expect(analyzer.getModifiedFiles).toHaveBeenCalledWith(mockPr.number);
    expect(analyzer.isFileOutOfScope).toHaveBeenCalledWith('src/auth.ts', 123);
    expect(generator.generateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 42,
        diff: mockDiff,
        acceptanceCriteria: expect.arrayContaining([
          'User can log in on mobile devices',
        ]),
        outOfScopeFiles: [],
        agentName: 'Claude Code',
      })
    );
    expect(githubClient.postReviewComment).toHaveBeenCalledWith(42, mockComment);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Completed review for PR #42'));
  });

  it('should handle PRs with no linked issue gracefully', async () => {
    analyzer.getLinkedIssueNumber.mockResolvedValue(null);

    await orchestrator.reviewAllPRs();

    expect(analyzer.getAcceptanceCriteria).not.toHaveBeenCalled();
    expect(generator.generateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        prNumber: 42,
        noLinkedIssue: true,
      })
    );
    expect(githubClient.postReviewComment).toHaveBeenCalled();
  });

  it('should flag out-of-scope files and still generate comment', async () => {
    analyzer.isFileOutOfScope.mockResolvedValue(true);
    analyzer.getModifiedFiles.mockResolvedValue(['src/auth.ts', 'src/unrelated.ts']);

    await orchestrator.reviewAllPRs();

    expect(generator.generateComment).toHaveBeenCalledWith(
      expect.objectContaining({
        outOfScopeFiles: expect.arrayContaining(['src/unrelated.ts']),
      })
    );
    expect(githubClient.postReviewComment).toHaveBeenCalled();
  });

  it('should retry on rate limit and succeed', async () => {
    githubClient.fetchOpenPRs
      .mockRejectedValueOnce(new Error('rate limit exceeded'))
      .mockResolvedValueOnce([mockPr]);

    await orchestrator.reviewAllPRs();

    expect(githubClient.fetchOpenPRs).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('rate limit'));
  });

  it('should throw after exhausting retries', async () => {
    githubClient.fetchOpenPRs.mockRejectedValue(new Error('rate limit exceeded'));

    await expect(orchestrator.reviewAllPRs()).rejects.toThrow('Max retries reached');
    expect(logger.error).toHaveBeenCalled();
  });

  it('should log and continue if a single PR fails', async () => {
    const mockPr2 = { ...mockPr, number: 43 };
    githubClient.fetchOpenPRs.mockResolvedValue([mockPr, mockPr2]);
    analyzer.getLinkedIssueNumber
      .mockResolvedValueOnce(123)
      .mockRejectedValueOnce(new Error('Network error'));

    await orchestrator.reviewAllPRs();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('PR #43'));
    expect(githubClient.postReviewComment).toHaveBeenCalledTimes(1);
  });

  it('should respect rate limiting headers when posting comments', async () => {
    githubClient.postReviewComment.mockRejectedValueOnce(new Error('rate limit: retry after 10s'));
    githubClient.postReviewComment.mockResolvedValueOnce(undefined);
    jest.useFakeTimers();

    const promise = orchestrator.reviewAllPRs();
    jest.advanceTimersByTime(10000);
    await promise;

    expect(githubClient.postReviewComment).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});