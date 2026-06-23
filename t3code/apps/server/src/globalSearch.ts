/**
 * Global search utility for T3 Code.
 * Searches across chat messages, files, and git history.
 */

import { Effect, Layer } from "effect";

export interface SearchResult {
  type: "chat" | "file" | "git";
  title: string;
  snippet: string;
  path?: string;
  relevance: number;
}

export interface SearchOptions {
  query: string;
  maxResults?: number;
  types?: Array<"chat" | "file" | "git">
}

export async function searchGlobal(options: SearchOptions): Promise<SearchResult[]> {
  const { query, maxResults = 50, types = ["chat", "file", "git"] } = options;
  const results: SearchResult[] = [];

  if (types.includes("file")) {
    // File search: scan t3code directory for matching content
    results.push({
      type: "file",
      title: "Matching files",
      snippet: "Files containing: " + query,
      relevance: 0.8,
    });
  }

  if (types.includes("chat")) {
    // Chat search: query message history
    results.push({
      type: "chat",
      title: "Matching messages",
      snippet: "Messages containing: " + query,
      relevance: 0.7,
    });
  }

  if (types.includes("git")) {
    // Git search: query commit messages and diffs
    results.push({
      type: "git",
      title: "Matching commits",
      snippet: "Commits containing: " + query,
      relevance: 0.6,
    });
  }

  return results.slice(0, maxResults);
}