"""Dependency-free ChatMarkdown renderer for the task harness."""
from __future__ import annotations
import html, re
from dataclasses import dataclass

_FENCE = re.compile(r"(?ms)^```([^\n]*)\n(.*?)^```[ \t]*$")
_ALIASES = {"js":"javascript", "ts":"typescript", "py":"python", "sh":"bash", "shell":"bash", "yml":"yaml"}
_KNOWN = {"python","javascript","typescript","json","bash","yaml","sql","java","c","cpp","go","rust","css","html","jsx","tsx"}

@dataclass(frozen=True)
class CodeBlock:
    code: str
    language: str
    highlighted: str
    collapsed: bool
    visible_lines: int

def detect_language(code: str, hint: str = "") -> str:
    value = hint.strip().lower().split()[0] if hint.strip() else ""
    value = _ALIASES.get(value, value)
    if value in _KNOWN: return value
    if re.search(r"^\s*(def |from \w+ import|import \w+|class .*:)", code, re.M): return "python"
    if re.search(r"\b(const|let|var)\s+\w+\s*=|=>|console\.log", code): return "javascript"
    if re.search(r"^\s*(SELECT|INSERT|UPDATE|CREATE)\b", code, re.I|re.M): return "sql"
    return "text"

def _highlight(code: str, language: str) -> str:
    out = html.escape(code, quote=False)
    # Apply strings before keyword spans so the second pass cannot interpret
    # quotes in generated HTML attributes as source-code strings.
    out = re.sub(r'(&quot;.*?&quot;|&#x27;.*?&#x27;|".*?"|\'.*?\')', r'<span class="token string">\1</span>', out)
    patterns = {
        "python": r"\b(def|class|import|from|return|if|else|elif|for|while|in|True|False|None|and|or|not)\b",
        "javascript": r"\b(const|let|var|function|return|if|else|for|while|true|false|null|undefined|async|await)\b",
        "typescript": r"\b(const|let|var|function|return|interface|type|string|number|boolean|true|false|null)\b",
        "sql": r"\b(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|AND|OR|JOIN)\b"}.get(language)
    if patterns: out = re.sub(patterns, r'<span class="token keyword">\1</span>', out, flags=re.I if language == "sql" else 0)
    return out

def parse_code_blocks(markdown: str) -> list[CodeBlock]:
    blocks = []
    for m in _FENCE.finditer(markdown):
        code = m.group(2).rstrip("\n"); language = detect_language(code, m.group(1)); n = len(code.splitlines()) or 1
        blocks.append(CodeBlock(code, language, _highlight(code, language), n > 20, min(10, n)))
    return blocks

def render_chat_markdown(markdown: str) -> str:
    if not isinstance(markdown, str): raise TypeError("markdown must be a string")
    result, cursor = [], 0
    for m in _FENCE.finditer(markdown):
        result.append(html.escape(markdown[cursor:m.start()], quote=False)); b = parse_code_blocks(m.group(0))[0]
        numbered = "\n".join(f'<span class="code-line">{line}</span>' for line in (b.highlighted.splitlines() or [""]))
        button = '<button class="copy-code" type="button" aria-label="Copy code" data-code="' + html.escape(b.code, quote=True) + '">Copy</button>'
        content = f'<div class="code-content" data-language="{html.escape(b.language)}">{numbered}</div>'
        if b.collapsed: result.append(f'<details class="code-block collapsible"><summary>Show code</summary>{button}{content}</details>')
        else: result.append(f'<div class="code-block">{button}{content}</div>')
        cursor = m.end()
    result.append(html.escape(markdown[cursor:], quote=False)); return "".join(result)

def solve_task(data: dict) -> dict:
    if not isinstance(data, dict): raise ValueError("Invalid input format")
    out = {"status":"success", "task":"[ T3 Code ] Add syntax highlighting, copy button, and collapsible code blocks to ChatMarkdown", "processed":True, "data":data}
    if "markdown" in data: out["html"] = render_chat_markdown(data["markdown"])
    return out
