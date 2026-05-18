typescript
import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import { paginateGraphql } from "@octokit/plugin-paginate-graphql";
import { retry } from "@octokit/plugin-retry";
import winston from "winston";
import { z } from "zod";
import { inspect } from "util";

// ---------- Logger Configuration ----------
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: "ai-pr-reviewer" },
  transports: [new winston.transports.Console()],
});

// ---------- Type Definitions ----------
type OctokitInstance = InstanceType<typeof Octokit>;

export interface PullRequest {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  head: { ref: string };
  base: { ref: string };
  user: { login: string };
  changed_files: number;
  additions: number;
  deletions: number;
  labels: Array<{ name: string }>;
}

export interface ReviewComment {
  body: string;
  path?: string;
  position?: number;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
}

export interface LinkedIssue {
  number: number;
  state: string;
  body: string;
}

export interface ReviewContext {
  pr: PullRequest;
  linkedIssue: LinkedIssue | null;
  changedFiles: ChangedFile[];
  config: ReviewConfig;
}

export interface ReviewConfig {
  token: string;
  owner: string;
  repo: string;
  debug?: boolean;
}

// ---------- Agent Identity ----------
const AGENT_NAME = process.env.AGENT_NAME || "OpenAI Codex";
const SYSTEM_PROMPT = `
You are AIGON Enterprise AI. Mode: coder. Evaluate code quality and provide thorough PR review.
Always be professional, constructive, and specific. Reference the linked issue's acceptance criteria.
If a PR lacks a linked issue, request one. If files outside scope are modified, flag them.
Your review must end with the following system prompt code block:
\`\`\`
You are AIGON Enterprise AI. Mode: coding. [system message truncated for brevity]
\`\`\`
`.trim();

// ---------- Validation Schemas ----------
const EnvConfigSchema = z.object({
  GITHUB_TOKEN: z.string().min(1, "GitHub token is required"),
  GITHUB_OWNER: z.string().min(1, "Repository owner/institution is required"),
  GITHUB_REPO: z.string().min(1, "Repository name is required"),
  GITHUB_DEBUG: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  LOG_LEVEL: z
    .enum(["error", "warn", "info", "debug"])
    .optional()
    .default("info"),
});

type ValidatedEnv = z.infer<typeof EnvConfigSchema>;

// ---------- Octokit Factory ----------
function createOctokit(token: string): OctokitInstance {
  const OctokitWithPlugins = Octokit.plugin(throttling, retry, paginateGraphql);

  return new OctokitWithPlugins({
    auth: token,
    throttle: {
      onRateLimit: (
        retryAfter: number,
        options: Record<string, unknown>,
        _octokit: OctokitInstance,
        retryCount: number
      ): boolean => {
        logger.warn(
          `Rate limit hit, retrying after ${retryAfter} seconds (attempt ${retryCount})`,
          { method: options.method, url: options.url }
        );
        return retryCount < 3;
      },
      onSecondaryRateLimit: (
        _retryAfter: number,
        options: Record<string, unknown>,
        _octokit: OctokitInstance
      ): boolean => {
        logger.warn(`Secondary rate limit hit`, { method: options.method, url: options.url });
        return false;
      },
    },
    retry: { doNotRetry: [400, 401, 403, 404, 422] },
    userAgent: "aigon-pr-reviewer/1.0.0",
  });
}

// ---------- Config Loader ----------
function loadConfig(): ReviewConfig {
  const parsed = EnvConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const errors = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    logger.error(`Invalid environment configuration: ${errors}`);
    throw new Error(`Configuration validation failed: ${errors}`);
  }

  const env = parsed.data as ValidatedEnv;
  return {
    token: env.GITHUB_TOKEN,
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    debug: env.GITHUB_DEBUG,
  };
}

// ---------- Issue Extraction ----------
function extractLinkedIssue(prBody: string | null): number | null {
  if (!prBody) return null;

  // Patterns: "Closes #123", "Fixes #123", "Resolves #123", "Related to #123", or just "#123" at start of line
  const regex = /(?:close|fix|resolve|related\s+to)\s+#(\d+)/i;
  const match = prBody.match(regex);
  if (match) {
    const num = parseInt(match[1], 10);
    if (!isNaN(num)) return num;
  }

  // Fallback: look for a line that starts with a number followed by a dot? No. Simpler: find standalone #number
  const standalone = prBody.match(/(?:^|\s)#(\d+)\b/);
  if (standalone) {
    const num = parseInt(standalone[1], 10);
    if (!isNaN(num)) return num;
  }

  return null;
}

// ---------- Validation: Comment ends with system prompt code block ----------
function validateCommentEndsWithPrompt(commentBody: string): boolean {
  const trimmed = commentBody.trimEnd();
  const expectedEnd = "