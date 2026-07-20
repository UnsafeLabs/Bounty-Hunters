/**
 * Fuzzy search with scoring and match highlighting for CommandPalette (#830).
 */

export interface FuzzyResult {
  text: string;
  score: number;
  indices: number[]; // matched character indices
  highlighted: string; // HTML with <span class="fuzzy-match">
}

/**
 * Character-by-character fuzzy match allowing gaps.
 * Scores: consecutive > word-boundary > base; shorter text preferred.
 */
export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  if (!query) {
    return { text, score: 0, indices: [], highlighted: escapeHtml(text) };
  }
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  const indices: number[] = [];
  let consecutive = 0;
  let score = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      indices.push(i);
      consecutive += 1;
      score += 10 + consecutive * 5;
      // word boundary bonus
      if (i === 0 || /[\s\-_/]/.test(text[i - 1]!)) score += 15;
      qi += 1;
    } else {
      consecutive = 0;
    }
  }
  if (qi < q.length) return null;
  // shorter commands score higher
  score += Math.max(0, 40 - text.length);
  return {
    text,
    score,
    indices,
    highlighted: highlightIndices(text, indices),
  };
}

export function fuzzyFilter(query: string, commands: string[]): FuzzyResult[] {
  if (!query) {
    return commands.map((text) => ({
      text,
      score: 0,
      indices: [],
      highlighted: escapeHtml(text),
    }));
  }
  const out: FuzzyResult[] = [];
  for (const c of commands) {
    const m = fuzzyMatch(query, c);
    if (m) out.push(m);
  }
  out.sort((a, b) => b.score - a.score || a.text.localeCompare(b.text));
  return out;
}

function highlightIndices(text: string, indices: number[]): string {
  const set = new Set(indices);
  let html = "";
  for (let i = 0; i < text.length; i++) {
    const ch = escapeHtml(text[i]!);
    if (set.has(i)) html += `<span class="fuzzy-match">${ch}</span>`;
    else html += ch;
  }
  return html;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
