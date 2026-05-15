export interface CodeBlockMeta {
  readonly language: string | null;
  readonly lineCount: number;
  readonly shouldCollapse: boolean;
  readonly collapsedLines: number;
}

const COLLAPSE_THRESHOLD = 20;
const COLLAPSED_PREVIEW_LINES = 10;

export function parseCodeBlockMeta(code: string, language: string | null): CodeBlockMeta {
  const lines = code.split("\n");
  const lineCount = lines.length;
  const shouldCollapse = lineCount > COLLAPSE_THRESHOLD;

  return {
    language,
    lineCount,
    shouldCollapse,
    collapsedLines: shouldCollapse ? COLLAPSED_PREVIEW_LINES : lineCount,
  };
}

export function detectLanguage(code: string, hint: string | null): string | null {
  if (hint && hint.trim().length > 0) {
    return hint.trim().toLowerCase();
  }

  if (/^import\s/.test(code) && /from\s+['"]/.test(code)) return "typescript";
  if (/^def\s|class\s.*:\s*$|import\s+\w+/.test(code)) return "python";
  if (/^<\?php/.test(code)) return "php";
  if (/^package\s/.test(code) && /func\s/.test(code)) return "go";
  if (/^#include/.test(code) && /int\s+main/.test(code)) return "c";
  if (/^\s*<([a-z][a-z0-9]*)/.test(code)) return "html";
  if (/^\s*\{[\s\S]*"[a-z]+"/.test(code)) return "json";
  if (/^SELECT|^INSERT|^UPDATE|^DELETE|^CREATE/i.test(code.trim())) return "sql";

  return null;
}

export function shouldShowCopyButton(code: string): boolean {
  return code.trim().length > 0;
}

export function getCollapsedPreview(code: string): string {
  const lines = code.split("\n");
  return lines.slice(0, COLLAPSED_PREVIEW_LINES).join("\n");
}

export function addLineNumbers(code: string): string {
  const lines = code.split("\n");
  const width = String(lines.length).length;

  return lines
    .map((line, i) => String(i + 1).padStart(width) + "  " + line)
    .join("\n");
}

export function isInlineCode(text: string): boolean {
  return !text.includes("\n") && text.startsWith("`") && text.endsWith("`");
}
