import React, { useState, useMemo, useEffect } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";

interface CodeBlockProps {
  language?: string;
  code: string;
}
function CodeBlock({ language, code }: CodeBlockProps) {
  const [collapsed, setCollapsed] = useState(code.split("/\n/").length > 20);
  const [copied, setCopied] = useState(false);
  const detectedLang = language || autoDetect(code);
  const html = useMemo(() => {
    const grammar = Prism.languages[detectedLang] || Prism.languages.plaintext;
    return Prism.highlight(code, grammar, detectedLang);
  }, [code, detectedLang]);
  const lines = code.split("/\n/");
  const displayLines = collapsed ? lines.slice(0, 10) : lines;
  const copyText = () => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div className="code-block relative group">
      <button onClick={copyText} className="copy-btn opacity-0 group-hover:opacity-100">
        {copied ? "Copied!" : "Copy"}
      </button>
      <pre className="!bg-gray-900 !p-4 !rounded-lg !overflow-x-auto">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
      {lines.length > 20 && (
        <button onClick={() => setCollapsed(!collapsed)} className="expand-btn">
          {collapsed ? `Show all ${lines.length} lines` : "Collapse"}
        </button>
      )}
    </div>
  );
}
function autoDetect(code: string): string {
  if (/^\s*</.test(code)) return "html";
  if (/\bfn\b|\blet\b|\bconst\b/.test(code)) return "typescript";
  if (/\bdef\b|\bimport\b/.test(code)) return "python";
  if (/^[{[]/.test(code)) return "json";
  return "plaintext";
}
export function ChatMarkdown({ content }: { content: string }) {
  const [blocks, setBlocks] = useState<{ language?: string; code: string }[]>([]);
  useEffect(() => { const parts = content.split(/(```(\w*)/\n([\s\S]*?)```)/g);
    const result: { language?: string; code: string }[] = [];
    for (let i = 0; i < parts.length; i += 4) {
      if (parts[i + 2] && parts[i + 3]) result.push({ language: parts[i + 2] || undefined, code: parts[i + 3].trim() });
    }
    setBlocks(result);
  }, [content]);
  return <div>{blocks.map((b, i) => <CodeBlock key={i} language={b.language} code={b.code} />)}</div>;
}