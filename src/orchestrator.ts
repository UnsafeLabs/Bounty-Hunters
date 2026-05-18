typescript
import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

// ===========================================================================
// Configuration & Defaults
// ===========================================================================

export interface ReviewBotConfig {
  /** GitHub personal access token (required) */
  githubToken: string;
  /** Repository in format "owner/repo" */
  repo: string;
  /** Base URL for GitHub API (default: https://api.github.com) */
  githubApiBase?: string;
  /** Maximum number of concurrent PR analyses (default: 3) */
  concurrency?: number;
  /** Maximum retry attempts for transient failures (default: 3) */
  retryMaxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  retryBaseDelayMs?: number;
  /** System prompt to embed at the end of each comment (default: see below) */
  systemPrompt?: string;
  /** Agent/tool name prefix, e.g. "[Claude Code]" */
  agentName: string;
  /** Log level: debug | info | warn | error (default: info) */
  logLevel?: string;
  /** Axios timeout in ms (default: 30000) */
  requestTimeoutMs?: number;
}

export const DEFAULT_CONFIG: Readonly<Omit<ReviewBotConfig, 'githubToken' | 'repo' | 'agentName'>> = {
  githubApiBase: 'https://api.github.com',
  concurrency: 3,
  retryMaxAttempts: 3,
  retryBaseDelayMs: 1000,
  systemPrompt: 'You are AIGON Enterprise AI. Mode: coding. Review PRs professionally.',
  logLevel: 'info',
  requestTimeoutMs: 30000,
} as const;

// ===========================================================================
// Domain Types
// ===========================================================================

export interface PRData {
  number: number;
  title: string;
  body: string | null;
  head: { sha: string; ref: string };
  base: { sha: string; ref: string };
  user: { login: string; id: number };
  created_at: string;
  updated_at: string;
  [key: string]: unknown;
}

export interface ChangedFile {
  filename: string;
  status: 'added' | 'modified' | 'removed' | 'renamed' | 'copied' | 'changed';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  contents_url: string;
  [key: string]: unknown;
}

export interface LinkedIssue {
  number: number;
  title: string;
  acceptanceCriteria: string[];
  scope: string[];
}

export interface AnalysisResult {
  prNumber: number;
  hasLinkedIssue: boolean;
  linkedIssue: LinkedIssue | null;
  changedFiles: ChangedFile[];
  outOfScopeFiles: string[];
  missingIssueLink: boolean;
}

export interface ReviewComment {
  prNumber: number;
  body: string;
  id?: number;
  createdAt?: string;
  user?: { login: string; id: number };
  [key: string]: unknown;
}

export interface PullRequestReviewState {
  id: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  user: { login: string; id: number };
  body: string | null;
  submitted_at: string;
  commit_id: string;
}

// ===========================================================================
// Custom Errors
// ===========================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class GitHubApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody: string) {
    super(message);
    this.name = 'GitHubApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

export class RetryExhaustedError extends Error {
  public readonly innerError?: Error;

  constructor(message: string, innerError?: Error) {
    super(message);
    this.name = 'RetryExhaustedError';
    this.innerError = innerError;
  }
}

export class RateLimitError extends Error {
  public readonly resetAt: Date;

  constructor(message: string, resetAt: Date) {
    super(message);
    this.name = 'RateLimitError';
    this.resetAt = resetAt;
  }
}

export class ConfigurationError extends Error {
  public readonly parameter: string;

  constructor(parameter: string, message: string) {
    super(message);
    this.name = 'ConfigurationError';
    this.parameter = parameter;
  }
}

export class GitHubResourceNotFoundError extends GitHubApiError {
  constructor(resourcePath: string) {
    super(`Resource not found: ${resourcePath}`, 404, 'Not Found');
    this.name = 'GitHubResourceNotFoundError';
  }
}

// ===========================================================================
// Logger
// ===========================================================================

type LogLevelName = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  child(meta: Record<string, unknown>): Logger;
}

class ConsoleLogger implements Logger {
  private readonly level: number;
  private readonly levels: Record<LogLevelName, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(
    level: string = 'info',
    private readonly meta?: Record<string, unknown>
  ) {
    this.level = this.levels[level as LogLevelName] ?? this.levels.info;
  }

