typescript
import { logger } from './logger';
import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';
import { retry } from '@octokit/plugin-retry';
import { paginateGraphQL } from '@octokit/plugin-paginate-graphql';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PR {
  number: number;
  title: string;
  body: string;
  changedFiles?: string[] | null;
  diff?: string | null;
  head?: { ref: string };
  base?: { ref: string };
  state?: string;
  html_url?: string;
  labels?: string[];
  comments?: Array<{ body: string; user?: { login: string } }>;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  state?: string;
  html_url?: string;
  labels?: string[];
}

export interface ReviewComment {
  prNumber: number;
  commentBody: string;
  posted: boolean;
  error?: string;
}

export interface AnalysisResult {
  changedFiles: string[];
  acceptanceCriteria: string[];
  outOfScopeFiles: string[];
  diffSummary: string;
  suggestions: string[];
  missingIssueLink: boolean;
  misleadingComments: string[];
}

export interface ReviewConfig {
  repoFullName: string;
  githubToken: string;
  agentName: string;
  systemPrompt: string;
  retryCount?: number;
  throttleDelay?: number;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class InvalidPRError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPRError';
  }
}

export class InvalidIssueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIssueError';
  }
}

export class AnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalysisError';
  }
}

export class GitHubAPIError extends Error {
  constructor(message: string, public statusCode?: number) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

// ---------------------------------------------------------------------------
// Octokit client factory
// ---------------------------------------------------------------------------

const OctokitWithPlugins = Octokit.plugin(throttling, retry, paginateGraphQL);

/**
 * Creates an Octokit instance with throttling, retry, and pagination plugins.
 * @param config - Review configuration containing token and options.
 * @returns Configured Octokit instance.
 * @throws ConfigurationError if token is missing or invalid.
 * @throws ConfigurationError if token is not a non-empty string.
 */
function createOctokit(config: ReviewConfig): Octokit {
  if (!config.githubToken || typeof config.githubToken !== 'string' || config.githubToken.trim().length === 0) {
    throw new ConfigurationError('A valid non-empty GitHub token string is required');
  }
  if (config.retryCount !== undefined && (!Number.isInteger(config.retryCount) || config.retryCount < 0)) {
    throw new ConfigurationError('retryCount must be a non-negative integer');
  }
  return new OctokitWithPlugins({
    auth: config.githubToken,
    throttle: {
      onRateLimit: (retryAfter: number, options: any, _octokit: Octokit) => {
        logger.warn(
          `Request quota exhausted for request ${options.method} ${options.url} – retrying after ${retryAfter}s`
        );
        return true;
      },
      onSecondaryRateLimit: (_retryAfter: number, options: any, _octokit: Octokit) => {
        logger.warn(`Secondary rate limit hit for ${options.method} ${options.url}`);
        return true;
      },
    },
    request: {
      retries: config.retryCount ?? 3,
      retryAfter: 2,
    },
  });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Patterns to extract acceptance criteria from issue body. */
const ACCEPTANCE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:##\s*Acceptance Criteria|Acceptance Criteria\s*:?)\s*\n([\s\S]*?)(?=\n##|$)/i,
  /(?:##\s*(?:A\/?C|AC:?)|AC\s*:?\s*)\s*\n([\s\S]*?)(?=\n##|$)/i,
  /(?:GIVEN|WHEN|THEN|Given|When|Then)[\s\S]*?(?=\n##|$)/i,
] as const;

/** Patterns to extract scope definition from issue body. */
const SCOPE_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:##\s*Scope|Scope\s*:?)\s*\n([\s\S]*?)(?=\n##|$)/i,
  /(?:Files?\s+affected|Affected\s+files)\s*:?\s*\n([\s\S]*?)(?=\n##|$)/i,
  /(?:##\s+Changes|Changes\s*:?)\s*\n([\s\S]*?)(?=\n##|$)/i,
] as const;

/** Patterns to detect potentially misleading comments. */
const MISLEADING_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:this\s+is\s+incorrect|that['']s\s+false|misleading\s+review|wrong\s+analysis)\b/i,
  /\b(?:unfair\s+bounty|false\s+claim\s+credit)\b/i,
  /\b(?:not\s+applicable\s+skip|skip\s+this\s+pr)\b/i,
] as const;

const MIN_CRITERIA_COUNT = 1;
const FALLBACK_KW = /\b(?:should|must|will|shall|expect)\b/i;
const CODE_LINE_START = /^[\s\t]*(?:[+\-><]|function|class|const|let|var|import|export|if|for|while)/;
const MAX_ITEM_LENGTH = 5000;
const MAX_SECTION_LINES = 5000;
const MAX_GLOB_LENGTH = 1000;
const MIN_CRITERION_LENGTH = 5;
const MIN_ALPHA_RATIO = 0.3;
const MAX_LINE_LENGTH = 80;
const PER_PAGE = 100;
const MAX_DIFF_LINES_FOR_ANALYSIS = 5000;
const MAX_COMMENT_LENGTH = 65536;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Safely extracts a capture group from a RegExp match.
 * Uses a non‑global regex to avoid the known bug with global flag and capture groups.
 * @param match - The regex match result or null.
 * @param groupIndex - Index of the capture group (default 1).
 * @returns Trimmed group string or empty string.
 */
function safeMatchGroup(match: RegExpMatchArray | null, groupIndex: number = 1): string {
  if (match && typeof match[groupIndex] === 'string') {
    return match[groupIndex].trim();
  }
  return '';
}

/**
 * Splits a markdown section into list items (bullets, numbered, GIVEN/WHEN/THEN).
 * Guards against ReDoS and excessively long inputs.
 * @param section - The raw section text.
 * @returns Array of cleaned item strings.
 */
function splitListItems(section: string): string[] {
  const items: string[] = [];
  const truncatedSection = section.slice(0, MAX_SECTION_LINES * MAX_LINE_LENGTH);
  const lines = truncatedSection.split('\n');

  for (const line of lines) {
    const trimmed = line.trim().slice(0, MAX_ITEM_LENGTH);
    if (trimmed.length === 0) continue;

    // Bullet or numbered
    let match = trimmed.match(/^[-*\d]+\.\s+(.*)/);
    if (match) {
      items.push(match[1]);
      continue;
    }
    // GIVEN/WHEN/THEN/AND
    match = trimmed.match(/^(GIVEN|WHEN|THEN|AND)\s+(.*)/i);
    if (match) {
      items.push(match[2]);
      continue;
    }
    // Fallback: whole line
    items.push(trimmed);
  }

  return items
    .map((item) => item.replace(/^[-*\s]+/, '').trim())
    .filter((item) => item.length > 0);
}

/** Cache for compiled glob patterns to avoid repeated regex compilation. */
const globCache = new Map<string, RegExp>();

/**
 * Converts a glob pattern to a RegExp, using a cache to avoid repeated compilation.
 * Throws if pattern is too long to prevent ReDoS.
 * @param glob - Glob pattern (e.g., "src/**\/*.ts").
 * @returns Equivalent RegExp.
 */
function globToRegex(glob: string): RegExp {
  if (glob.length > MAX_GLOB_LENGTH) {
    throw new Error(`Glob pattern too long: ${glob.length} characters (max ${MAX_GLOB_LENGTH})`);
  }
  const cached = globCache.get(glob);
  if (cached) return cached;

  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  let regex: RegExp;
  try {
    regex = new RegExp(`^${regexStr}$`);
  } catch {
    logger.warn(`Invalid glob pattern "${glob}", returning never-matching regex`);
    regex = /(?!)/;
  }
  globCache.set(glob, regex);
  return regex;
}

/**
 * Determines if a string is a valid acceptance criterion.
 * Filters out very short, non-alphabetic, or code-like strings.
 * @param candidate - Potential criterion string.
 * @returns True if it looks like a valid criterion.
 */
function isValidCriterion(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < MIN_CRITERION_LENGTH) return false;
  if (CODE_LINE_START.test(trimmed)) return false;
  const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount / trimmed.length < MIN_ALPHA_RATIO) return false;
  return true;
}

