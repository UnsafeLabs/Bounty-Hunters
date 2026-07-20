/**
 * Syntax highlighting helpers, copy, collapse for ChatMarkdown (issue #837).
 * Lightweight highlighter (no heavy Shiki install required).
 */

export const COLLAPSE_LINE_THRESHOLD = 20;
export const COLLAPSE_PREVIEW_LINES = 10;

export interface CodeBlockModel {
  language: string | null;
  code: string;
  lines: string[];
  collapsed: boolean;
  highlightedHtml: string;
}

const KEYWORDS: Record<string, string[]> = {
  ts: ["const", "let", "function", "return", "import", "export", "from", "async", "await", "class", "interface", "type"],
  js: ["const", "let", "function", "return", "import", "export", "from", "async", "await", "class"],
  py: ["def", "return", "import", "from", "class", "async", "await", "if", "else", "for", "in"],
  rs: ["fn", "let", "mut", "return", "use", "struct", "impl", "pub", "async", "await"],
};

export function detectLanguage(code: string, hint?: string | null): string | null {
  if (hint && hint.trim()) return normalizeLang(hint);
  if (/^\s*import\s+.*from\s+['"]/.test(code) || /:\s*(string|number|boolean)\b/.test(code)) return "ts";
  if (/^\s*def\s+\w+\(/.test(code) || /^\s*from\s+\w+\s+import/.test(code)) return "py";
  if (/^\s*fn\s+\w+/.test(code) || /let\s+mut\s+/.test(code)) return "rs";
  if (/^\s*(const|let|function)\s+/.test(code)) return "js";
  return null;
}

function normalizeLang(hint: string): string {
  const h = hint.toLowerCase().trim();
  if (h === "typescript" || h === "tsx") return "ts";
  if (h === "javascript" || h === "jsx") return "js";
  if (h === "python") return "py";
  if (h === "rust") return "rs";
  return h;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Minimal token highlighter for keywords + strings + comments. */
export function highlightCode(code: string, language: string | null): string {
  const lang = language ?? "txt";
  const kws = KEYWORDS[lang] ?? [];
  const lines = code.split("\n");
  return lines
    .map((line, i) => {
      let html = escapeHtml(line);
      // comments
      html = html.replace(/(\/\/.*$|#.*$)/, '<span class="tok-comment">$1</span>');
      // strings
      html = html.replace(
        /(&quot;[^&]*&quot;|&#39;[^&]*&#39;|'[^']*'|&quot;.*?&quot;)/g,
        (m) => `<span class="tok-string">${m}</span>`,
      );
      // simpler string pass on original-escaped content
      html = html.replace(/(&quot;.*?&quot;)/g, '<span class="tok-string">$1</span>');
      for (const kw of kws) {
        const re = new RegExp(`\\b(${kw})\\b`, "g");
        html = html.replace(re, '<span class="tok-kw">$1</span>');
      }
      return `<span class="line" data-line="${i + 1}">${html || " "}</span>`;
    })
    .join("\n");
}

export function buildCodeBlock(code: string, languageHint?: string | null): CodeBlockModel {
  const language = detectLanguage(code, languageHint);
  const lines = code.replace(/\n$/, "").split("\n");
  const collapsed = lines.length > COLLAPSE_LINE_THRESHOLD;
  const displayCode = collapsed
    ? lines.slice(0, COLLAPSE_PREVIEW_LINES).join("\n")
    : code;
  return {
    language,
    code,
    lines,
    collapsed,
    highlightedHtml: highlightCode(collapsed ? displayCode : code, language),
  };
}

export function expandCodeBlock(model: CodeBlockModel): CodeBlockModel {
  return {
    ...model,
    collapsed: false,
    highlightedHtml: highlightCode(model.code, model.language),
  };
}

export function copyPayload(model: CodeBlockModel): string {
  return model.code;
}

/** CSS counter-friendly line number styles (string for injection). */
export const LINE_NUMBER_CSS = `
.code-block { counter-reset: line; }
.code-block .line { counter-increment: line; display: block; }
.code-block .line::before {
  content: counter(line);
  display: inline-block;
  width: 2.5em;
  margin-right: 1em;
  text-align: right;
  opacity: 0.5;
  user-select: none;
}
`;
