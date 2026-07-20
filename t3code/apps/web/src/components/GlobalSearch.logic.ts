/**
 * Global search across chat, files, git (issue #860).
 */

export type SearchSource = "chat" | "file" | "git";

export interface SearchHit {
  source: SearchSource;
  id: string;
  title: string;
  preview: string;
  highlightedPreview: string;
  meta?: Record<string, string>;
  score: number;
}

export interface SearchDocument {
  source: SearchSource;
  id: string;
  title: string;
  body: string;
  meta?: Record<string, string>;
}

export interface SearchOptions {
  regex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildMatcher(
  query: string,
  options: SearchOptions = {},
): { ok: true; test: (text: string) => boolean; highlight: (text: string) => string } | { ok: false; error: string } {
  const q = query;
  if (!q) {
    return {
      ok: true,
      test: () => false,
      highlight: (t) => t,
    };
  }
  try {
    const flags = options.caseSensitive ? "g" : "gi";
    const re = options.regex ? new RegExp(q, flags) : new RegExp(escapeRegExp(q), flags);
    return {
      ok: true,
      test: (text: string) => re.test(text) && ((re.lastIndex = 0), true),
      highlight: (text: string) => {
        re.lastIndex = 0;
        return text.replace(re, (m) => `<mark>${m}</mark>`);
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "invalid regex" };
  }
}

export function searchDocuments(
  docs: SearchDocument[],
  query: string,
  options: SearchOptions = {},
): { hits: SearchHit[]; error?: string; groups: Record<SearchSource, SearchHit[]> } {
  if (!query) {
    return { hits: [], groups: { chat: [], file: [], git: [] } };
  }
  const m = buildMatcher(query, options);
  if (!m.ok) {
    return { hits: [], error: m.error, groups: { chat: [], file: [], git: [] } };
  }
  const hits: SearchHit[] = [];
  for (const d of docs) {
    const hay = `${d.title}\n${d.body}`;
    if (!m.test(hay)) continue;
    const preview = d.body.slice(0, 160);
    hits.push({
      source: d.source,
      id: d.id,
      title: d.title,
      preview,
      highlightedPreview: m.highlight(preview),
      meta: d.meta,
      score: scoreMatch(hay, query, options),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  const limit = options.limit ?? 50;
  const limited = hits.slice(0, limit);
  const groups: Record<SearchSource, SearchHit[]> = { chat: [], file: [], git: [] };
  for (const h of limited) groups[h.source].push(h);
  return { hits: limited, groups };
}

function scoreMatch(text: string, query: string, options: SearchOptions): number {
  const t = options.caseSensitive ? text : text.toLowerCase();
  const q = options.caseSensitive ? query : query.toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50 + Math.max(0, 20 - t.indexOf(q));
  return 10;
}

/** Progressive page for infinite scroll. */
export function pageHits(hits: SearchHit[], page: number, pageSize = 20): SearchHit[] {
  const start = page * pageSize;
  return hits.slice(start, start + pageSize);
}

export const GLOBAL_SEARCH_SHORTCUT = { key: "f", ctrl: true, shift: true };
