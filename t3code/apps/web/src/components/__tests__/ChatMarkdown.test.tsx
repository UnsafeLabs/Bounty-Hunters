import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatMarkdown } from "./ChatMarkdown";

vi.mock("react-syntax-highlighter/dist/esm/styles/prism", () => ({
    oneDark: {},
}));

Object.assign(navigator, {
    clipboard: {
        writeText: vi.fn(() => Promise.resolve()),
    },
});

describe("ChatMarkdown", () => {
    it("should render plain text content", () => {
        render(<ChatMarkdown content="Hello world" />);
        expect(screen.getByText("Hello world")).toBeDefined();
    });

    it("should render bold markdown", () => {
        render(<ChatMarkdown content="**Bold text**" />);
        const bold = document.querySelector("strong");
        expect(bold).toBeTruthy();
        expect(bold?.textContent).toBe("Bold text");
    });

    it("should render inline code", () => {
        render(<ChatMarkdown content="Use `console.log()` to debug" />);
        const code = document.querySelector("code");
        expect(code).toBeTruthy();
        expect(code?.textContent).toContain("console.log");
    });

    it("should render fenced code block with language", () => {
        const content = '```javascript\nconst x = 1;\n```';
        render(<ChatMarkdown content={content} />);
        const langLabel = document.querySelector(".code-language");
        expect(langLabel).toBeTruthy();
        expect(langLabel?.textContent).toBe("javascript");
    });

    it("should render copy button on code blocks", () => {
        const content = '```python\nprint("hello")\n```';
        render(<ChatMarkdown content={content} />);
        const copyBtn = document.querySelector(".code-copy-btn");
        expect(copyBtn).toBeTruthy();
    });

    it("should show collapse button for long code blocks", () => {
        const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n");
        const content = "```\n" + lines + "\n```";
        render(<ChatMarkdown content={content} />);
        const collapseBtn = document.querySelector(".code-collapse-btn");
        expect(collapseBtn).toBeTruthy();
    });

    it("should render unordered lists", () => {
        render(<ChatMarkdown content="- Item 1\n- Item 2" />);
        const listItems = document.querySelectorAll("li");
        expect(listItems.length).toBe(2);
    });

    it("should render links", () => {
        render(<ChatMarkdown content="[GitHub](https://github.com)" />);
        const link = document.querySelector("a");
        expect(link).toBeTruthy();
        expect(link?.getAttribute("href")).toBe("https://github.com");
    });
});