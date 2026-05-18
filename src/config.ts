typescript
import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import * as os from 'os';
import * as dotenv from 'dotenv';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOCAL_ENV_FILE = '.env.local';
const MAX_SYSTEM_PROMPT_LENGTH = 4096;
const MAX_COMMENT_LENGTH = 65536;
const MAX_RETRIES_DEFAULT = 3;
const TIMEOUT_MS_DEFAULT = 30000;
const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_AGENT_NAME = 'AIGON Enterprise AI';
const DEFAULT_SYSTEM_PROMPT =
  'You are a helpful code reviewer. Provide constructive feedback.';
const SENSITIVE_KEY_PATTERNS: readonly string[] = [
  'token',
  'apikey',
  'secret',
  'password',
  'credential',
  'systemprompt',
  'privatekey',
];
const USER_AGENT = 'aigon-enterprise-ai-reviewer/1.0';
const MAX_OPEN_PR_FETCH = 100;
const MAX_COMMENTS_FETCH = 100;

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

export class ConfigurationError extends Error {
  public readonly issues: readonly string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ConfigurationError';
    this.issues = Object.freeze(issues);
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

export class EnvironmentLoadError extends Error {
  public readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'EnvironmentLoadError';
    this.cause = cause;
    Object.setPrototypeOf(this, EnvironmentLoadError.prototype);
  }
}

export class GitHubApiError extends Error {
  public readonly statusCode: number;
  public readonly responseBody: string;

  constructor(message: string, statusCode: number, responseBody = '') {
    super(message);
    this.name = 'GitHubApiError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, GitHubApiError.prototype);
  }
}

export class OpenAiApiError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'OpenAiApiError';
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, OpenAiApiError.prototype);
  }
}

export class ValidationError extends Error {
  public readonly field: string;

  constructor(message: string, field: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class RetryError extends Error {
  public readonly attempts: number;

  constructor(message: string, attempts: number) {
    super(message);
    this.name = 'RetryError';
    this.attempts = attempts;
    Object.setPrototypeOf(this, RetryError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Log levels
// ---------------------------------------------------------------------------

export const LogLevel = {
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
} as const;

export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

// ---------------------------------------------------------------------------
// Log payload interface
// ---------------------------------------------------------------------------

export interface LogPayload {
  readonly timestamp: string;
  readonly level: string;
  readonly message: string;
  readonly meta?: Readonly<Record<string, unknown>>;
  readonly error?: Error;
}

// ---------------------------------------------------------------------------
// Logger class
// ---------------------------------------------------------------------------

export class Logger {
  private readonly minLevel: number;
  private readonly levelPriorities: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(
    private readonly context: string,
    minLevel: LogLevel = 'info',
  ) {
    if (!this.levelPriorities[minLevel]) {
      minLevel = 'info';
    }
    this.minLevel = this.levelPriorities[minLevel]!;
  }

  private log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
    error?: Error,
  ): void {
    if (this.levelPriorities[level]! < this.minLevel) return;

    const safeMeta = meta ? maskSensitiveValues(meta) : undefined;

    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      message: `[${this.context}] ${message}`,
      meta: safeMeta,
      error,
    };

    const output = JSON.stringify(payload, (key, value) => {
      if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
      }
      return value;
    });

    if (level === 'error' || level === 'warn') {
      process.stderr.write(output + '\n');
    } else {
      process.stdout.write(output + '\n');
    }
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>, error?: Error): void {
    this.log('warn', message, meta, error);
  }

  error(message: string, meta?: Record<string, unknown>, error?: Error): void {
    this.log('error', message, meta, error);
  }
}

// ---------------------------------------------------------------------------
// Sensitive value masking
// ---------------------------------------------------------------------------

function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[-_]/g, '');
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lowerKey.includes(pattern));
}