/**
 * Strips markdown links (keeping only the visible text) from a string.
 * @param text - Input text possibly containing markdown links.
 * @returns Cleaned text with links removed.
 */
function stripMarkdownLinks(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/**
 * Extracts acceptance criteria from an issue's body.
 * Uses multiple regex patterns to find the Acceptance Criteria section.
 * @param issueBody - The body text of the issue.
 * @returns Array of cleaned acceptance criteria strings.
 */
export function extractAcceptanceCriteria(issueBody: string): string[] {
  if (!issueBody || typeof issueBody !== 'string') {
    logger.warn('Invalid or missing issue body for acceptance criteria extraction');
    return [];
  }
  const safeBody = issueBody.slice(0, MAX_COMMENT_LENGTH);

  for (const pattern of ACCEPTANCE_PATTERNS) {
    const match = safeBody.match(pattern);
    const section = safeMatchGroup(match);
    if (section) {
      const items = splitListItems(section);
      const criteria = items.filter(isValidCriterion).map((item) => stripMarkdownLinks(item));
      if (criteria.length >= MIN_CRITERIA_COUNT) {
        return criteria;
      }
    }
  }

  // Fallback: search for lines with keywords like "should", "must", etc.
  const fallbackItems: string[] = [];
  const lines = safeBody.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > MIN_CRITERION_LENGTH && FALLBACK_KW.test(trimmed) && !CODE_LINE_START.test(trimmed)) {
      fallbackItems.push(stripMarkdownLinks(trimmed));
    }
  }
  return fallbackItems.slice(0, 50);
}

