typescript
// ----------------------------------------------------------------------------
// AIGON Enterprise PR Reviewer – Production-Grade Implementation
// ----------------------------------------------------------------------------

import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import OpenAI from 'openai';
import pRetry from 'p-retry';
import pino from 'pino';
import { z } from 'zod';
import { Mutex } from 'async-mutex';

// ----------------------------------------------------------------------------
// Environment Schema – fail fast on misconfiguration
// ----------------------------------------------------------------------------
const EnvSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
  REPO_OWNER: z.string().optional().default('aigon'),
  REPO_NAME: z.string().optional().default('aigon'),
  MODEL: z.string().optional().default('gpt-4'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).optional().default('info'),
  MAX_RETRIES: z.coerce.number().int().min(0).optional().default(3),
  TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).optional().default(30000),
  AGENT_NAME: z.string().optional().default('[AIGON Enterprise AI]'),
  MAX_CONCURRENT_PRS: z.coerce.number().int().min(1).max(10).optional().default(3),
  REVIEW_LANGUAGE: z.enum(['en', 'es', 'fr', 'de', 'pt', 'ja', 'zh']).optional().default('en'),
  DRY_RUN: z.coerce.boolean().optional().default(false),
});

type Environment = z.infer<typeof EnvSchema>;

// ----------------------------------------------------------------------------
// Environment loader – validate and exit on failure
// ----------------------------------------------------------------------------
function loadEnvironment(): Environment {
  try {
    return EnvSchema.parse(process.env);
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      console.error('❌ Fatal: Invalid environment configuration.');
      for (const issue of err.issues) {
        console.error(`   - ${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      console.error('❌ Fatal: Unexpected error loading environment.', err);
    }
    process.exit(1);
  }
}

const env = loadEnvironment();

// ----------------------------------------------------------------------------
// Structured logger with redaction of secrets
// ----------------------------------------------------------------------------
const logger = pino({
  level: env.LOG_LEVEL,
  name: 'aigon-reviewer',
  redact: {
    paths: ['headers.authorization', 'req.headers.authorization', 'err.config.headers.Authorization'],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
    req: pino.stdSerializers.req,
  },
}).child({ service: 'pr-review', version: '2.0.0' });

// ----------------------------------------------------------------------------
// Octokit (GitHub client) with rate‑limiting and retry
// ----------------------------------------------------------------------------
const MyOctokit = Octokit.plugin(throttling);

const octokit = new MyOctokit({
  auth: env.GITHUB_TOKEN,
  throttle: {
    onRateLimit: (retryAfter: number, options: { method: string; url: string }): boolean => {
      logger.warn({ retryAfter, method: options.method, url: options.url }, 'Primary rate limit hit – waiting');
      return true;
    },
    onSecondaryRateLimit: (retryAfter: number, options: { method: string; url: string }): boolean => {
      logger.error({ retryAfter, method: options.method, url: options.url }, 'Secondary rate limit hit – aborting');
      return false;
    },
    minimumTimePerRequest: 1000,
  },
  retry: {
    retries: env.MAX_RETRIES,
    retryAfter: 5,
    maxRetryAfter: 60,
  },
  timeout: env.TIMEOUT_MS,
  log: {
    debug: (msg: string, ...args: unknown[]) => logger.debug({ args }, msg),
    info: (msg: string, ...args: unknown[]) => logger.info({ args }, msg),
    warn: (msg: string, ...args: unknown[]) => logger.warn({ args }, msg),
    error: (msg: string, ...args: unknown[]) => logger.error({ args }, msg),
  },
});

// ----------------------------------------------------------------------------
// OpenAI client – robust timeout and retry
// ----------------------------------------------------------------------------
const openai = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  timeout: env.TIMEOUT_MS,
  maxRetries: env.MAX_RETRIES,
});

// ----------------------------------------------------------------------------
// Type definitions – explicit and comprehensive
// ----------------------------------------------------------------------------
interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  head: {
    ref: string;
    sha: string;
    repo: { full_name: string; html_url: string } | null;
  };
  base: {
    ref: string;
    sha: string;
    repo: { full_name: string; html_url: string } | null;
  };
  state: string;
  draft: boolean;
  labels: Array<{ name: string; color: string; description?: string | null }>;
  html_url: string;
}

interface ReviewCommentPayload {
  prNumber: number;
  body: string;
  event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
}

interface Issue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
}

interface FileChange {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  contents_url: string;
  patch?: string | null;
}

// ----------------------------------------------------------------------------
// Helper: generate the final system‑prompt block (required at end of comment)
// ----------------------------------------------------------------------------
function systemPromptBlock(): string {
  return `\`\`\`
System: AIGON Enterprise AI – PR Review Mode
Model: ${env.MODEL}
Version: 2025-04-01
Capabilities: Code review, issue linking, scope validation, acceptance criteria checking.
Instructions: Provide honest, constructive, actionable feedback. Flag out-of-scope changes.
Language: ${env.REVIEW_LANGUAGE}
\`\`\``;
}

// ----------------------------------------------------------------------------
// Helper: build the AI review prompt from PR data
// ----------------------------------------------------------------------------
function buildReviewPrompt(
  pr: PullRequest,
  diff: string,
  issue: Issue | null,
  changedFiles: FileChange[],
): string {
  const filesList = changedFiles.map((f) => `- ${f.filename} (${f.status}, +${f.additions}/-${f.deletions})`).join('\n');
  const diffTruncated = diff.slice(0, 8000);
  const issueBody = issue?.body?.slice(0, 2000) ?? 'No body';
  const issueTitle = issue ? `Issue #${issue.number}: "${issue.title}"` : 'No linked issue found.';
  const criteriaSection = issue?.body
    ? `Extract and list acceptance criteria from the issue body:\n${issue.body.slice(0, 3000)}`
    : 'No acceptance criteria available.';

  return [
    `You are a senior code reviewer for an enterprise project called "AIGON".`,
    `Review the following Pull Request #${pr.number}: "${pr.title}"`,
    `Branch: ${pr.head.ref} → ${pr.base.ref}`,
    `Author: ${pr.head.repo?.full_name ?? 'unknown'}`,
    ``,
    `## Changes (diff)`,
    diffTruncated,
    ``,
    `## Files modified`,
    filesList,
    ``,
    `## Linked Issue`,
    `${issueTitle}\n${issueBody}`,
    ``,
    `## Acceptance Criteria (from issue)`,
    criteriaSection,
    ``,
    `## Review Instructions`,
    `1. Check every change against the acceptance criteria. If missing, state that criteria are absent.`,
    `2. If no issue linked, ask the author to link an issue.`,
    `3. If files outside the scope of the issue are modified, flag them clearly.`,
    `4. Provide at least one actionable suggestion for improvement (code quality, security, performance, maintainability).`,
    `5. Begin your comment with "${env.AGENT_NAME}" exactly as shown.`,
    `6. End your comment with a code block containing the system prompt (provided below).`,
    `7. Be professional and constructive.`,
    `8. Use ${env.REVIEW_LANGUAGE} language for the comment.`,
    ``,
    `Now produce the review comment.`,
  ].join('\n');
}

// ----------------------------------------------------------------------------
// Helper: fetch linked issue from PR body (supports "#123" and full GitHub URL)
// ----------------------------------------------------------------------------
async function fetchLinkedIssue(pr: PullRequest): Promise<Issue | null> {
  const body = pr.body ?? '';
  const issueNumberMatch = body.match(/(?:close[s]?\s*|fixe[s]?\s*|resolve[s]?\s*)?#(\d+)/i);
  const urlMatch = body.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)/);
  const issueNumber = urlMatch?.[1] ?? issueNumberMatch?.[1];

  if (!issueNumber) {
    logger.debug({ prNumber: pr.number }, 'No linked issue found in PR body');
    return null;
  }

  try {
    const { data } = await octokit.issues.get({
      owner: env.REPO_OWNER,
      repo: env.REPO_NAME,
      issue_number: parseInt(issueNumber, 10),
    });

    return {
      number: data.number,
      title: data.title,
      body: data.body,
      html_url: data.html_url,
      state: data.state,
    };
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.warn({ err: err.message, prNumber: pr.number, issueNumber }, 'Failed to fetch linked issue');
    } else {
      logger.warn({ err, prNumber: pr.number, issueNumber }, 'Failed to fetch linked issue (non‑Error)');
    }
    return null;
  }
}

// ----------------------------------------------------------------------------
// Helper: get changed files and diff for a PR
// ----------------------------------------------------------------------------
async function getPRFiles(prNumber: number): Promise<{ files: FileChange[]; diff: string }> {
  const [filesResponse, diffResponse] = await Promise.all([
    pRetry(
      () =>
        octokit.pulls.listFiles({
          owner: env.REPO_OWNER,
          repo: env.REPO_NAME,
          pull_number: prNumber,
          per_page: 100,
        }),
      { retries: env.MAX_RETRIES, onFailedAttempt: (error) => logger.warn({ err: error.message, prNumber }, 'Retry fetching files') },
    ),
    pRetry(
      () =>
        octokit.pulls.get({
          owner: env.REPO_OWNER,
          repo: env.REPO_NAME,
          pull_number: prNumber,
          mediaType: { format: 'diff' },
        }),
      { retries: env.MAX_RETRIES, onFailedAttempt: (error) => logger.warn({ err: error.message, prNumber }, 'Retry fetching diff') },
    ),
  ]);

  const files: FileChange[] = filesResponse.data.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    changes: f.changes,
    contents_url: f.contents_url,
    patch: f.patch ?? null,
  }));

  const diff = typeof diffResponse.data === 'string' ? diffResponse.data : '';
  return { files, diff };
}