export function maskSensitiveValues<T extends Record<string, unknown>>(
  obj: T,
): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      masked[key] = '***MASKED***';
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitiveValues(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

// ---------------------------------------------------------------------------
// Configuration types and schema
// ---------------------------------------------------------------------------

interface GitHubConfig {
  readonly token: string;
  readonly owner: string;
  readonly repo: string;
}

interface OpenAIConfig {
  readonly apiKey: string;
}

export interface AigonConfig {
  readonly github: GitHubConfig;
  readonly openai: OpenAIConfig;
  readonly agentName: string;
  readonly systemPrompt: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;
}

const envSchema = z
  .object({
    GITHUB_TOKEN: z.string().min(1, 'GitHub token is required'),
    OPENAI_API_KEY: z.string().min(1, 'OpenAI API key is required'),
    REPO_OWNER: z.string().min(1, 'Repository owner is required'),
    REPO_NAME: z.string().min(1, 'Repository name is required'),
    AGENT_NAME: z.string().optional().default(DEFAULT_AGENT_NAME),
    SYSTEM_PROMPT: z.string().optional().default(DEFAULT_SYSTEM_PROMPT),
    MAX_RETRIES: z.coerce.number().int().min(0).optional().default(MAX_RETRIES_DEFAULT),
    TIMEOUT_MS: z.coerce.number().int().min(1000).optional().default(TIMEOUT_MS_DEFAULT),
  })
  .refine(
    (data) => /^gh[ps]_[a-zA-Z0-9]{36,}$/.test(data.GITHUB_TOKEN),
    { message: 'GITHUB_TOKEN format looks invalid. Should start with gh_ or ghp_ or ghs_ and be at least 36 characters', path: ['GITHUB_TOKEN'] }
  );

// ---------------------------------------------------------------------------
// Configuration loader
// ---------------------------------------------------------------------------

export class ConfigLoader {
  private static logger = new Logger('ConfigLoader', 'info');

  /**
   * Loads and validates configuration from environment variables.
   * Attempts to load a .env.local file from the current working directory.
   * @returns {Promise<AigonConfig>} A validated configuration object.
   * @throws {ConfigurationError} If the environment variables are invalid.
   * @throws {EnvironmentLoadError} If the .env.local file cannot be read.
   */
  public static async load(): Promise<AigonConfig> {
    ConfigLoader.logger.info(`Loading environment from ${LOCAL_ENV_FILE}`);
    
    const envPath = path.resolve(process.cwd(), LOCAL_ENV_FILE);
    
    try {
      const envContent = await fs.readFile(envPath, 'utf-8');
      const parsed = dotenv.parse(envContent);
      Object.assign(process.env, parsed);
      ConfigLoader.logger.debug(`Environment file ${LOCAL_ENV_FILE} loaded successfully`);
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        ConfigLoader.logger.warn(`No ${LOCAL_ENV_FILE} found, proceeding with existing environment`);
      } else {
        ConfigLoader.logger.error(`Failed to load environment file`, { path: envPath }, error as Error);
        throw new EnvironmentLoadError(
          `Failed to load ${LOCAL_ENV_FILE}: ${(error as Error).message}`,
          error,
        );
      }
    }

    const result = envSchema.safeParse(process.env);

    if (!result.success) {
      ConfigLoader.logger.error('Environment validation failed', {
        issues: result.error.issues.map((i) => i.path.join('.') + ': ' + i.message),
      });
      const messages = result.error.issues.map(
        (issue) => issue.path.join('.') + ': ' + issue.message,
      );
      throw new ConfigurationError('Invalid configuration', messages);
    }

    ConfigLoader.logger.info('Configuration loaded successfully');

    const env = result.data;

    return {
      github: {
        token: env.GITHUB_TOKEN,
        owner: env.REPO_OWNER,
        repo: env.REPO_NAME,
      },
      openai: {
        apiKey: env.OPENAI_API_KEY,
      },
      agentName: env.AGENT_NAME,
      systemPrompt: env.SYSTEM_PROMPT,
      maxRetries: env.MAX_RETRIES,
      timeoutMs: env.TIMEOUT_MS,
    };
  }
}

// ---------------------------------------------------------------------------
// Retry utility
// ---------------------------------------------------------------------------

export interface RetryOptions {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly logger: Logger;
}

const defaultRetryOptions: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 10000,
  logger: new Logger('Retry', 'info'),
};

/**
 * Executes an async function with exponential backoff retry logic.
 * @param fn - The async function to retry.
 * @param options - Retry configuration options.
 * @returns The result of the function.
 * @throws {RetryError} If all attempts fail.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts: RetryOptions = { ...defaultRetryOptions, ...options };
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      opts.logger.warn(
        `Attempt ${attempt}/${opts.maxAttempts} failed`,
        { error: lastError.message },
        lastError,
      );

      if (attempt === opts.maxAttempts) {
        break;
      }

      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new RetryError(
    `Operation failed after ${opts.maxAttempts} attempts: ${lastError?.message}`,
    opts.maxAttempts,
  );
}