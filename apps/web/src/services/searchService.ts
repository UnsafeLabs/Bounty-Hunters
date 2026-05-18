/**
 * @file apps/web/src/services/searchService.ts
 * @description Service layer for global search across chat, files, and git history.
 */

const SEARCH_API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api/search';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SearchParams {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  page?: number;
  limit?: number;
}

export interface ChatMessageResult {
  id: string;
  threadId: string;
  threadName: string;
  content: string;
  createdAt: string;
  author: string;
  matchedTerms: string[];
}

export interface FileResult {
  path: string;
  fileName: string;
  lineNumber: number;
  content: string;
  matchedTerms: string[];
}

export interface GitCommitResult {
  hash: string;
  message: string;
  author: string;
  date: string;
  matchedTerms: string[];
}

export interface SearchResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface MergedSearchResult {
  chat: SearchResponse<ChatMessageResult>;
  files: SearchResponse<FileResult>;
  git: SearchResponse<GitCommitResult>;
}

// ---------------------------------------------------------------------------
// Helper: Fetch wrapper with error handling
// ---------------------------------------------------------------------------

async function fetchSearch<T>(
  endpoint: string,
  params: SearchParams,
): Promise<SearchResponse<T>> {
  const url = new URL(`${SEARCH_API_BASE}${endpoint}`);
  url.searchParams.set('query', params.query);
  if (params.regex) url.searchParams.set('regex', 'true');
  if (params.caseSensitive) url.searchParams.set('caseSensitive', 'true');
  if (params.page !== undefined) url.searchParams.set('page', String(params.page));
  if (params.limit !== undefined) url.searchParams.set('limit', String(params.limit));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    console.error(
      `[searchService] ${endpoint} failed: ${response.status} ${response.statusText}`,
      errorBody,
    );
    throw new Error(`Search API error (${response.status}): ${response.statusText}`);
  }

  return response.json() as Promise<SearchResponse<T>>;
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

/**
 * Searches chat messages by content.
 * @param params - Search parameters including query, regex, case sensitivity, pagination.
 * @returns Paginated search results containing chat messages.
 * @throws If the API request fails.
 */
export async function searchChatMessages(
  params: SearchParams,
): Promise<SearchResponse<ChatMessageResult>> {
  console.debug('[searchService] searchChatMessages called', params);
  return fetchSearch<ChatMessageResult>('/chat', params);
}

/**
 * Searches files by name and content.
 * @param params - Search parameters including query, regex, case sensitivity, pagination.
 * @returns Paginated search results containing file matches with line numbers.
 * @throws If the API request fails.
 */
export async function searchFiles(
  params: SearchParams,
): Promise<SearchResponse<FileResult>> {
  console.debug('[searchService] searchFiles called', params);
  return fetchSearch<FileResult>('/files', params);
}

/**
 * Searches git commit messages.
 * @param params - Search parameters including query, regex, case sensitivity, pagination.
 * @returns Paginated search results containing commit information.
 * @throws If the API request fails.
 */
export async function searchGitCommits(
  params: SearchParams,
): Promise<SearchResponse<GitCommitResult>> {
  console.debug('[searchService] searchGitCommits called', params);
  return fetchSearch<GitCommitResult>('/git', params);
}

/**
 * Orchestrates parallel search requests across all sources and merges results.
 * Falls back to empty results per source if a particular service fails.
 * @param params - Search parameters.
 * @returns Merged search result containing responses from all three services.
 */
export async function searchAll(params: SearchParams): Promise<MergedSearchResult> {
  console.debug('[searchService] searchAll called', params);

  const [chatResult, filesResult, gitResult] = await Promise.allSettled([
    searchChatMessages(params),
    searchFiles(params),
    searchGitCommits(params),
  ]);

  const emptyResponse: SearchResponse<never> = {
    data: [],
    total: 0,
    page: params.page ?? 1,
    limit: params.limit ?? 20,
    hasMore: false,
  };

  const merged: MergedSearchResult = {
    chat: chatResult.status === 'fulfilled' ? chatResult.value : emptyResponse,
    files: filesResult.status === 'fulfilled' ? filesResult.value : emptyResponse,
    git: gitResult.status === 'fulfilled' ? gitResult.value : emptyResponse,
  };

  // Log individual failures
  if (chatResult.status === 'rejected') {
    console.error('[searchService] searchChatMessages failed:', chatResult.reason);
  }
  if (filesResult.status === 'rejected') {
    console.error('[searchService] searchFiles failed:', filesResult.reason);
  }
  if (gitResult.status === 'rejected') {
    console.error('[searchService] searchGitCommits failed:', gitResult.reason);
  }

  return merged;
}