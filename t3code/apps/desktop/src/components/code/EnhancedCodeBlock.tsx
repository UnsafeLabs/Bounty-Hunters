import React, { useState, useCallback, useMemo } from "react";

/**
 * Fix: Add syntax highlighting, copy button, and collapsible code blocks (#837)
 */

interface CodeBlockProps {
  code: string;
  language?: string;
  collapsible?: boolean;
  maxCollapsedLines?: number;
  showLineNumbers?: boolean;
  fileName?: string;
}

export const EnhancedCodeBlock: React.FC<CodeBlockProps> = ({
  code,
  language = "typescript",
  collapsible = true,
  maxCollapsedLines = 20,
  showLineNumbers = true,
  fileName,
}) => {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!collapsible);

  const lines = useMemo(() => code.split("\n"), [code]);
  const shouldCollapse = collapsible && lines.length > maxCollapsedLines;
  const visibleLines = expanded ? lines : lines.slice(0, maxCollapsedLines);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  const getLanguageClass = (lang: string): string => {
    const map: Record<string, string> = {
      typescript: "language-typescript",
      javascript: "language-javascript",
      python: "language-python",
      rust: "language-rust",
      solidity: "language-solidity",
      php: "language-php",
      go: "language-go",
      sql: "language-sql",
      bash: "language-bash",
    };
    return map[lang.toLowerCase()] || `language-${lang}`;
  };

  return (
    <div className="relative rounded-lg border border-gray-700 bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          {fileName && (
            <span className="text-sm text-gray-300 font-mono">{fileName}</span>
          )}
          <span className="text-xs text-gray-500 px-2 py-0.5 bg-gray-700 rounded">
            {language}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{lines.length} lines</span>
          <button
            onClick={handleCopy}
            className="text-xs px-2 py-1 rounded hover:bg-gray-600 transition-colors"
          >
            {copied ? "✓ Copied" : "📋 Copy"}
          </button>
        </div>
      </div>

      {/* Code */}
      <div className="overflow-x-auto">
        <pre className={`p-4 ${getLanguageClass(language)}`}>
          <code>
            {visibleLines.map((line, i) => (
              <div key={i} className="flex">
                {showLineNumbers && (
                  <span className="select-none text-gray-600 text-right w-8 pr-3 shrink-0 text-xs leading-6">
                    {i + 1}
                  </span>
                )}
                <span className="text-gray-200 text-sm leading-6 whitespace-pre">
                  {line}
                </span>
              </div>
            ))}
          </code>
        </pre>
      </div>

      {/* Collapse toggle */}
      {shouldCollapse && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full py-2 text-center text-sm text-blue-400 hover:text-blue-300 bg-gray-800 border-t border-gray-700"
        >
          {expanded
            ? `Collapse (showing ${lines.length} lines)`
            : `Expand (${lines.length - maxCollapsedLines} more lines)`
          }
        </button>
      )}
    </div>
  );
};
