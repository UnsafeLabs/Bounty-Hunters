typescript
import { Octokit } from '@octokit/rest';
import { RequestError } from '@octokit/request-error';
import { PaginateInterface } from '@octokit/plugin-paginate-rest';
import { Logger } from './logger'; // Assume a Logger interface exists

// ---------------------------------------------------------------------------
// Custom typed errors
// ---------------------------------------------------------------------------
export class GitHubClientError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'GitHubClientError';
    this.context = context;
    Object.setPrototypeOf(this, GitHubClientError.prototype);
  }
}

export class GitHubValidationError extends GitHubClientError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(`ValidationError: ${message}`, context);
    this.name = 'GitHubValidationError';
  }
}

export class GitHubRateLimitError extends GitHubClientError {
  public readonly retryAfter: number; // seconds

  constructor(message: string, retryAfter: number = 60, context: Record<string, unknown> = {}) {
    super(`RateLimitError: ${message}`, { ...context, retryAfter });
    this.name = 'GitHubRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class GitHubNotFoundError extends GitHubClientError {
  constructor(resource: string, context: Record<string, unknown> = {}) {
    super(`NotFound: ${resource} not found`, context);
    this.name = 'GitHubNotFoundError';
  }
}

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------
export interface GitHubClientConfig {
  /** GitHub personal access token (classic or fine-grained) */
  token: string;
  /** Repository owner (user or organization), case-insensitive */
  owner: string;
  /** Repository name */
  repo: string;
  /** Optional logger instance */
  logger?: Logger;
  /** Log level when using the default console logger */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Maximum number of retries for transient errors (default: 3) */
  maxRetries?: number;
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;
  /** Enable response caching (default: false) - simple in-memory cache */
  cache?: boolean;
}

/** Pull request with fields we commonly need */
export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  state: string;
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  body: string | null;
  user: { login: string; id: number };
  labels: Array<{ name: string; color: string | null }>;
  created_at: string;
  updated_at: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
}

/** Options for listing pull requests */
export interface ListPullRequestsOptions {
  state?: 'open' | 'closed' | 'all';
  head?: string;
  base?: string;
  sort?: 'created' | 'updated' | 'popularity' | 'long-running';
  direction?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

/** Options for creating a pull request */
export interface CreatePullRequestOptions {
  title: string;
  head: string;
  base: string;
  body?: string;
  draft?: boolean;
  maintainer_can_modify?: boolean;
}

/** Options for updating a pull request */
export interface UpdatePullRequestOptions {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  base?: string;
  maintainer_can_modify?: boolean;
}

/** Result of merging a pull request */
export interface MergeResult {
  merged: boolean;
  message: string;
  sha: string;
}

// ---------------------------------------------------------------------------
// Minimal console logger
// ---------------------------------------------------------------------------
class ConsoleLoggerImpl implements Logger {
  private readonly level: number;

