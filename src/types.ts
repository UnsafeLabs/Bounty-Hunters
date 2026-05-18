typescript
/**
 * Represents a pull request fetched from the GitHub API.
 */
export interface PullRequest {
  /** Repository owner */
  repoOwner: string;
  /** Repository name */
  repoName: string;
  /** Pull request number */
  number: number;
  /** PR title */
  title: string;
  /** PR body markdown */
  body: string | null;
  /** Current state */
  state: 'open' | 'closed' | 'merged';
  /** Author login */
  author: string;
  /** URL to the PR on GitHub */
  url: string;
  /** SHA of the head branch commit */
  headSha: string;
  /** SHA of the base branch commit */
  baseSha: string;
  /** List of issue numbers referenced in the PR body (e.g. closes #123) */
  linkedIssueNumbers: number[];
  /** ISO date string of creation */
  createdAt: string;
  /** ISO date string of last update */
  updatedAt: string;
}

/**
 * Represents a GitHub issue used as acceptance criteria reference.
 */
export interface Issue {
  /** Repository owner */
  repoOwner: string;
  /** Repository name */
  repoName: string;
  /** Issue number */
  number: number;
  /** Issue title */
  title: string;
  /** Issue body markdown */
  body: string | null;
  /** Current state */
  state: 'open' | 'closed';
  /** Labels attached to the issue */
  labels: string[];
  /** ISO date string of creation */
  createdAt: string;
  /** ISO date string of last update */
  updatedAt: string;
}

/**
 * Represents a changed file within a pull request.
 */
export interface ChangedFile {
  /** File path relative to repository root */
  filename: string;
  /** Status: added, modified, removed, renamed, copied, changed, unchanged */
  status: string;
  /** Number of additions */
  additions: number;
  /** Number of deletions */
  deletions: number;
  /** Number of changes */
  changes: number;
  /** Raw unified diff text */
  patch: string | null;
  /** Previous filename if renamed */
  previous_filename?: string;
}

/**
 * Represents a single code change entry (hunk) within a file diff.
 */
export interface DiffHunk {
  /** The original file line start */
  oldStart: number;
  /** The number of lines in original file */
  oldLines: number;
  /** The new file line start */
  newStart: number;
  /** The number of lines in new file */
  newLines: number;
  /** The diff hunk content (unified format lines) */
  content: string;
}

/**
 * Contains parsed acceptance criteria from a linked issue.
 */
export interface AcceptanceCriteria {
  /** Issue number this criteria belongs to */
  issueNumber: number;
  /** List of individual acceptance criteria items extracted from issue body */
  items: string[];
  /** Whether the issue was found and parsed successfully */
  valid: boolean;
}

/**
 * The result of analyzing a pull request against its linked issue.
 */
export interface AnalysisResult {
  /** The analyzed pull request */
  pullRequest: PullRequest;
  /** Linked issue if found, otherwise null */
  linkedIssue: Issue | null;
  /** Acceptance criteria parsed from the linked issue */
  acceptanceCriteria: AcceptanceCriteria;
  /** Files changed in the PR */
  changedFiles: ChangedFile[];
  /** Files that are considered out of scope of the linked issue */
  outOfScopeFiles: ChangedFile[];
  /** Whether the PR has a linked issue */
  hasLinkedIssue: boolean;
  /** Whether all changed files are considered in scope */
  allFilesInScope: boolean;
  /** Generated suggestions for improvement (populated after analysis) */
  suggestions?: Suggestion[];
  /** Review comment that was or will be posted (populated after comment generation) */
  reviewComment?: ReviewComment;
  /** Any errors encountered during analysis */
  errors: string[];
}

/**
 * Configuration for review comment format.
 */
export interface ReviewConfig {
  /** Name of the AI agent/tool (e.g. [Claude Code]) */
  agentName: string;
  /** System prompt to include at the end of each comment (as code block) */
  systemPrompt: string;
}

/**
 * Represents a review comment to be posted on a pull request.
 */
export interface ReviewComment {
  /** Pull request number */
  prNumber: number;
  /** The body text of the review comment */
  body: string;
  /** Repository owner */
  repoOwner: string;
  /** Repository name */
  repoName: string;
  /** ID of the posted comment (populated after posting) */
  commentId: number | null;
  /** Timestamp when the comment was posted */
  postedAt: Date | null;
}

/**
 * Result of posting a review comment back to the pull request.
 */
export interface PostCommentResult {
  /** Whether the comment was posted successfully */
  success: boolean;
  /** ID of the posted comment if successful */
  commentId: number | null;
  /** Error details if posting failed */
  error: string | null;
}

/**
 * Configuration loaded from environment variables or a .env file.
 */
export interface AppConfig {
  /** GitHub personal access token */
  githubToken: string;
  /** OpenAI API key */
  openaiApiKey: string;
  /** Repository owner (user or org) */
  repoOwner: string;
  /** Repository name */
  repoName: string;
  /** Agent name for review comment header */
  agentName: string;
  /** System prompt for LLM-based comment generation */
  systemPrompt: string;
  /** OpenAI model identifier (e.g. gpt-4) */
  openaiModel: string;
  /** Maximum number of retry attempts for API calls */
  maxRetries: number;
  /** Base delay for exponential backoff (ms) */
  retryBaseDelayMs: number;
}

/**
 * Generic wrapper for paginated API responses.
 */
export interface PaginatedResponse<T> {
  /** List of items in the current page */
  items: T[];
  /** Whether there are more pages */
  hasMore: boolean;
  /** URL to the next page, if any */
  nextPageUrl: string | null;
}

/**
 * Represents a code review suggestion generated by the AI.
 */
export interface Suggestion {
  /** File path the suggestion applies to */
  file: string;
  /** Starting line number in the new file */
  line: number;
  /** Description of the suggestion */
  description: string;
  /** Severity: critical, warning, info */
  severity: 'critical' | 'warning' | 'info';
  /** Suggested fix code or explanation */
  suggestedFix: string;
}

/**
 * Represents a review comment body structure before formatting.
 */
export interface ReviewCommentBody {
  /** Agent header */
  header: string;
  /** Section summarizing what looks correct */
  correctParts: string;
  /** Section detailing what needs improvement */
  improvementNeeds: string[];
  /** List of specific suggestions */
  suggestions: Suggestion[];
  /** Flag for missing linked issue */
  missingIssue: boolean;
  /** Flag for out-of-scope files */
  outOfScopeFlag: boolean;
  /** Out-of-scope file list */
  outOfScopeFiles: string[];
  /** Flag indicating misleading review comments from others */
  misleadingFlag: boolean;
  /** System prompt to include */
  systemPrompt: string;
}