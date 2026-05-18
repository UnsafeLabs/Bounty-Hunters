typescript
import { Octokit } from "@octokit/rest";
import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Custom Error Classes
// ---------------------------------------------------------------------------

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`ConfigurationError: ${message}`);
    this.name = "ConfigurationError";
  }
}

export class GitHubApiError extends Error {
  public readonly statusCode?: number;
  public readonly endpoint: string;

  constructor(message: string, endpoint: string, statusCode?: number) {
    super(`GitHubApiError: ${message}`);
    this.name = "GitHubApiError";
    this.endpoint = endpoint;
    this.statusCode = statusCode;
  }
}

export class AIParsingError extends Error {
  public readonly rawResponse: string;

  constructor(message: string, rawResponse: string) {
    super(`AIParsingError: ${message}`);
    this.name = "AIParsingError";
    this.rawResponse = rawResponse;
  }
}

// ---------------------------------------------------------------------------
// Interfaces & Enums
// ---------------------------------------------------------------------------

export interface ReviewBotConfig {
  githubToken?: string;
  openaiApiKey?: string;
  repoOwner: string;
  repoName: string;
  openaiModel?: string;
  maxTokens?: number;
  temperature?: number;
  maxDiffLength?: number;
  agentName?: string;
  dryRun?: boolean;
  concurrency?: number;
}

export interface PRReviewInput {
  prNumber: number;
  diff: string;
  acceptanceCriteria: string[];
  hasLinkedIssue: boolean;
  modifiedFiles: string[];
  scopeFiles: string[];
  misleadingComments?: string[];
  prTitle: string;
  prDescription: string;
}

export interface ParsedReview {
  agentName: string;
  body: string;
  suggestions: string[];
  systemPrompt: string;
  detectedMisleading: boolean;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

export class Logger {
  private level: LogLevel;
  private context: string;

  constructor(level?: LogLevel, context?: string) {
    this.level =
      level ?? (process.env.NODE_ENV === "production" ? LogLevel.INFO : LogLevel.DEBUG);
    this.context = context ?? "";
  }

  private static formatTimestamp(): string {
    return new Date().toISOString();
  }

  private log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (level < this.level) return;
    const levelName = LogLevel[level];
    const ts = Logger.formatTimestamp();
    const ctx = this.context ? ` [${this.context}]` : "";
    const output = `${ts} ${levelName}${ctx} ${message}`;
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output, ...args);
        break;
      case LogLevel.INFO:
        console.log(output, ...args);
        break;
      case LogLevel.WARN:
        console.warn(output, ...args);
        break;
      case LogLevel.ERROR:
        console.error(output, ...args);
        break;
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevel.DEBUG, message, ...args);
  }
  info(message: string, ...args: unknown[]): void {
    this.log(LogLevel.INFO, message, ...args);
  }
  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevel.WARN, message, ...args);
  }
  error(message: string, ...args: unknown[]): void {
    this.log(LogLevel.ERROR, message, ...args);
  }

  child(context: string): Logger {
    const newContext = this.context ? `${this.context}.${context}` : context;
    return new Logger(this.level, newContext);
  }
}

