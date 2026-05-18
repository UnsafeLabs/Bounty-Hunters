/**
 * Type definitions for the global search feature.
 * Defines the shape of search results from chat, file, and git sources,
 * as well as filters, groups, and related utility types.
 */

/** Supported search source types */
export enum SearchSource {
  Chat = 'chat',
  File = 'file',
  Git = 'git',
}

/** Base result metadata shared by all result types */
export interface SearchResultMeta {
  /** Relevance score (higher = more relevant) */
  score: number;
  /** Source type this result belongs to */
  source: SearchSource;
  /** Unique identifier within its source */
  id: string;
}

/** A single chat message search result */
export interface ChatResult extends SearchResultMeta {
  source: SearchSource.Chat;
  /** Full content of the message */
  message: string;
  /** ID of the thread/conversation this message belongs to */
  threadId: string;
  /** Optional thread title */
  threadTitle?: string;
  /** Display name of the message author */
  author: string;
  /** ISO-8601 timestamp of the message */
  timestamp: string;
  /** Matched snippet with highlights (server-rendered or client-generated) */
  preview: string;
}

/** A single file search result (matches file name or content line) */
export interface FileResult extends SearchResultMeta {
  source: SearchSource.File;
  /** Full file path relative to project root */
  filePath: string;
  /** File name (last segment of path) */
  fileName: string;
  /** Type of match: 'name' or 'content' */
  matchType: 'name' | 'content';
  /** Line number where the match was found (only for content matches) */
  lineNumber?: number;
  /** Content line text (only for content matches) */
  lineContent?: string;
  /** Preview snippet highlighting the match */
  preview: string;
}

/** A single git commit search result */
export interface GitResult extends SearchResultMeta {
  source: SearchSource.Git;
  /** Commit hash (full or short) */
  commitHash: string;
  /** Commit message */
  message: string;
  /** Author display name */
  author: string;
  /** Author email */
  authorEmail: string;
  /** ISO-8601 timestamp of the commit */
  timestamp: string;
  /** Optional branch name */
  branch?: string;
  /** Preview snippet with highlighted match */
  preview: string;
}

/** Union of all possible result types */
export type SearchResultItem = ChatResult | FileResult | GitResult;

/** Group of results from a single source, with counts */
export interface SearchResultGroup {
  /** Source type for this group */
  source: SearchSource;
  /** Display label (e.g., "Chat Messages", "Files", "Git Commits") */
  label: string;
  /** Total number of results in this group (for pagination) */
  total: number;
  /** Array of results for current page */
  results: SearchResultItem[];
}

/** Parameters that control search behaviour */
export interface SearchFilters {
  /** Enable regex mode (default: false) */
  regex?: boolean;
  /** Enable case-sensitive matching (default: false) */
  caseSensitive?: boolean;
  /** Maximum results per source per page (default: 20) */
  perPage?: number;
}

/** State for the global search hook */
export interface SearchState {
  /** Current search query string */
  query: string;
  /** Active filters */
  filters: SearchFilters;
  /** Whether a search is currently in flight */
  isLoading: boolean;
  /** Error message if the last search failed (null if success) */
  error: string | null;
  /** Combined results grouped by source */
  groups: SearchResultGroup[];
  /** Whether all pages have been loaded for all sources */
  hasNextPage: boolean;
}

/** Input for a single source search request */
export interface SearchRequest {
  query: string;
  filters: SearchFilters;
  /** Cursor for pagination (opaque string, may be und) */
  cursor?: string;
}

/** Response from a single source search endpoint */
export interface SearchSourceResponse<T extends SearchResultItem> {
  results: T[];
  /** Total number of results available (for count display) */
  total: number;
  /** Cursor for the next page (null if no more) */
  nextCursor: string | null;
}