  constructor(level: 'debug' | 'info' | 'warn' | 'error' = 'info') {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 } as const;
    this.level = levels[level] ?? 1;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level <= 0) console.debug(`[DEBUG] ${message}`, ...args);
  }
  info(message: string, ...args: unknown[]): void {
    if (this.level <= 1) console.info(`[INFO] ${message}`, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    if (this.level <= 2) console.warn(`[WARN] ${message}`, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    if (this.level <= 3) console.error(`[ERROR] ${message}`, ...args);
  }
}

// ---------------------------------------------------------------------------
// Simple in-memory cache with TTL
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class SimpleCache {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly defaultTTL: number;

  constructor(defaultTTLMs: number = 60_000) {
    this.defaultTTL = defaultTTLMs;
  }

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.data;
  }

  set<T>(key: string, data: T, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTTL;
    this.store.set(key, { data, expiresAt: Date.now() + ttl });
  }

  clear(): void {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Main GitHub client
// ---------------------------------------------------------------------------
export class GitHubClient {
  private readonly octokit: Octokit & { paginate: PaginateInterface };
  private readonly owner: string;
  private readonly repo: string;
  private readonly logger: Logger;
  private readonly maxRetries: number;
  private readonly timeout: number;
  private readonly cache: SimpleCache | null;

  private readonly githubNameRegex = /^[a-zA-Z0-9._-]+$/;
  private readonly tokenPrefixRegex = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)/;

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------
  constructor(config: GitHubClientConfig) {
    // Validate required fields
    const requiredFields: Record<string, string | undefined> = {
      token: config.token,
      owner: config.owner,
      repo: config.repo,
    };

    for (const [name, value] of Object.entries(requiredFields)) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new GitHubValidationError(`Field "${name}" is required and must be a non-empty string`, {
          providedType: typeof value,
        });
      }
    }

    // Normalize and validate owner/repo
    const owner = config.owner!.trim();
    const repo = config.repo!.trim();

    if (!this.githubNameRegex.test(owner)) {
      throw new GitHubValidationError(
        'Repository owner contains invalid characters; allowed: letters, numbers, hyphens, underscores, dots',
        { owner }
      );
    }
    if (!this.githubNameRegex.test(repo)) {
      throw new GitHubValidationError(
        'Repository name contains invalid characters; allowed: letters, numbers, hyphens, underscores, dots',
        { repo }
      );
    }

    const token = config.token!.trim();
    // Warn about unusual token formats but don't reject
    if (!this.tokenPrefixRegex.test(token)) {
      const fallbackLogger = new ConsoleLoggerImpl(config.logLevel ?? 'info');
      fallbackLogger.warn('Token format is atypical; authentication may fail', { tokenPrefix: token.slice(0, 4) });
    }

    this.owner = owner;
    this.repo = repo;
    this.logger = config.logger ?? new ConsoleLoggerImpl(config.logLevel ?? 'info');
    this.maxRetries = Number.isInteger(config.maxRetries) && config.maxRetries! >= 0 ? config.maxRetries! : 3;
    this.timeout = typeof config.timeout === 'number' && config.timeout > 0 ? config.timeout : 10_000;

    this.octokit = new Octokit({
      auth: token,
      request: {
        timeout: this.timeout,
        retries: 0, // We handle retries manually for full control
      },
    }) as Octokit & { paginate: PaginateInterface };

    this.cache = config.cache ? new SimpleCache(60_000) : null;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Generate a cache key from method name and arguments.
   */
  private cacheKey(method: string, ...args: unknown[]): string {
    return `${method}:${JSON.stringify(args)}`;
  }

  /**
   * Build a standard GitHub API error from a caught exception.
   */
  private buildError(error: unknown, context: Record<string, unknown>): GitHubClientError {
    if (error instanceof GitHubClientError) return error; // already ours

    if (error instanceof RequestError) {
      if (error.status === 404) {
        return new GitHubNotFoundError('Resource', { ...context, status: 404, message: error.message });
      }
      if (error.status === 429) {
        const retryAfter = parseInt(error.response?.headers?.['retry-after'] as string ?? '60', 10);
        return new GitHubRateLimitError(error.message, retryAfter, context);
      }
      return new GitHubClientError(`GitHub API error: ${error.message}`, {
        ...context,
        status: error.status,
        request: error.request,
      });
    }

    if (error instanceof Error) {
      return new GitHubClientError(error.message, context);
    }

    return new GitHubClientError('Unknown error', { ...context, originalError: String(error) });
  }

  /**
   * Validate that a numeric parameter is a positive integer.
   */
  private static validatePositiveInteger(value: number, name: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new GitHubValidationError(`"${name}" must be a positive integer`, { [name]: value });
    }
  }

  /**
   * Determine if an error is likely retryable.
   */
  private static isRetryableError(error: unknown): boolean {
    if (error instanceof RequestError) {
      const status = error.status;
      // Retry on rate limits and server errors
      if (status === 429) return true;
      if (status && status >= 500 && status < 600) return true;
      return false;
    }
    // Network errors
    if (error instanceof Error) {
      const msg = error.message;
      return msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('socket hang up') || msg.includes('connect ECONNREFUSED');
    }
    return false;
  }

  /**
   * Compute delay with exponential backoff and full jitter.
   */
  private static computeDelay(attempt: number, baseMs: number = 1000, maxMs: number = 60_000): number {
    const exponential = Math.min(baseMs * Math.pow(2, attempt), maxMs);
    return Math.random() * exponential;
  }

  /**
   * Execute an async operation with retry logic.
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    methodName: string,
    requestContext: Record<string, unknown> = {},
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await operation();
        if (attempt > 0) {
          this.logger.info(`Retry succeeded after ${attempt} attempt(s) for ${methodName}`, requestContext);
        }
        return result;
      } catch (error: unknown) {
        lastError = error;

        // Don't retry validation or not-found errors
        if (error instanceof GitHubValidationError || error instanceof GitHubNotFoundError) {
          throw error;
        }

        // If it's a rate limit error, we have more context
        if (error instanceof GitHubRateLimitError) {
          const waitMs = (error.retryAfter + 1) * 1000;
          this.logger.warn(`Rate limited, waiting ${waitMs}ms before retry (attempt ${attempt + 1})`, requestContext);
          await this.sleep(waitMs);
          continue;
        }

        if (!GitHubClient.isRetryableError(error)) {
          throw error;
        }

        // Last attempt - throw
        if (attempt === this.maxRetries) {
          break;
        }

        // Calculate delay
        const delayMs = GitHubClient.computeDelay(attempt, 1000, 60_000);
        this.logger.warn(
          `Transient error in ${methodName}, retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${this.maxRetries + 1})`,
          requestContext
        );
        await this.sleep(delayMs);
      }
    }

    // All retries failed
    throw this.buildError(lastError, {
      method: methodName,
      maxRetries: this.maxRetries,
      ...requestContext,
    });
  }

  /**
   * Promise-based sleep.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Build the standard owner/repo parameter object.
   */
  private repoParams(): { owner: string; repo: string } {
    return { owner: this.owner, repo: this.repo };
  }

  /**
   * Perform a paginated request using Octokit's paginate helper.
   */
  private async paginate<T>(
    method: (options: Record<string, unknown>) => Promise<{ data: T[] }>,
    options: Record<string, unknown>,
    methodName: string,
  ): Promise<T[]> {
    return this.withRetry(
      () => this.octokit.paginate(method, options) as Promise<T[]>,
      methodName,
      options,
    );
  }

  // -------------------------------------------------------------------------
  // Public API – Pull Requests
  // -------------------------------------------------------------------------

  /**
   * List pull requests for the repository.
   *
   * @param options - Filtering and pagination options.
   * @returns Array of pull requests.
   * @throws {GitHubValidationError} If options contain invalid values.
   * @throws {GitHubRateLimitError} On rate limiting after retries.
   * @throws {GitHubNotFoundError} If the repository does not exist.
   * @throws {GitHubClientError} On other API errors.
   */
  async listPullRequests(options: ListPullRequestsOptions = {}): Promise<PullRequest[]> {
    const methodName = 'listPullRequests';

    // Validate options
    if (options.per_page !== undefined) {
      GitHubClient.validatePositiveInteger(options.per_page, 'per_page');
      if (options.per_page > 100) {
        throw new GitHubValidationError('per_page must be ≤ 100', { per_page: options.per_page });
      }
    }
    if (options.page !== undefined) {
      GitHubClient.validatePositiveInteger(options.page, 'page');
    }
    const validStates = ['open', 'closed', 'all'];
    if (options.state && !validStates.includes(options.state)) {
      throw new GitHubValidationError(`state must be one of ${validStates.join(', ')}`, { state: options.state });
    }
    const validSorts = ['created', 'updated', 'popularity', 'long-running'];
    if (options.sort && !validSorts.includes(options.sort)) {
      throw new GitHubValidationError(`sort must be one of ${validSorts.join(', ')}`, { sort: options.sort });
    }
    const validDirections = ['asc', 'desc'];
    if (options.direction && !validDirections.includes(options.direction)) {
      throw new GitHubValidationError(`direction must be one of ${validDirections.join(', ')}`, { direction: options.direction });
    }

    const cacheKey = this.cacheKey(methodName, options);
    const cached = this.cache?.get<PullRequest[]>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${methodName}`, options);
      return cached;
    }

    const result = await this.paginate<{ data: PullRequest[] } & PullRequest>(
      this.octokit.pulls.list as any,
      { ...this.repoParams(), ...options },
      methodName,
    );

    // Map to our PullRequest type (the API response already matches mostly)
    const prs: PullRequest[] = result as unknown as PullRequest[];

    this.cache?.set(cacheKey, prs);
    return prs;
  }

  /**
   * Get a single pull request by number.
   *
   * @param pullNumber - Pull request number (positive integer).
   * @returns The pull request details.
   * @throws {GitHubValidationError} If pullNumber is invalid.
   * @throws {GitHubNotFoundError} If the PR does not exist.
   */
  async getPullRequest(pullNumber: number): Promise<PullRequest> {
    const methodName = 'getPullRequest';
    GitHubClient.validatePositiveInteger(pullNumber, 'pullNumber');

    const cacheKey = this.cacheKey(methodName, pullNumber);
    const cached = this.cache?.get<PullRequest>(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${methodName}`, { pullNumber });
      return cached;
    }

    const result = await this.withRetry(
      () => this.octokit.pulls.get({ ...this.repoParams(), pull_number: pullNumber }),
      methodName,
      { pullNumber },
    );

    const pr = result.data as unknown as PullRequest;
    this.cache?.set(cacheKey, pr);
    return pr;
  }

  /**
   * Create a new pull request.
   *
   * @param options - Title, head branch, base branch, optional body and draft flag.
   * @returns The created pull request.
   * @throws {GitHubValidationError} If any required field is missing or invalid.
   */
  async createPullRequest(options: CreatePullRequestOptions): Promise<PullRequest> {
    const methodName = 'createPullRequest';

    // Validate required fields
    if (!options.title || typeof options.title !== 'string' || options.title.trim().length === 0) {
      throw new GitHubValidationError('title is required and must be a non-empty string', { title: options.title });
    }
    if (!options.head || typeof options.head !== 'string' || options.head.trim().length === 0) {
      throw new GitHubValidationError('head is required and must be a non-empty string', { head: options.head });
    }
    if (!options.base || typeof options.base !== 'string' || options.base.trim().length === 0) {
      throw new GitHubValidationError('base is required and must be a non-empty string', { base: options.base });
    }

    const payload: Record<string, unknown> = {
      ...this.repoParams(),
      title: options.title.trim(),
      head: options.head.trim(),
      base: options.base.trim(),
    };
    if (options.body !== undefined) payload.body = options.body;
    if (options.draft !== undefined) payload.draft = options.draft;
    if (options.maintainer_can_modify !== undefined) payload.maintainer_can_modify = options.maintainer_can_modify;

    const result = await this.withRetry(
      () => this.octokit.pulls.create(payload as any),
      methodName,
      payload,
    );

    // Invalidate list cache
    this.cache?.clear();

    return result.data as unknown as PullRequest;
  }

  /**
   * Update an existing pull request.
   *
   * @param pullNumber - Pull request number.
   * @param options - Fields to update.
   * @returns The updated pull request.
   * @throws {GitHubValidationError} If pullNumber is invalid or options are empty.
   */
  async updatePullRequest(pullNumber: number, options: UpdatePullRequestOptions): Promise<PullRequest> {
    const methodName = 'updatePullRequest';
    GitHubClient.validatePositiveInteger(pullNumber, 'pullNumber');

    if (Object.keys(options).length === 0) {
      throw new GitHubValidationError('At least one option must be provided to update', { pullNumber });
    }

    const payload: Record<string, unknown> = {
      ...this.repoParams(),
      pull_number: pullNumber,
    };
    if (options.title !== undefined) payload.title = options.title.trim();
    if (options.body !== undefined) payload.body = options.body;
    if (options.state !== undefined) payload.state = options.state;
    if (options.base !== undefined) payload.base = options.base.trim();
    if (options.maintainer_can_modify !== undefined) payload.maintainer_can_modify = options.maintainer_can_modify;

    const result = await this.withRetry(
      () => this.octokit.pulls.update(payload as any),
      methodName,
      { pullNumber, options },
    );

    // Invalidate specific PR cache
    if (this.cache) {
      this.cache.clear(); // simpler: full clear
    }

    return result.data as unknown as PullRequest;
  }

  /**
   * Merge a pull request.
   *
   * @param pullNumber - Pull request number.
   * @param commitTitle - Optional commit title.
   * @param commitMessage - Optional commit message.
   * @param mergeMethod - Merge method: 'merge', 'squash', 'rebase'. Default 'merge'.
   * @returns The merge result.
   */
  async mergePullRequest(
    pullNumber: number,
    commitTitle?: string,
    commitMessage?: string,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge',
  ): Promise<MergeResult> {
    const methodName = 'mergePullRequest';
    GitHubClient.validatePositiveInteger(pullNumber, 'pullNumber');

    const validMethods = ['merge', 'squash', 'rebase'];
    if (!validMethods.includes(mergeMethod)) {
      throw new GitHubValidationError(`mergeMethod must be one of ${validMethods.join(', ')}`, { mergeMethod });
    }

    const payload: Record<string, unknown> = {
      ...this.repoParams(),
      pull_number: pullNumber,
      merge_method: mergeMethod,
    };
    if (commitTitle !== undefined) payload.commit_title = commitTitle;
    if (commitMessage !== undefined) payload.commit_message = commitMessage;

    const result = await this.withRetry(
      () => this.octokit.pulls.merge(payload as any),
      methodName,
      { pullNumber, mergeMethod },
    );

    return result.data as unknown as MergeResult;
  }

  /**
   * Get all open pull requests (shorthand).
   *
   * @returns Array of open pull requests.
   */
  async listOpenPullRequests(): Promise<PullRequest[]> {
    return this.listPullRequests({ state: 'open' });
  }

  /**
   * Get all closed pull requests (shorthand).
   *
   * @returns Array of closed pull requests.
   */
  async listClosedPullRequests(): Promise<PullRequest[]> {
    return this.listPullRequests({ state: 'closed' });
  }

  /**
   * Check if a pull request is still a draft.
   *
   * @param pullNumber - Pull request number.
   * @returns True if the PR is a draft.
   */
  async isDraftPullRequest(pullNumber: number): Promise<boolean> {
    const pr = await this.getPullRequest(pullNumber);
    return pr.draft;
  }
}