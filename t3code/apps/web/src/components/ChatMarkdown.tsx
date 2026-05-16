import React, { useState, useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import remarkGfm from "remark-gfm";

interface CodeBlockProps {
    language: string;
    value: string;
}

function CodeBlock({ language, value }: CodeBlockProps) {
    const [collapsed, setCollapsed] = useState(false);
    const [copied, setCopied] = useState(false);

    const handleCopy = useCallback(async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [value]);

    const lineCount = value.split("\n").length;
    const shouldCollapse = lineCount > 20;

    const toggleCollapse = useCallback(() => {
        setCollapsed((prev) => !prev);
    }, []);

    const displayValue = collapsed ? value.split("\n").slice(0, 20).join("\n") + "\n..." : value;

    return (
        <div className="code-block-wrapper">
            <div className="code-block-header">
                <span className="code-language">{language || "text"}</span>
                <div className="code-block-actions">
                    {shouldCollapse && (
                        <button
                            onClick={toggleCollapse}
                            className="code-collapse-btn"
                            aria-label={collapsed ? "Expand code" : "Collapse code"}
                        >
                            {collapsed ? `Show all (${lineCount} lines)` : "Collapse"}
                        </button>
                    )}
                    <button onClick={handleCopy} className="code-copy-btn" aria-label="Copy code">
                        {copied ? "Copied!" : "Copy"}
                    </button>
                </div>
            </div>
            <SyntaxHighlighter
                language={language || "text"}
                style={oneDark}
                customStyle={{
                    margin: 0,
                    borderBottomLeftRadius: "6px",
                    borderBottomRightRadius: "6px",
                    fontSize: "13px",
                }}
                showLineNumbers={lineCount > 5}
                wrapLongLines={false}
            >
                {displayValue}
            </SyntaxHighlighter>
        </div>
    );
}

interface ChatMarkdownProps {
    content: string;
    className?: string;
}

export function ChatMarkdown({ content, className }: ChatMarkdownProps) {
    const components = useMemo(
        () => ({
            code({ node, inline, className: codeClassName, children, ...props }: any) {
                const match = /language-(\w+)/.exec(codeClassName || "");
                const value = String(children).replace(/\n$/, "");

                if (!inline && match) {
                    return <CodeBlock language={match[1]} value={value} />;
                }

                if (!inline) {
                    return <CodeBlock language="" value={value} />;
                }

                return (
                    <code className={codeClassName} {...props}>
                        {children}
                    </code>
                );
            },
            pre({ children }: any) {
                return <>{children}</>;
            },
        }),
        []
    );

    return (
        <div className={`chat-markdown ${className || ""}`}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={components}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

const styles = `
.code-block-wrapper {
    margin: 12px 0;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #333;
}
.code-block-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 12px;
    background: #1e1e2e;
    border-bottom: 1px solid #333;
}
.code-language {
    font-size: 12px;
    color: #888;
    text-transform: uppercase;
    font-weight: 600;
}
.code-block-actions {
    display: flex;
    gap: 6px;
}
.code-copy-btn, .code-collapse-btn {
    padding: 2px 8px;
    font-size: 11px;
    border: 1px solid #555;
    border-radius: 4px;
    background: #2a2a3a;
    color: #ccc;
    cursor: pointer;
    transition: all 0.15s;
}
.code-copy-btn:hover, .code-collapse-btn:hover {
    background: #3a3a4a;
    color: #fff;
}
.chat-markdown {
    line-height: 1.6;
    color: #e0e0e0;
}
.chat-markdown p {
    margin: 8px 0;
}
.chat-markdown code {
    background: #2a2a3a;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 13px;
}
.chat-markdown pre {
    margin: 0;
}
`;