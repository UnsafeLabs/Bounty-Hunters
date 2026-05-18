typescript
import { GitHubClient } from '../src/githubClient';
import { Octokit } from '@octokit/rest';
import { Logger } from '../src/logger';
import { jest, beforeEach, afterEach, describe, it, expect, beforeAll } from '@jest/globals';

// ---------------------------------------------------------------------------
// Type imports for better type safety
// ---------------------------------------------------------------------------

import type { RestEndpointMethodTypes } from '@octokit/plugin-rest-endpoint-methods';
import type { RequestError } from '@octokit/request-error';

type PullsListResponseData = RestEndpointMethodTypes['pulls']['list']['response']['data'];

// ---------------------------------------------------------------------------
// Mock setup using jest.mocked helpers with strict typing
// ---------------------------------------------------------------------------

jest.mock('@octokit/rest');
jest.mock('../src/logger');

const MockOctokit = Octokit as jest.MockedClass<typeof Octokit>;
const MockLogger = Logger as jest.MockedClass<typeof Logger>;

// ---------------------------------------------------------------------------
// Logger instance used within this test module for diagnostic messages.
// ---------------------------------------------------------------------------

const testLogger = new Logger({ level: 'debug' });

// ---------------------------------------------------------------------------
// Mock Octokit instance factory with full type safety and error handling
// ---------------------------------------------------------------------------

/**
 * Creates a properly typed mock Octokit instance with all common methods mocked.
 * Uses jest.Mocked<> and explicit mock implementations for type safety.
 * All methods return jest.fn() by default; can be overridden after creation.
 *
 * @returns {jest.Mocked<Octokit>} A fully mocked Octokit instance
 * @throws {Error} If the mock constructor fails unexpectedly
 */
function createMockOctokitInstance(): jest.Mocked<Octokit> {
  // Build the mock from scratch to avoid relying on Octokit's constructor
  const mockPulls = {
    list: jest.fn(),
    get: jest.fn(),
    createReview: jest.fn(),
  } as unknown as jest.Mocked<Octokit['pulls']>;

  const mockIssues = {
    get: jest.fn(),
  } as unknown as jest.Mocked<Octokit['issues']>;

  const mockRepos = {
    getContent: jest.fn(),
  } as unknown as jest.Mocked<Octokit['repos']>;

  const mockPaginate = Object.assign(jest.fn(), {
    iterator: jest.fn(),
  }) as unknown as jest.Mocked<Octokit['paginate']>;

  const mockHook = Object.assign(jest.fn(), {
    error: jest.fn(),
    wrap: jest.fn(),
  }) as unknown as jest.Mocked<Octokit['hook']>;

  const mockLog = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Octokit['log']>;

  const instance: jest.Mocked<Octokit> = {
    pulls: mockPulls,
    issues: mockIssues,
    repos: mockRepos,
    auth: jest.fn(),
    request: jest.fn(),
    paginate: mockPaginate,
    hook: mockHook,
    graphql: jest.fn() as unknown as jest.Mocked<Octokit['graphql']>,
    log: mockLog,
  } as unknown as jest.Mocked<Octokit>;

  // Support async iteration for pagination (used in for-await loops)
  (instance as unknown as Record<symbol, unknown>)[Symbol.asyncIterator] = jest.fn();

  return instance;
}

// ---------------------------------------------------------------------------
// Stable test data factories (avoid brittle inline objects)
// ---------------------------------------------------------------------------

/** Default user object for PR creation */
const DEFAULT_USER = {
  login: 'user',
  id: 1,
  node_id: 'MDQ6VXNlcjE=',
  avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  gravatar_id: '',
  url: 'https://api.github.com/users/user',
  html_url: 'https://github.com/user',
  followers_url: 'https://api.github.com/users/user/followers',
  following_url: 'https://api.github.com/users/user/following{/other_user}',
  gists_url: 'https://api.github.com/users/user/gists{/gist_id}',
  starred_url: 'https://api.github.com/users/user/starred{/owner}{/repo}',
  subscriptions_url: 'https://api.github.com/users/user/subscriptions',
  organizations_url: 'https://api.github.com/users/user/orgs',
  repos_url: 'https://api.github.com/users/user/repos',
  events_url: 'https://api.github.com/users/user/events{/privacy}',
  received_events_url: 'https://api.github.com/users/user/received_events',
  type: 'User',
  site_admin: false,
} as const;