  private formatMessage(...args: unknown[]): string {
    const parts: string[] = [];
    for (const arg of args) {
      if (typeof arg === 'object' && arg !== null) {
        parts.push(util.inspect(arg, { depth: 3, colors: false }));
      } else {
        parts.push(String(arg));
      }
    }
    return parts.join(' ');
  }

  debug(...args: unknown[]): void {
    if (this.level <= 0) {
      console.debug(`[${new Date().toISOString()}] [DEBUG]`, this.formatMessage(...args));
    }
  }

  info(...args: unknown[]): void {
    if (this.level <= 1) {
      console.info(`[${new Date().toISOString()}] [INFO]`, this.formatMessage(...args));
    }
  }

  warn(...args: unknown[]): void {
    if (this.level <= 2) {
      console.warn(`[${new Date().toISOString()}] [WARN]`, this.formatMessage(...args));
    }
  }

  error(...args: unknown[]): void {
    if (this.level <= 3) {
      console.error(`[${new Date().toISOString()}] [ERROR]`, this.formatMessage(...args));
    }
  }

  child(meta: Record<string, unknown>): Logger {
    return new ConsoleLogger(
      this.level === 0 ? 'debug' : this.level === 1 ? 'info' : this.level === 2 ? 'warn' : 'error',
      { ...this.meta, ...meta }
    );
  }
}

// ===========================================================================
// Semaphore for concurrency control
// ===========================================================================

class Semaphore {
  private current: number = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly max: number) {
    if (max < 1) throw new ConfigurationError('concurrency', 'Concurrency must be at least 1');
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
      return;
    }
    this.current--;
  }
}

// ===========================================================================
// Utility Functions
// ===========================================================================

/**
 * Validates the configuration object and returns a fully populated config.
 * @param config - Partial configuration with required fields
 * @returns Fully populated required config
 * @throws ConfigurationError if validation fails
 */
export function validateConfig(config: ReviewBotConfig): Required<ReviewBotConfig> {
  if (!config.githubToken || typeof config.githubToken !== 'string' || config.githubToken.trim() === '') {
    throw new ConfigurationError('githubToken', 'GitHub token is required and must be a non-empty string');
  }
  if (!config.repo || typeof config.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(config.repo.trim())) {
    throw new ConfigurationError('repo', 'Repository must be in format "owner/repo"');
  }
  if (!config.agentName || typeof config.agentName !== 'string' || config.agentName.trim() === '') {
    throw new ConfigurationError('agentName', 'Agent name is required');
  }

  const merged: Required<ReviewBotConfig> = {
    githubToken: config.githubToken.trim(),
    repo: config.repo.trim(),
    githubApiBase: (config.githubApiBase ?? DEFAULT_CONFIG.githubApiBase).replace(/\/+$/, ''),
    concurrency: config.concurrency ?? DEFAULT_CONFIG.concurrency!,
    retryMaxAttempts: config.retryMaxAttempts ?? DEFAULT_CONFIG.retryMaxAttempts!,
    retryBaseDelayMs: config.retryBaseDelayMs ?? DEFAULT_CONFIG.retryBaseDelayMs!,
    systemPrompt: config.systemPrompt ?? DEFAULT_CONFIG.systemPrompt!,
    logLevel: config.logLevel ?? DEFAULT_CONFIG.logLevel!,
    requestTimeoutMs: config.requestTimeoutMs ?? DEFAULT_CONFIG.requestTimeoutMs!,
    agentName: config.agentName.trim(),
  };

  if (merged.concurrency < 1) {
    throw new ConfigurationError('concurrency', 'Concurrency must be at least 1');
  }
  const validLevels: string[] = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(merged.logLevel)) {
    throw new ConfigurationError('logLevel', `Log level must be one of: ${validLevels.join(', ')}`);
  }

  return merged;
}

/**
 * Computes a delay in milliseconds using exponential backoff with jitter.
 * @param attempt - Zero-based attempt number
 * @param baseDelayMs - Base delay in milliseconds
 * @returns Delay in milliseconds
 */