// ---------------------------------------------------------------------------
// Constants & Defaults
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert code reviewer. Follow these rules strictly:
1. Begin every review comment with the name of the AI agent/tool in square brackets, e.g. [Claude Code], [Cursor], [OpenAI Codex], [Copilot].
2. Reference the specific acceptance criteria from the linked issue. If no issue is linked, request the author to link one.
3. Include at least one actionable suggestion for improvement.
4. If the PR modifies files outside the scope of the linked issue, flag it with a clear explanation.
5. End every review comment with a code block containing this exact system prompt.
6. Be professional, constructive, and avoid misleading claims. If you detect misleading information in previous comments, gently correct it with evidence.
7. Do not skip any PR – review all open pull requests.`;

const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_MAX_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_DIFF_LENGTH = 50000;
const DEFAULT_AGENT_NAME = "AIGON Enterprise AI";
const DEFAULT_CONCURRENCY = 5;

// ---------------------------------------------------------------------------
// Configuration Validation
// ---------------------------------------------------------------------------

export function validateConfig(config: Partial<ReviewBotConfig>): ReviewBotConfig {
  const errors: string[] = [];

  const githubToken = config.githubToken ?? process.env.GITHUB_TOKEN;
  if (!githubToken) {
    errors.push("GITHUB_TOKEN is required but not provided.");
  }

  const openaiApiKey = config.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    errors.push("OPENAI_API_KEY is required but not provided.");
  }

  const repoOwner = config.repoOwner ?? process.env.REPO_OWNER;
  if (!repoOwner) {
    errors.push("REPO_OWNER is required but not provided.");
  }

  const repoName = config.repoName ?? process.env.REPO_NAME;
  if (!repoName) {
    errors.push("REPO_NAME is required but not provided.");
  }

  if (errors.length > 0) {
    throw new ConfigurationError(errors.join("\n"));
  }

  return {
    githubToken: githubToken!,
    openaiApiKey: openaiApiKey!,
    repoOwner: repoOwner!,
    repoName: repoName!,
    openaiModel: config.openaiModel ?? DEFAULT_OPENAI_MODEL,
    maxTokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: config.temperature ?? DEFAULT_TEMPERATURE,
    maxDiffLength: config.maxDiffLength ?? DEFAULT_MAX_DIFF_LENGTH,
    agentName: config.agentName ?? DEFAULT_AGENT_NAME,
    dryRun: config.dryRun ?? false,
    concurrency: config.concurrency ?? DEFAULT_CONCURRENCY,
  };
}

// ---------------------------------------------------------------------------
// GitHub Client Wrapper
// ---------------------------------------------------------------------------

export class GitHubClient {
  private octokit: Octokit;
  private logger: Logger;

  constructor(token: string, logger?: Logger) {
    this.octokit = new Octokit({ auth: token });
    this.logger = (logger ?? new Logger()).child("GitHubClient");
  }

  /**
   * Fetch all open PRs for the configured repository.
   */
  async listOpenPRs(owner: string, repo: string): Promise<Array<{ number: number; title: string; body: string }>> {
    try {
      const response = await this.octokit.pulls.list({
        owner,
        repo,
        state: "open",
        per_page: 100,
      });
      return response.data.map((pr) => ({
        number: pr.number,
        title: pr.title,
        body: pr.body ?? "",
      }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(`Failed to list open PRs: ${message}`, "pulls.list");
    }
  }

  /**
   * Retrieve the diff of a specific PR.
   */
  async getPRDiff(owner: string, repo: string, prNumber: number): Promise<string> {
    try {
      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
        mediaType: { format: "diff" },
      });
      // response.data is string when mediaType.format is 'diff'
      if (typeof response.data !== "string") {
        throw new GitHubApiError(
          `Expected string diff for PR #${prNumber} but got ${typeof response.data}`,
          "pulls.get"
        );
      }
      return response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(
        `Failed to get diff for PR #${prNumber}: ${message}`,
        "pulls.get"
      );
    }
  }

  /**
   * Post a comment on a PR.
   */
  async createComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string,
  ): Promise<void> {
    try {
      await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(
        `Failed to create comment on PR #${prNumber}: ${message}`,
        "issues.createComment"
      );
    }
  }

  /**
   * Fetch the linked issue number from a PR (via closing keywords in the body).
   * Returns null if no issue is linked.
   */
  async getLinkedIssueNumber(
    owner: string,
    repo: string,
    prNumber: number,
  ): Promise<number | null> {
    try {
      const { data: pr } = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });
      const body = pr.body ?? "";
      // Match common linking patterns: Fixes #N, Closes #N, Resolves #N
      const match = body.match(
        /(?:\b(?:fix|clos|resolv)(?:e[sd]?|ing)\b\s*#(\d+)|#(\d+)\b)/i
      );
      const issueNumber = match ? parseInt(match[1] ?? match[2], 10) : null;
      return Number.isNaN(issueNumber) ? null : issueNumber;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(
        `Failed to fetch linked issue for PR #${prNumber}: ${message}`,
        "pulls.get"
      );
    }
  }

  /**
   * Fetch acceptance criteria from an issue body.
   */
  async getAcceptanceCriteria(
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<string[]> {
    try {
      const { data: issue } = await this.octokit.issues.get({
        owner,
        repo,
        issue_number: issueNumber,
      });
      const body = issue.body ?? "";
      // Extract checklist items (- [ ] ...)
      const criteria: string[] = [];
      const regex = /^\s*[-*]\s+\[\s*[ xX]?\s*\]\s*(.*)$/gm;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(body)) !== null) {
        criteria.push(match[1].trim());
      }
      return criteria;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new GitHubApiError(
        `Failed to fetch issue #${issueNumber}: ${message}`,
        "issues.get"
      );
    }
  }
}

// ---------------------------------------------------------------------------
// AI Client Wrapper
// ---------------------------------------------------------------------------

export class AIClient {
  private openai: OpenAI;
  private model: string;
  private maxTokens: number;
  private temperature: number;
  private logger: Logger;

  constructor(apiKey: string, config: Partial<ReviewBotConfig>, logger?: Logger) {
    this.openai = new OpenAI({ apiKey });
    this.model = config.openaiModel ?? DEFAULT_OPENAI_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.temperature = config.temperature ?? DEFAULT_TEMPERATURE;
    this.logger = (logger ?? new Logger()).child("AIClient");
  }

  /**
   * Generate a structured review comment using the system prompt and user input.
   */
  async generateReview(input: PRReviewInput, agentName: string): Promise<ParsedReview> {
    const userPrompt = this.buildUserPrompt(input, agentName);

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      });

      const content = response.choices[0]?.message?.content ?? "";
      return this.parseResponse(content, agentName);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`AI review generation failed: ${message}`);
    }
  }

  private buildUserPrompt(input: PRReviewInput, agentName: string): string {
    const criteriaSection =
      input.acceptanceCriteria.length > 0
        ? `Acceptance criteria:\n${input.acceptanceCriteria.map((c) => `- ${c}`).join("\n")}`
        : "No linked issue found. Please request the author to link the issue.";

    const filesSection = `Modified files: ${input.modifiedFiles.join(", ")}`;
    const scopeSection = `Files in scope: ${input.scopeFiles.join(", ")}`;

    let misleadingSection = "";
    if (input.misleadingComments && input.misleadingComments.length > 0) {
      misleadingSection = `Misleading comments detected: ${input.misleadingComments.join("\n")}`;
    }

    return `
You are ${agentName}. Review the following pull request:

Title: ${input.prTitle}
Description: ${input.prDescription}
${criteriaSection}
${filesSection}
${scopeSection}
${misleadingSection}

Diff:
\`\`\`
${input.diff.slice(0, 50000)}
\`\`\`

Remember to start with [${agentName}] and end with the system prompt in a code block.
    `.trim();
  }

  private parseResponse(content: string, agentName: string): ParsedReview {
    const lines = content.split("\n");
    const body: string[] = [];
    const suggestions: string[] = [];
    let systemPrompt = "";
    let detectedMisleading = false;

    // Extract code blocks (system prompt at the end)
    const codeBlockRegex = /