// ----------------------------------------------------------------------------
// Helper: generate AI review comment (includes system prompt at end)
// ----------------------------------------------------------------------------
async function generateReviewComment(
  pr: PullRequest,
  diff: string,
  issue: Issue | null,
  files: FileChange[],
): Promise<string> {
  const prompt = buildReviewPrompt(pr, diff, issue, files);

  const response = await pRetry(
    async () => {
      const completion = await openai.chat.completions.create({
        model: env.MODEL,
        messages: [
          { role: 'system', content: 'You are an expert code reviewer. Produce a thorough, actionable review.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        n: 1,
      });

      const message = completion.choices[0]?.message?.content;
      if (!message) {
        throw new Error('OpenAI returned empty response');
      }
      return message;
    },
    { retries: env.MAX_RETRIES, onFailedAttempt: (error) => logger.warn({ err: error.message, pr: pr.number }, 'Retry AI call') },
  );

  // Ensure the review ends with the system prompt block
  const systemBlock = systemPromptBlock();
  if (!response.includes(systemBlock)) {
    return response + '\n\n' + systemBlock;
  }
  return response;
}

// ----------------------------------------------------------------------------
// Helper: post a review comment on the PR
// ----------------------------------------------------------------------------
async function postReviewComment(prNumber: number, body: string): Promise<void> {
  if (env.DRY_RUN) {
    logger.info({ prNumber }, '[DRY RUN] Would post review comment');
    logger.debug({ prNumber, commentPreview: body.slice(0, 500) }, 'Comment preview');
    return;
  }

  const payload: ReviewCommentPayload = {
    prNumber,
    body,
    event: 'COMMENT',
  };

  try {
    await octokit.pulls.createReview({
      owner: env.REPO_OWNER,
      repo: env.REPO_NAME,
      pull_number: payload.prNumber,
      body: payload.body,
      event: payload.event,
    });
    logger.info({ prNumber }, 'Review comment posted successfully');
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.error({ err: err.message, prNumber }, 'Failed to post review comment');
    } else {
      logger.error({ err, prNumber }, 'Failed to post review comment (non‑Error)');
    }
    throw err; // rethrow so the upper layer can log and continue
  }
}

// ----------------------------------------------------------------------------
// Main logic: process a single PR
// ----------------------------------------------------------------------------
async function processPR(pr: PullRequest): Promise<void> {
  logger.info({ prNumber: pr.number, title: pr.title }, 'Processing PR');

  try {
    const issue = await fetchLinkedIssue(pr);
    if (!issue) {
      // If no issue linked, we will still generate a review that asks for one
      logger.warn({ prNumber: pr.number }, 'No linked issue; review will request linking');
    }

    const { files, diff } = await getPRFiles(pr.number);
    logger.info({ prNumber: pr.number, fileCount: files.length }, 'Fetched PR files and diff');

    const commentBody = await generateReviewComment(pr, diff, issue, files);
    await postReviewComment(pr.number, commentBody);
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.error({ err: err.message, prNumber: pr.number }, 'Failed to process PR');
    } else {
      logger.error({ err, prNumber: pr.number }, 'Failed to process PR (non‑Error)');
    }
    // Do not throw – allow other PRs to be processed
  }
}