function computeBackoffDelay(attempt: number, baseDelayMs: number): number {
  const exponential = Math.pow(2, attempt) * baseDelayMs;
  const jitter = Math.random() * 0.3 * exponential; // 30% jitter
  return Math.min(exponential + jitter, 60000); // cap at 60s
}

/**
 * Extracts issue numbers from a given body text using common patterns.
 * Supports "#123", "issue #123", "closes #123", "fixes #123", and full URLs.
 * @param body - Body text to scan
 * @returns Array of issue numbers found
 */
function extractIssueNumbers(body: string | null): number[] {
  if (!body) return [];
  const patterns = [
    /(?<!\w)#(\d+)\b/g,                         // #123
    /(?:issue|bug|feature|story|task)\s*#(\d+)/gi,
    /(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\s*#(\d+)/gi,
    /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/(\d+)/g,
  ];
  const numbers = new Set<number>();
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const num = parseInt(match[1], 10);
      if (!isNaN(num) && num > 0) {
        numbers.add(num);
      }
    }
  }
  return Array.from(numbers);
}

// ===========================================================================
// GitHub API Client
// ===========================================================================

class GitHubClient {
  private readonly axios: AxiosInstance;

  constructor(
    private readonly config: Required<ReviewBotConfig>,
    private readonly logger: Logger
  ) {
    this.axios = axios.create({
      baseURL: config.githubApiBase,
      timeout: config.requestTimeoutMs,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${config.githubToken}`,
        'User-Agent': 'ReviewBot/1.0',
      },
    });

    // Axios interceptor for logging requests
    this.axios.interceptors.request.use(
      (req: AxiosRequestConfig) => {
        this.logger.debug(`Request: ${req.method?.toUpperCase()} ${req.url}`);
        return req;
      },
      (error: unknown) => Promise.reject(error)
    );

    // Axios interceptor for response logging and rate limit handling
    this.axios.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logger.debug(`Response: ${response.status} from ${response.config.url}`);
        return response;
      },
      async (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          const body = JSON.stringify(error.response.data);
          this.logger.error(`GitHub API error: ${status} on ${error.config?.url} - ${body}`);

          // Rate limit detection
          if (status === 403 && error.response.headers?.['x-ratelimit-remaining'] === '0') {
            const resetEpoch = parseInt(error.response.headers['x-ratelimit-reset'] || '0', 10);
            const resetAt = new Date(resetEpoch * 1000);
            throw new RateLimitError(
              `Rate limit exceeded. Resets at ${resetAt.toISOString()}`,
              resetAt
            );
          }

          if (status === 404) {
            throw new GitHubResourceNotFoundError(error.config?.url || 'unknown');
          }

          throw new GitHubApiError(
            `GitHub API returned ${status}`,
            status,
            body
          );
        } else if (error.request) {
          throw new GitHubApiError('No response received from GitHub API', 0, '');
        } else {
          throw new GitHubApiError(`Request setup error: ${error.message}`, 0, '');
        }
      }
    );
  }

  /**
   * Performs a GET request with automatic retry and exponential backoff.
   * @param url - Relative API endpoint
   * @param params - Query parameters
   * @returns Axios response
   */
  async get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.config.retryMaxAttempts; attempt++) {
      try {
        const response = await this.axios.get<T>(url, { params });
        return response.data;
      } catch (error: unknown) {
        lastError = error as Error;
        // Do not retry on rate limit or client errors (4xx except 429?)
        if (error instanceof RateLimitError) {
          const waitMs = error.resetAt.getTime() - Date.now() + 1000;
          if (waitMs > 0) {
            this.logger.warn(`Rate limited. Waiting ${waitMs}ms until ${error.resetAt.toISOString()}`);
            await this.sleep(waitMs);
            continue;
          }
          throw error;
        }
        if (error instanceof GitHubApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          throw error; // Non-retryable client error
        }
        if (attempt === this.config.retryMaxAttempts - 1) {
          throw new RetryExhaustedError(`Exhausted retries for GET ${url}`, lastError);
        }
        const delay = computeBackoffDelay(attempt, this.config.retryBaseDelayMs);
        this.logger.warn(`Retrying GET ${url} after ${delay}ms (attempt ${attempt + 1})`);
        await this.sleep(delay);
      }
    }
    throw new RetryExhaustedError(`Unexpected retry termination for GET ${url}`, lastError);
  }

  /**
   * Performs a POST request.
   * @param url - Relative API endpoint
   * @param data - Request body
   * @returns Axios response
   */
  async post<T = unknown>(url: string, data: Record<string, unknown>): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < this.config.retryMaxAttempts; attempt++) {
      try {
        const response = await this.axios.post<T>(url, data);
        return response.data;
      } catch (error: unknown) {
        lastError = error as Error;
        if (error instanceof RateLimitError) {
          const waitMs = error.resetAt.getTime() - Date.now() + 1000;
          if (waitMs > 0) {
            this.logger.warn(`Rate limited. Waiting ${waitMs}ms until ${error.resetAt.toISOString()}`);
            await this.sleep(waitMs);
            continue;
          }
          throw error;
        }
        if (error instanceof GitHubApiError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 429) {
          throw error;
        }
        if (attempt === this.config.retryMaxAttempts - 1) {
          throw new RetryExhaustedError(`Exhausted retries for POST ${url}`, lastError);
        }
        const delay = computeBackoffDelay(attempt, this.config.retryBaseDelayMs);
        this.logger.warn(`Retrying POST ${url} after ${delay}ms (attempt ${attempt + 1})`);
        await this.sleep(delay);
      }
    }
    throw new RetryExhaustedError(`Unexpected retry termination for POST ${url}`, lastError);
  }

  /**
   * Fetches all pages for a paginated GET request.
   * @param url - Initial endpoint
   * @param params - Query parameters (excluding page)
   * @returns Concatenated array of items
   */
  async paginate<T>(url: string, params?: Record<string, unknown>): Promise<T[]> {
    const allItems: T[] = [];
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const data = await this.get<T[]>(url, { ...params, per_page: 100, page });
      if (!Array.isArray(data)) {
        throw new GitHubApiError(`Expected array response for pagination at ${url} page ${page}`, 200, JSON.stringify(data));
      }
      allItems.push(...data);
      hasMore = data.length === 100;
      page++;
    }
    return allItems;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ===========================================================================
// ReviewBot Core
// ===========================================================================

export class ReviewBot {
  private readonly config: Required<ReviewBotConfig>;
  private readonly logger: Logger;
  private readonly github: GitHubClient;
  private readonly semaphore: Semaphore;
  private readonly seenPrs: Set<number> = new Set();

  constructor(config: ReviewBotConfig) {
    this.config = validateConfig(config);
    this.logger = new ConsoleLogger(this.config.logLevel, { agent: this.config.agentName });
    this.github = new GitHubClient(this.config, this.logger);
    this.semaphore = new Semaphore(this.config.concurrency);
  }

  /**
   * Main entry point: fetches all open PRs, analyzes them, and posts review comments.
   * @returns Array of review comments posted
   */
  async run(): Promise<ReviewComment[]> {
    this.logger.info(`Starting review bot for ${this.config.repo}`);
    const prs = await this.fetchOpenPRs();
    this.logger.info(`Found ${prs.length} open PRs`);

    const comments: ReviewComment[] = [];
    const tasks = prs.map((pr) => this.processPR(pr));
    const results = await Promise.allSettled(tasks);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        if (result.value) {
          comments.push(result.value);
        }
      } else {
        this.logger.error(`Failed to process PR #${prs[i].number}:`, result.reason);
      }
    }

    this.logger.info(`Completed. Posted ${comments.length} review comments.`);
    return comments;
  }