/** Default head/base objects for PR creation */
const DEFAULT_HEAD = {
  sha: 'abc123',
  ref: 'feature-branch',
  label: 'user:feature-branch',
  repo: null,
  user: null,
} as const;

const DEFAULT_BASE = {
  sha: 'main',
  ref: 'main',
  label: 'main',
  repo: null,
  user: null,
} as const;

const DEFAULT_LINKS = {
  self: { href: 'https://api.github.com/repos/owner/repo/pulls/1' },
  html: { href: 'https://github.com/owner/repo/pull/1' },
  issue: { href: 'https://api.github.com/repos/owner/repo/issues/1' },
  comments: {
    href: 'https://api.github.com/repos/owner/repo/issues/1/comments',
  },
  review_comments: {
    href: 'https://api.github.com/repos/owner/repo/pulls/1/comments',
  },
  review_comment: {
    href: 'https://api.github.com/repos/owner/repo/pulls/comments{/number}',
  },
  commits: {
    href: 'https://api.github.com/repos/owner/repo/pulls/1/commits',
  },
  statuses: {
    href: 'https://api.github.com/repos/owner/repo/statuses/abc123',
  },
} as const;

const DEFAULT_DATES = {
  created_at: '2023-01-01T00:00:00Z',
  updated_at: '2023-01-01T00:00:00Z',
  closed_at: null,
  merged_at: null,
} as const;

/**
 * Creates a minimal valid pull request object for list responses.
 * Uses optional overrides to keep default values test‑independent.
 * Validates input to prevent runtime surprises.
 *
 * @param overrides - Partial properties to override defaults
 * @returns A complete PullsListResponseData element
 * @throws {TypeError} If overrides is not a plain object or undefined
 */
