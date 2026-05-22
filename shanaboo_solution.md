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
+  { id: 'msg1', threadId: 'thread1', threadName: 'General', content: 'Hey everyone, welcome to the project!', author: 'Alice', timestamp: '2024-01-15T10:00:00Z' },
+  { id: 'msg2', threadId: 'thread1', threadName: 'General', content: 'Thanks Alice, excited to be here', author: 'Bob', timestamp: '2024-01-15T10:05:00Z' },
+  { id: 'msg3', threadId: 'thread2', threadName: 'Development', content: 'Has anyone reviewed the latest PR?', author: 'Charlie', timestamp: '2024-01-15T11:00:00Z' },
+  { id: 'msg4', threadId: 'thread2', threadName: 'Development', content: 'I\'m working on the authentication module now', author: 'Diana', timestamp: '2024-01-15T11:30:00Z' },
+  { id: 'msg5', threadId: 'thread3', threadName: 'Design', content: 'The new mockups are ready for review', author: 'Eve', timestamp: '2024-01-15T12:00:00Z' },
+  { id: 'msg6', threadId: 'thread1', threadName: 'General', content: 'Great work on the search feature implementation', author: 'Frank', timestamp: '2024-01-15T13:00:00Z' },
+  { id: 'msg7', threadId: 'thread2', threadName: 'Development', content: 'We need to fix the bug in the login flow', author: 'Grace', timestamp: '2024-01-15T14:00:00Z' },
+  { id: 'msg8', threadId: 'thread4', threadName: 'Random', content: 'Anyone up for coffee?', author: 'Henry', timestamp: '2024-01-15T15:00:00Z' },
+];
+
+const mockFiles = [
+  { name: 'README.md', path: 'README.md', content: '# Project\n\nThis is the main project README.\n\n## Getting Started\n\nRun `npm install` to get started.' },
+  { name: 'package.json', path: 'package.json', content: '{\n  "name": "project",\n  "version": "1.0.0",\n  "dependencies": {}\n}' },
+  { name: 'src/index.ts', path: 'src/index.ts', content: 'import { App } from "./App";\n\nconst app = new App();\napp.start();' },
+  { name: 'src/utils/search.ts', path: 'src/utils/search.ts', content: 'export function search(query: string): Result[] {\n  // Search implementation\n  return [];\n}' },
+  { name: 'src/components/Button.tsx', path: 'src/components/Button.tsx', content: 'import React from "react";\n\nexport function Button({ label }: { label: string }) {\n  return <button>{label}</button>;\n}' },
+];
+
+const mockGitCommits = [
+  { hash: 'abc1234', message: 'Initial commit', author: 'Alice', date: '2024-01-10T09:00:00Z', branch: 'main' },
+  { hash: 'def5678', message: 'Add authentication module', author: 'Bob', date: '2024-01-11T10:00:00Z', branch: 'main' },
+  { hash: 'ghi9012', message: 'Fix bug in search functionality', author: 'Charlie', date: '2024-01-12T11:00:00Z', branch: 'feature/search' },
+  { hash: 'jkl3456', message: 'Update README with setup instructions', author: 'Diana', date: '2024-01-13T12:00:00Z', branch: 'main' },
+  { hash: 'mno7890', message: 'Refactor chat components', author: 'Eve', date: '2024-01-14T13:00:00Z', branch: 'feature/chat' },
+  { hash: 'pqr1234', message: 'Implement global search feature', author: 'Frank', date: '2024-01-15T14:00:00Z', branch: 'feature/global-search' },
+  { hash: 'stu5678', message: 'Add tests for search module', author: 'Grace', date: '2024-01-16T15:00:00Z', branch: 'main' },
+];
+
+// ============================================================================
+// SEARCH API
+// ============================================================================
+
+async function searchChat(query: string, filters: SearchFilters, cursor?: string): Promise<SearchResponse> {
+  const pageSize = 5;
+  const startIndex = cursor ? parseInt(cursor, 10) : 0;
+  
+  const