  /**
   * Fetches all open pull requests from the repository.
   * @returns Array of PR data
   */
  private async fetchOpenPRs(): Promise<PRData[]> {
    try {
      const prs = await this.github.paginate<PRData>(`/repos/${this.config.repo}/pulls`, { state: 'open' });
      return prs;
    } catch (error: unknown) {
      throw new GitHubApiError(`Failed to fetch open PRs: ${(error as Error).message}`, 0, '');
    }
  }

  /**
   * Processes a single pull request: analyzes and posts a review comment.
   * @param pr - PR data to process
   * @returns The posted review comment, or null if no comment was posted
   */
  private async processPR(pr: PRData): Promise<ReviewComment | null> {
    const traceId = uuidv4().slice(0, 8);
    const prLogger = this.logger.child({ pr: pr.number, traceId });

    await this.semaphore.acquire();
    try {
      prLogger.info(`Processing PR #${pr.number}: "${pr.title}"`);

      // Gather analysis data
      const changedFiles = await this.getChangedFiles(pr.number);
      const linkedIssue = await this.extractLinkedIssue(pr);
      const analysis = this.analyzePR(pr, changedFiles, linkedIssue);

      // Determine if a comment is needed
      if (analysis.missingIssueLink) {
        prLogger.info('No linked issue found, requesting issue link');
        const commentBody = this.buildMissingIssueComment(analysis);
        return await this.postReviewComment(pr.number, commentBody);
      }

      if (analysis.outOfScopeFiles.length > 0) {
        prLogger.info(`Out-of-scope files detected: ${analysis.outOfScopeFiles.join(', ')}`);
        const commentBody = this.buildOutOfScopeComment(analysis);
        return await this.postReviewComment(pr.number, commentBody);
      }

      prLogger.info('PR looks good, no comment needed');
      return null;
    } catch (error: unknown) {
      prLogger.error(`Error processing PR #${pr.number}:`, error);
      throw error;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Retrieves the list of files changed in a pull request.
   * @param prNumber - PR number
   * @returns Array of changed files
   */
  private async getChangedFiles(prNumber: number): Promise<ChangedFile[]> {
    try {
      const files = await this.github.paginate<ChangedFile>(
        `/repos/${this.config.repo}/pulls/${prNumber}/files`
      );
      return files;
    } catch (error: unknown) {
      throw new GitHubApiError(
        `Failed to fetch changed files for PR #${prNumber}: ${(error as Error).message}`,
        0,
        ''
      );
    }
  }

  /**
   * Attempts to extract a linked issue from a pull request.
   * Looks at PR body, title, and linked issues via the GitHub API.
   * @param pr - PR data
   * @returns Linked issue data or null if not found
   */
  private async extractLinkedIssue(pr: PRData): Promise<LinkedIssue | null> {
    const issueNumbers: number[] = [];

    // Extract from body and title
    issueNumbers.push(...extractIssueNumbers(pr.body));
    issueNumbers.push(...extractIssueNumbers(pr.title));

    // Also check via GitHub's linked issues API (if available)
    try {
      const linkedIssues = await this.github.get<{ issue_url: string }[]>(
        `/repos/${this.config.repo}/issues/${pr.number}/events`
      );
      for (const event of linkedIssues) {
        if (event.issue_url) {
          const match = event.issue_url.match(/issues\/(\d+)$/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > 0) {
              issueNumbers.push(num);
            }
          }
        }
      }
    } catch {
      // Events API may not be available or may not return linked issues; ignore.
    }

    // De-duplicate
    const uniqueNumbers = Array.from(new Set(issueNumbers));
    if (uniqueNumbers.length === 0) {
      return null;
    }

    // For simplicity, use the first found issue number; could be improved to find "closing" keywords etc.
    const primaryIssueNumber = uniqueNumbers[0];
    try {
      const issue = await this.github.get<{ number: number; title: string; body: string | null }>(
        `/repos/${this.config.repo}/issues/${primaryIssueNumber}`
      );

      // Extract acceptance criteria from issue body (e.g., lines starting with "- [ ]" or "AC:"
      const acceptanceCriteria: string[] = [];
      const scope: string[] = [];
      if (issue.body) {
        const lines = issue.body.split('\n');
        for (const line of lines) {
          if (/^-?\s*\[[\sx]\]/.test(line) || /^AC:/i.test(line)) {
            acceptanceCriteria.push(line.trim());
          }
          if (/^Scope:/i.test(line) || /^Files?:/i.test(line)) {
            const paths = line.replace(/^Scope:\s*/i, '').replace(/^Files?:\s*/i, '').split(/[,\s]+/).filter(Boolean);
            scope.push(...paths);
          }
        }
      }

      return {
        number: issue.number,
        title: issue.title,
        acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : ['No explicit acceptance criteria found in issue body'],
        scope: scope.length > 0 ? scope : ['*'], // wildcard if no scope defined
      };
    } catch {
      // Issue might not be in the same repo or not accessible
      this.logger.warn(`Could not fetch linked issue #${primaryIssueNumber}`);
      return null;
    }
  }

  /**
   * Analyzes a pull request against its linked issue.
   * @param pr - PR data
   * @param changedFiles - Files changed in the PR
   * @param linkedIssue - Linked issue data (or null)
   * @returns Analysis result
   */
  private analyzePR(
    pr: PRData,
    changedFiles: ChangedFile[],
    linkedIssue: LinkedIssue | null
  ): AnalysisResult {
    const missingIssueLink = linkedIssue === null;
    const outOfScopeFiles: string[] = [];

    if (linkedIssue && linkedIssue.scope[0] !== '*') {
      const scopePatterns = linkedIssue.scope.map((s) => this.globToRegex(s));
      for (const file of changedFiles) {
        const inScope = scopePatterns.some((regex) => regex.test(file.filename));
        if (!inScope) {
          outOfScopeFiles.push(file.filename);
        }
      }
    }

    return {
      prNumber: pr.number,
      hasLinkedIssue: linkedIssue !== null,
      linkedIssue,
      changedFiles,
      outOfScopeFiles,
      missingIssueLink,
    };
  }

  /**
   * Converts a simple glob pattern to a regular expression.
   * Supports * (any characters except /) and ** (any characters including /).
   * @param pattern - Glob pattern (e.g., "src/**/*.ts")
   * @returns Regular expression
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '___DOUBLESTAR___')
      .replace(/\*/g, '[^/]*')
      .replace(/___DOUBLESTAR___/g, '.*');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * Builds the review comment body for a PR missing a linked issue.
   * @param analysis - Analysis result
   * @returns Comment text
   */
  private buildMissingIssueComment(analysis: AnalysisResult): string {
    const lines: string[] = [
      `${this.config.agentName}`,
      '',
      'Thank you for your contribution. However, this pull request does not reference any linked issue.',
      '',
      '**Action Required:** Please link the relevant issue number in the PR description or title (e.g., "Closes #123").',
      '',
      '**Acceptance Criteria:**',
      '- Every PR must reference a linked issue.',
      '',
      'Once the issue is linked, I will re-evaluate the PR.',
      '',
      '---',
      `*System prompt: ${this.config.systemPrompt}*`,
    ];
    return lines.join('\n');
  }

