```diff
--- /dev/null
+++ b/t3code/apps/web/src/components/GlobalSearch.tsx
@@ -0,0 +1,689 @@
+import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
+import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
+
+// ============================================================================
+// TYPES
+// ============================================================================
+
+interface SearchResultBase {
+  id: string;
+  type: 'chat' | 'file' | 'git';
+  score: number;
+}
+
+interface ChatResult extends SearchResultBase {
+  type: 'chat';
+  messageId: string;
+  content: string;
+  threadId: string;
+  threadName: string;
+  author: string;
+  timestamp: string;
+}
+
+interface FileResult extends SearchResultBase {
+  type: 'file';
+  fileName: string;
+  filePath: string;
+  lineNumber: number;
+  lineContent: string;
+  fullContent?: string;
+}
+
+interface GitResult extends SearchResultBase {
+  type: 'git';
+  commitHash: string;
+  message: string;
+  author: string;
+  date: string;
+  branch?: string;
+}
+
+type SearchResult = ChatResult | FileResult | GitResult;
+
+interface SearchFilters {
+  regex: boolean;
+  caseSensitive: boolean;
+}
+
+interface SearchResponse {
+  results: SearchResult[];
+  nextCursor?: string;
+  hasMore: boolean;
+}
+
+// ============================================================================
+// MOCK API - In a real app, these would be actual API calls
+// ============================================================================
+
+const mockChatMessages = [
+  { id: 'msg1', threadId: 'thread1', threadName: 'General', content: 'Welcome to the team! Let me know if you need help with anything.', author: 'Alice', timestamp: '2024-01-15T10:00:00Z' },
+  { id: 'msg2', threadId: 'thread1', threadName: 'General', content: 'Has anyone seen the latest deployment docs?', author: 'Bob', timestamp: '2024-01-15T10:05:00Z' },
+  { id: 'msg3', threadId: 'thread2', threadName: 'Frontend', content: 'The new React Query implementation is working great.', author: 'Charlie', timestamp: '2024-01-15T11:00:00Z' },
+  { id: 'msg4', threadId: 'thread2', threadName: 'Frontend', content: 'We should update the component library soon.', author: 'Diana', timestamp: '2024-01-15T11:30:00Z' },
+  { id: 'msg5', threadId: 'thread3', threadName: 'Backend', content: 'The API rate limiting is now in production.', author: 'Eve', timestamp: '2024-01-15T12:00:00Z' },
+  { id: 'msg6', threadId: 'thread3', threadName: 'Backend', content: 'Database migration completed successfully.', author: 'Frank', timestamp: '2024-01-15T12:30:00Z' },
+  { id: 'msg7', threadId: 'thread1', threadName: 'General', content: 'Great work on the search feature everyone!', author: 'Alice', timestamp: '2024-01-15T13:00:00Z' },
+  { id: 'msg8', threadId: 'thread4', threadName: 'Design', content: 'The new mockups are ready for review.', author: 'Grace', timestamp: '2024-01-15T14:00:00Z' },
+];
+
+const mockFiles = [
+  { id: 'file1', name: 'README.md', path: '/README.md', content: '# Project README\n\nThis is the main project documentation.\n\n## Getting Started\n\nRun `npm install` to get started.' },
+  { id: 'file2', name: 'package.json', path: '/package.json', content: '{\n  "name": "web-app",\n  "version": "1.0.0",\n  "dependencies": {\n    "react": "^18.0.0",\n    "react-query": "^3.0.0"\n  }\n}' },
+  { id: 'file3', name: 'GlobalSearch.tsx', path: '/src/components/GlobalSearch.tsx', content: 'import React from "react";\n\nexport function GlobalSearch() {\n  return <div>Search</div>;\n}' },
+  { id: 'file4', name: 'utils.ts', path: '/src/lib/utils.ts', content: 'export function cn(...classes: string[]) {\n  return classes.filter(Boolean).join(" ");\n}' },
+  { id: 'file5', name: 'api.ts', path: '/src/lib/api.ts', content: 'export async function fetchData(url: string) {\n  const response = await fetch(url);\n  return response.json();\n}' },
+];
+
+const mockGitCommits = [
+  { id: 'git1', hash: 'abc1234', message: 'feat: implement global search component', author: 'Alice', date: '2024-01-15T09:00:00Z', branch: 'main' },
+  { id: 'git2', hash: 'def5678', message: 'fix: resolve memory leak in chat component', author: 'Bob', date: '2024-01-14T16:00:00Z', branch: 'main' },
+  { id: 'git3', hash: 'ghi9012', message: 'docs: update API documentation', author: 'Charlie', date: '2024-01-14T10:00:00Z', branch: 'feature/docs' },
+  { id: 'git4', hash: 'jkl3456', message: 'refactor: simplify file search logic', author: 'Diana', date: '2024-01-13T14:00:00Z', branch: 'main' },
+  { id: 'git5', hash: 'mno7890', message: 'test: add unit tests for search utils', author: 'Eve', date: '2024-01-12T11:00:00Z', branch: 'feature/search-tests' },
+];
+
+// ============================================================================
+// SEARCH UTILITIES
+// ============================================================================
+
+function createSearchRegex(query: string, filters: SearchFilters): RegExp | null {
+  if (!query.trim()) return null;
+  
+  try {
+    if (filters.regex) {