/**
 * Extracts scope (list of affected files/patterns) from an issue's body.
 * @param issueBody - The body text of the issue.
 * @returns Array of file path strings or patterns listed in the scope section.
 */
export function extractScope(issueBody: string): string[] {
  if (!issueBody || typeof issueBody !== 'string') return [];
  const safeBody = issueBody.slice(0, MAX_COMMENT_LENGTH);

  for (const pattern of SCOPE_PATTERNS) {
    const match = safeBody.match(pattern);
    const section = safeMatchGroup(match);
    if (section) {
      return splitListItems(section).map((item) => stripMarkdownLinks(item));
    }
  }
  return [];
}

/**
 * Detects potentially misleading comments in a PR by checking against defined patterns.
 * @param prComments - Array of comment objects from the PR.
 * @returns Array of misleading comment bodies.
 */
export function detectMisleadingComments(prComments: Array<{ body: string; user?: { login: string } }>): string[] {
  const suspicious: string[] = [];
  if (!prComments || prComments.length === 0) return suspicious;

  for (const comment of prComments) {
    if (!comment.body || typeof comment.body !== 'string') continue;
    const safeBody = comment.body.slice(0, MAX_ITEM_LENGTH);
    for (const pattern of MISLEADING_PATTERNS) {
      if (pattern.test(safeBody)) {
        suspicious.push(safeBody);
        break;
      }
    }
  }

  return suspicious;
}

/**
 * Analyzes changed files against a set of scope patterns to find out-of-scope files.
 * Uses cached glob-to-regex conversion for performance.
 * @param changedFiles - List of file paths that were changed in the PR.
 * @param scopePatterns - List of glob patterns specifying allowed scope.
 * @returns Array of file paths that are out-of-scope.
 */
export function findOutOfScopeFiles(changedFiles: string[], scopePatterns: string[]): string[] {
  if (!changedFiles || changedFiles.length === 0) return [];
  if (!scopePatterns || scopePatterns.length === 0) return [];

  const allowedRegexes: RegExp[] = [];
  for (const pattern of scopePatterns) {
    try {
      allowedRegexes.push(globToRegex(pattern));
    } catch (err) {
      logger.warn(`Invalid scope pattern "${pattern}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (allowedRegexes.length === 0) return [];

  const outOfScope: string[] = [];
  for (const file of changedFiles) {
    const isAllowed = allowedRegexes.some((regex) => regex.test(file));
    if (!isAllowed) {
      outOfScope.push(file);
    }
  }

  return outOfScope;
}

/**
 * Constructs a markdown-formatted review comment for a pull request.
 * Includes acceptance criteria check, out-of-scope file detection, diff summary, suggestions,
 * link to issue if missing, and appends the system prompt in a code block.
 * @param analysis - Analysis result from PR review.
 * @param agentName - Name of the reviewing agent.
 * @param systemPrompt - System prompt to include at the end.
 * @param prNumber - PR number.
 * @returns Formatted comment string.
 */
export function buildReviewComment(
  analysis: AnalysisResult,
  agentName: string,
  systemPrompt: string,
  prNumber: number
): string {
  const lines: string[] = [];

  // Header
  lines.push(`[${agentName}] Review for PR #${prNumber}`);
  lines.push('');

  // Acceptance criteria
  if (analysis.acceptanceCriteria.length > 0) {
    lines.push('**✅ Acceptance Criteria Analysis:**');
    for (let i = 0; i < analysis.acceptanceCriteria.length; i++) {
      lines.push(`- ${analysis.acceptanceCriteria[i]}`);
    }
  } else {
    lines.push('**⚠️  Acceptance Criteria Not Found**');
  }
  lines.push('');

  // Missing issue link
  if (analysis.missingIssueLink) {
    lines.push('**📌 Issue Link Missing:**');
    lines.push('Please link the relevant issue number for this PR (e.g., "Closes #123").');
    lines.push('');
  }

  // Out-of-scope files
  if (analysis.outOfScopeFiles.length > 0) {
    lines.push('**❌ Out-of-Scope Files Detected:**');
    analysis.outOfScopeFiles.forEach((file) => lines.push(`- \`${file}\``));
    lines.push('');
  }

  // Diff summary
  if (analysis.diffSummary) {
    lines.push('**📝 Diff Summary:**');
    lines.push(analysis.diffSummary.slice(0, 2000));
    lines.push('');
  }

  // Suggestions
  if (analysis.suggestions.length > 0) {
    lines.push('**💡 Suggestions for Improvement:**');
    analysis.suggestions.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  // Misleading comments
  if (analysis.misleadingComments.length > 0) {
    lines.push('**⚠️ Potentially Misleading Comments Detected:**');
    analysis.misleadingComments.forEach((c) => lines.push(`> ${c.slice(0, 200)}`));
    lines.push('');
  }

  // System prompt in code block
  lines.push('