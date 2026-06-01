/**
 * Syntax highlighting, copy button, and collapsible code blocks for ChatMarkdown.
 */

import { useState, useRef, useCallback } from "react";

interface CodeBlockProps {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * Enhanced code block component with syntax highlighting and copy.
 */
export function useCodeBlock(options: CodeBlockProps) {
  const { code, language, showLineNumbers = true, collapsible = false, defaultCollapsed = false } = options;
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = code;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
    }
  }, [code]);

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  return {
    code,
    language,
    showLineNumbers,
    collapsible,
    collapsed,
    copied,
    handleCopy,
    toggleCollapse,
  };
}
