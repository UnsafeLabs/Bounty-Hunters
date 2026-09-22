from solution import detect_language, parse_code_blocks, render_chat_markdown

def test_explicit_hint_and_alias():
    assert detect_language("const x = 1", "js") == "javascript"
    assert parse_code_blocks("```python\nreturn 1\n```")[0].language == "python"

def test_auto_detection_and_escaping():
    block = parse_code_blocks("```\ndef hello():\n    return '<x>'\n```")[0]
    assert block.language == "python" and "token keyword" in block.highlighted and "&lt;x&gt;" in block.highlighted

def test_copy_button_line_numbers_and_inline_code():
    rendered = render_chat_markdown("inline `const x`\n\n```js\nconst x = 1;\n```")
    assert rendered.count('class="copy-code"') == 1 and 'data-code="const x = 1;"' in rendered
    assert 'class="code-line"' in rendered and "inline `const x`" in rendered

def test_long_block_collapses_and_has_all_lines_for_expansion():
    rendered = render_chat_markdown("```text\n" + "\n".join(f"line {i}" for i in range(25)) + "\n```")
    assert 'class="code-block collapsible"' in rendered and rendered.count('class="code-line"') == 25

def test_short_block_and_invalid_input():
    assert "collapsible" not in render_chat_markdown("```\na\nb\n```")
    try: render_chat_markdown(None)
    except TypeError: pass
    else: raise AssertionError("non-string markdown must fail")