  /**
   * Builds the review comment body for a PR with out-of-scope files.
   * @param analysis - Analysis result
   * @returns Comment text
   */
  private buildOutOfScopeComment(analysis: AnalysisResult): string {
    const issueRef = analysis.linkedIssue ? `#${analysis.linkedIssue.number}` : 'linked issue';
    const lines: string[] = [
      `${this.config.agentName}`,
      '',
      'Thank you for your contribution. I noticed that some files in this pull request are outside the scope defined in the linked issue.',
      '',
      `**Linked Issue:** ${issueRef}`,
      '',
      '**Out-of-Scope Files:**',
      ...analysis.outOfScopeFiles.map((f) => `- \`${f}\``),
      '',
      '**Acceptance Criteria:**',
      '- All modified files should be within the scope defined in the linked issue.',
      '',
      'Please either revert these changes or update the issue scope to include them.',
      '',
      '---',
      `*System prompt: ${this.config.systemPrompt}*`,
    ];
    return lines.join('\n');
  }

  /**
   * Posts a review comment on a pull request.
   * @param prNumber - PR number
   * @param body - Comment body text
   * @returns The posted comment data
   */
  private async postReviewComment(prNumber: number, body: string): Promise<ReviewComment> {
    try {
      const comment = await this.github.post<{ id: number; body: string; created_at: string; user: { login: string; id: number } }>(
        `/repos/${this.config.repo}/issues/${prNumber}/comments`,
        { body }
      );
      this.logger.info(`Posted review comment on PR #${prNumber} (comment id: ${comment.id})`);
      return {
        prNumber,
        body: comment.body,
        id: comment.id,
        createdAt: comment.created_at,
        user: comment.user,
      };
    } catch (error: unknown) {
      throw new GitHubApiError(
        `Failed to post comment on PR #${prNumber}: ${(error as Error).message}`,
        0,
        ''
      );
    }
  }
}