function createMinimalPR(
  overrides?: Partial<PullsListResponseData[number]>
): PullsListResponseData[number] {
  if (overrides !== undefined && (typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new TypeError(
      `Expected overrides to be a plain object or undefined, got ${typeof overrides}`
    );
  }

  const base: PullsListResponseData[number] = {
    url: 'https://api.github.com/repos/owner/repo/pulls/1',
    id: 1,
    node_id: 'PR_kwDO...',
    html_url: 'https://github.com/owner/repo/pull/1',
    diff_url: 'https://github.com/owner/repo/pull/1.diff',
    patch_url: 'https://github.com/owner/repo/pull/1.patch',
    issue_url: 'https://api.github.com/repos/owner/repo/issues/1',
    commits_url: 'https://api.github.com/repos/owner/repo/pulls/1/commits',
    review_comments_url: 'https://api.github.com/repos/owner/repo/pulls/1/comments',
    review_comment_url: 'https://api.github.com/repos/owner/repo/pulls/comments{/number}',
    comments_url: 'https://api.github.com/repos/owner/repo/issues/1/comments',
    statuses_url: 'https://api.github.com/repos/owner/repo/statuses/abc123',
    number: 1,
    state: 'open',
    locked: false,
    title: 'Test PR',
    user: DEFAULT_USER as PullsListResponseData[number]['user'],
    body: 'This is a test PR body.',
    labels: [],
    milestone: null,
    active_lock_reason: null,
    created_at: DEFAULT_DATES.created_at,
    updated_at: DEFAULT_DATES.updated_at,
    closed_at: DEFAULT_DATES.closed_at,
    merged_at: DEFAULT_DATES.merged_at,
    merge_commit_sha: null,
    assignee: null,
    assignees: [],
    requested_reviewers: [],
    requested_teams: [],
    head: DEFAULT_HEAD as PullsListResponseData[number]['head'],
    base: DEFAULT_BASE as PullsListResponseData[number]['base'],
    _links: DEFAULT_LINKS as PullsListResponseData[number]['_links'],
    author_association: 'MEMBER',
    auto_merge: null,
    draft: false,
    merged: false,
    mergeable: null,
    rebaseable: null,
    mergeable_state: 'unknown',
    merged_by: null,
    comments: 0,
    review_comments: 0,
    maintainer_can_modify: false,
    commits: 0,
    additions: 0,
    deletions: 0,
    changed_files: 0,
  };

  // Apply overrides only once, without duplicating properties
  if (overrides) {
    Object.assign(base, overrides);
  }

  return base;
}

/**
 * Creates a minimal valid RequestError for testing error handling.
 * Uses type-safe construction with required fields.
 *
 * @param message - Error message
 * @param status - HTTP status code (default 500)
 * @returns A minimal RequestError instance
 */
function createMinimalRequestError(
  message: string,
  status: number = 500
): RequestError {
  const error = new Error(message) as RequestError;
  error.name = 'HttpError';
  error.status = status;
  error.response = {
    url: 'https://api.github.com/repos/owner/repo/pulls',
    status,
    headers: {},
    data: {},
  };
  error.request = {
    method: 'GET',
    url: 'https://api.github.com/repos/owner/repo/pulls',
    headers: {},
    request: { hook: '' },
  };
  error.errors = [
    {
      resource: 'PullRequest',
      field: 'state',
      code: 'custom',
    },
  ];
  return error;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('GitHubClient', () => {
  let mockOctokitInstance: jest.Mocked<Octokit>;
  let client: GitHubClient;
  const owner = 'testOwner';
  const repo = 'testRepo';

  beforeAll(() => {
    // One-time setup before any tests run
    testLogger.info('Starting GitHubClient test suite');
  });

  beforeEach(() => {
    // Create a fresh mock instance for each test to avoid leakage
    mockOctokitInstance = createMockOctokitInstance();
    MockOctokit.mockImplementation(() => mockOctokitInstance);
    MockLogger.mockImplementation(() => testLogger);

    client = new GitHubClient({
      owner,
      repo,
      token: 'test-token',
    });
  });

  afterEach(() => {
    // Restore all mocks after each test
    jest.clearAllMocks();
    testLogger.debug('Test teardown complete');
  });

  describe('listPullRequests', () => {
    it('should return a list of pull requests', async () => {
      // Arrange
      const prs = [createMinimalPR({ number: 1 }), createMinimalPR({ number: 2, state: 'closed' })];
      mockOctokitInstance.pulls.list.mockResolvedValue({
        data: prs,
        status: 200,
        url: '',
        headers: {},
      });

      // Act
      const result = await client.listPullRequests({ state: 'open' });

      // Assert
      expect(result).toEqual(prs);
      expect(mockOctokitInstance.pulls.list).toHaveBeenCalledWith({
        owner,
        repo,
        state: 'open',
      });
    });

    it('should handle API errors gracefully', async () => {
      // Arrange
      const error = createMinimalRequestError('API rate limit exceeded', 403);
      mockOctokitInstance.pulls.list.mockRejectedValue(error);

      // Act & Assert
      await expect(client.listPullRequests({})).rejects.toThrow('API rate limit exceeded');
      testLogger.error('listPullRequests failed as expected', error);
    });

    it('should handle network errors', async () => {
      // Arrange
      const networkError = new TypeError('Failed to fetch');
      mockOctokitInstance.pulls.list.mockRejectedValue(networkError);

      // Act & Assert
      await expect(client.listPullRequests({})).rejects.toThrow('Failed to fetch');
    });
  });

  describe('getPullRequest', () => {
    it('should return a single pull request by number', async () => {
      // Arrange
      const pr = createMinimalPR({ number: 42, title: 'Fix critical bug' });
      mockOctokitInstance.pulls.get.mockResolvedValue({
        data: pr,
        status: 200,
        url: '',
        headers: {},
      });

      // Act
      const result = await client.getPullRequest(42);

      // Assert
      expect(result).toEqual(pr);
      expect(mockOctokitInstance.pulls.get).toHaveBeenCalledWith({
        owner,
        repo,
        pull_number: 42,
      });
    });

    it('should throw if pull number is not a positive integer', async () => {
      await expect(client.getPullRequest(0)).rejects.toThrow('Invalid pull number');
      await expect(client.getPullRequest(-5)).rejects.toThrow('Invalid pull number');
      await expect(client.getPullRequest(NaN)).rejects.toThrow('Invalid pull number');
    });

    it('should handle 404 errors', async () => {
      const error = createMinimalRequestError('Not Found', 404);
      mockOctokitInstance.pulls.get.mockRejectedValue(error);
      await expect(client.getPullRequest(999)).rejects.toThrow('Not Found');
    });
  });

  describe('createPullRequestReview', () => {
    it('should post a review comment', async () => {
      const reviewData = { body: 'LGTM', event: 'APPROVE' as const };
      const reviewResponse = { id: 123, body: 'LGTM' };
      mockOctokitInstance.pulls.createReview.mockResolvedValue({
        data: reviewResponse,
        status: 200,
        url: '',
        headers: {},
      });

      const result = await client.createPullRequestReview(1, reviewData);
      expect(result).toEqual(reviewResponse);
      expect(mockOctokitInstance.pulls.createReview).toHaveBeenCalledWith({
        owner,
        repo,
        pull_number: 1,
        ...reviewData,
      });
    });

    it('should throw on invalid pull number', async () => {
      await expect(client.createPullRequestReview(0, { body: '' })).rejects.toThrow('Invalid pull number');
    });
  });

  describe('getIssue', () => {
    it('should fetch issue details', async () => {
      const issue = { id: 1, number: 1, title: 'Issue 1', body: 'Body', state: 'open' };
      mockOctokitInstance.issues.get.mockResolvedValue({
        data: issue,
        status: 200,
        url: '',
        headers: {},
      });

      const result = await client.getIssue(1);
      expect(result).toEqual(issue);
      expect(mockOctokitInstance.issues.get).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: 1,
      });
    });

    it('should handle missing issue', async () => {
      const error = createMinimalRequestError('Not Found', 404);
      mockOctokitInstance.issues.get.mockRejectedValue(error);
      await expect(client.getIssue(999)).rejects.toThrow('Not Found');
    });
  });

  describe('getFileContent', () => {
    it('should return file content', async () => {
      const contentData = {
        type: 'file',
        encoding: 'base64',
        size: 100,
        name: 'README.md',
        path: 'README.md',
        content: Buffer.from('# Hello').toString('base64'),
        sha: 'abc',
      };
      mockOctokitInstance.repos.getContent.mockResolvedValue({
        data: contentData,
        status: 200,
        url: '',
        headers: {},
      });

      const result = await client.getFileContent('README.md');
      expect(result).toEqual(contentData);
      expect(mockOctokitInstance.repos.getContent).toHaveBeenCalledWith({
        owner,
        repo,
        path: 'README.md',
      });
    });

    it('should throw on file not found', async () => {
      const error = createMinimalRequestError('Not Found', 404);
      mockOctokitInstance.repos.getContent.mockRejectedValue(error);
      await expect(client.getFileContent('nonexistent.md')).rejects.toThrow('Not Found');
    });
  });

  describe('pagination', () => {
    it('should iterate over paginated results', async () => {
      // Mock paginate.iterator to yield pages
      const page1 = [createMinimalPR({ number: 1 })];
      const page2 = [createMinimalPR({ number: 2 })];
      const mockIterator = {
        [Symbol.asyncIterator]: jest.fn().mockReturnValue({
          next: jest.fn()
            .mockResolvedValueOnce({ value: { data: page1 }, done: false })
            .mockResolvedValueOnce({ value: { data: page2 }, done: false })
            .mockResolvedValueOnce({ done: true }),
        }),
      };
      (mockOctokitInstance.paginate.iterator as jest.Mock).mockReturnValue(mockIterator);

      const results: PullsListResponseData[number][] = [];
      for await (const response of client.listPullRequests({}, { paginate: true })) {
        results.push(...response);
      }

      expect(results).toHaveLength(2);
      expect(results[0].number).toBe(1);
      expect(results[1].number).toBe(2);
    });
  });

  describe('error handling edge cases', () => {
    it('should handle unexpected errors gracefully', async () => {
      const unexpectedError = new Error('Something went wrong');
      mockOctokitInstance.pulls.list.mockRejectedValue(unexpectedError);
      await expect(client.listPullRequests({})).rejects.toThrow('Something went wrong');
    });

    it('should handle non-error rejections', async () => {
      mockOctokitInstance.pulls.list.mockRejectedValue('string error');
      await expect(client.listPullRequests({})).rejects.toThrow('string error');
    });
  });
});