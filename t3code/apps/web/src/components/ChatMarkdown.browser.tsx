import "../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

const { openInPreferredEditorMock, readLocalApiMock } = vi.hoisted(() => ({
  openInPreferredEditorMock: vi.fn(async () => "vscode"),
  readLocalApiMock: vi.fn(() => ({
    server: { getConfig: vi.fn(async () => ({ availableEditors: ["vscode"] })) },
    shell: { openInEditor: vi.fn(async () => undefined) },
  })),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor: openInPreferredEditorMock,
}));

vi.mock("../localApi", () => ({
  ensureLocalApi: vi.fn(() => {
    throw new Error("ensureLocalApi not implemented in browser test");
  }),
  readLocalApi: readLocalApiMock,
}));

import ChatMarkdown from "./ChatMarkdown";

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("rewrites file uri hrefs into direct paths before rendering", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath})`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", filePath);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), filePath);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps line anchors working after rewriting file uri hrefs", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts:1](file://${filePath}#L1)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(expect.anything(), `${filePath}:1`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("shows column information inline when present", async () => {
    const filePath =
      "/Users/yashsingh/p/sco/claude-code-extract/src/utils/permissions/PermissionRule.ts";
    const screen = await render(
      <ChatMarkdown text={`[PermissionRule.ts](file://${filePath}#L1C7)`} cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "PermissionRule.ts · L1:C7" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", `${filePath}:1:7`);

      await link.click();

      await vi.waitFor(() => {
        expect(openInPreferredEditorMock).toHaveBeenCalledWith(
          expect.anything(),
          `${filePath}:1:7`,
        );
      });
    } finally {
      await screen.unmount();
    }
  });

  it("disambiguates duplicate file basenames inline", async () => {
    const firstPath = "/Users/yashsingh/p/t3code/apps/web/src/components/chat/MessagesTimeline.tsx";
    const secondPath = "/Users/yashsingh/p/t3code/apps/web/src/components/MessagesTimeline.tsx";
    const screen = await render(
      <ChatMarkdown
        text={`See [MessagesTimeline.tsx](file://${firstPath}) and [MessagesTimeline.tsx](file://${secondPath}).`}
        cwd="/repo/project"
      />,
    );

    try {
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · components/chat" }))
        .toBeInTheDocument();
      await expect
        .element(page.getByRole("link", { name: "MessagesTimeline.tsx · src/components" }))
        .toBeInTheDocument();
    } finally {
      await screen.unmount();
    }
  });

  it("keeps normal web links unchanged", async () => {
    const screen = await render(
      <ChatMarkdown text="[OpenAI](https://openai.com/docs)" cwd="/repo/project" />,
    );

    try {
      const link = page.getByRole("link", { name: "OpenAI" });
      await expect.element(link).toBeInTheDocument();
      await expect.element(link).toHaveAttribute("href", "https://openai.com/docs");
      await expect.element(link).toHaveAttribute("target", "_blank");
    } finally {
      await screen.unmount();
    }
  });

  it("auto-detects unlabeled JavaScript code fences", async () => {
    const screen = await render(
      <ChatMarkdown
        text={"```\nexport function sum(a, b) {\n  return a + b;\n}\n```"}
        cwd="/repo/project"
      />,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-code-language="javascript"]')).not.toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });

  it("renders aligned line numbers for fenced code blocks", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst first = 1;\nconst second = 2;\n```"} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        const lineNumbers = document.querySelectorAll(".chat-markdown-code-line-number");
        expect(lineNumbers).toHaveLength(2);
        expect(lineNumbers[0]).toHaveTextContent("1");
        expect(lineNumbers[1]).toHaveTextContent("2");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("collapses code blocks longer than twenty lines and expands them on request", async () => {
    const longCode = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join("\n");
    const screen = await render(
      <ChatMarkdown text={`\`\`\`text\n${longCode}\n\`\`\``} cwd="/repo/project" />,
    );

    try {
      const codeBlock = await vi.waitFor(() => {
        const element = document.querySelector(".chat-markdown-codeblock");
        expect(element).not.toBeNull();
        return element as HTMLElement;
      });

      expect(codeBlock.dataset.collapsed).toBe("true");
      expect(document.querySelectorAll(".chat-markdown-code-line")).toHaveLength(10);

      const expandButton = page.getByRole("button", { name: "Expand code block" });
      await expandButton.click();

      await vi.waitFor(() => {
        expect(codeBlock.dataset.collapsed).toBe("false");
        expect(document.querySelectorAll(".chat-markdown-code-line")).toHaveLength(25);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("copies the full code block even when collapsed", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const longCode = Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join("\n");
    const screen = await render(
      <ChatMarkdown text={`\`\`\`text\n${longCode}\n\`\`\``} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelector(".chat-markdown-codeblock")).not.toBeNull();
      });

      await page.getByRole("button", { name: "Copy code" }).click();

      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(`${longCode}\n`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("does not add code-block controls to inline code", async () => {
    const screen = await render(
      <ChatMarkdown text={"Use `const value = 1` inline."} cwd="/repo/project" />,
    );

    try {
      await expect.element(page.getByText("const value = 1")).toBeInTheDocument();
      expect(document.querySelector(".chat-markdown-codeblock")).toBeNull();
      expect(document.querySelector(".chat-markdown-code-line-number")).toBeNull();
    } finally {
      await screen.unmount();
    }
  });
});