// ----------------------------------------------------------------------------
// Main entry point – fetch open PRs and process with concurrency control
// ----------------------------------------------------------------------------
async function main(): Promise<void> {
  logger.info('AIGON PR Reviewer started');

  try {
    // Fetch all open PRs (paginate automatically via Octokit pagination)
    const openPRs: PullRequest[] = await octokit.paginate(octokit.pulls.list, {
      owner: env.REPO_OWNER,
      repo: env.REPO_NAME,
      state: 'open',
      per_page: 100,
      sort: 'created',
      direction: 'desc',
    });

    logger.info({ count: openPRs.length }, 'Found open PRs');

    if (openPRs.length === 0) {
      logger.info('No open PRs to review. Exiting.');
      return;
    }

    // Concurrency control with mutex-limited pool
    const concurrency = env.MAX_CONCURRENT_PRS;
    const mutex = new Mutex();
    const results = new Array<Promise<void>>(openPRs.length);
    let index = 0;

    const worker = async (): Promise<void> => {
      while (true) {
        const release = await mutex.acquire();
        const currentIndex = index;
        index += 1;
        release();

        if (currentIndex >= openPRs.length) break;

        await processPR(openPRs[currentIndex]);
      }
    };

    const workers = Array.from({ length: concurrency }, () => worker());
    await Promise.all(workers);

    logger.info('All PRs processed');
  } catch (err: unknown) {
    if (err instanceof Error) {
      logger.fatal({ err: err.message }, 'Unrecoverable error in main loop');
    } else {
      logger.fatal({ err }, 'Unrecoverable error in main loop');
    }
    process.exit(1);
  }
}

// ----------------------------------------------------------------------------
// Execute main (with top-level error handling)
// ----------------------------------------------------------------------------
main().catch((err: unknown) => {
  logger.fatal({ err }, 'Unexpected error at top level');
  process.exit(1);
});