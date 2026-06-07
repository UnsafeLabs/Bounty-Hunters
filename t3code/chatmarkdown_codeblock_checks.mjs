import { readFileSync } from "node:fs";

const checks = [
  {
    file: "apps/web/src/components/ChatMarkdown.tsx",
    patterns: [
      "LONG_CODE_BLOCK_LINE_THRESHOLD",
      "LONG_CODE_BLOCK_PREVIEW_LINES",
      "detectFenceLanguage",
      "data-language={language}",
      "chat-markdown-line-numbers",
      "chat-markdown-collapsible-codeblock",
      "Show all",
      "navigator.clipboard",
    ],
  },
  {
    file: "apps/web/src/components/ChatMarkdown.browser.tsx",
    patterns: [
      "auto-detects unlabeled fenced TypeScript code blocks",
      "renders aligned line numbers",
      "collapses long code blocks",
      "copies only the fenced code content",
    ],
  },
  {
    file: "apps/web/src/index.css",
    patterns: [
      "chat-markdown-codeblock-line-height",
      "chat-markdown-line-numbers",
      "chat-markdown-codeblock-summary",
      "transition: max-height 180ms ease",
    ],
  },
  {
    file: "apps/web/src/.audit.json",
    patterns: ["Codex GPT-5", "Public redacted audit metadata only"],
  },
];

for (const check of checks) {
  const source = readFileSync(check.file, "utf8");
  for (const pattern of check.patterns) {
    if (!source.includes(pattern)) {
      throw new Error(`${check.file} is missing ${pattern}`);
    }
  }
}

console.log("t3 ChatMarkdown code block checks passed");
