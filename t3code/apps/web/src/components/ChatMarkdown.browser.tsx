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

const clipboardWriteTextMock = vi.fn(async () => undefined);
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function setClipboardMock() {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWriteTextMock },
  });
}

describe("ChatMarkdown", () => {
  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    clipboardWriteTextMock.mockClear();
    if (originalClipboardDescriptor) {
      Object.defineProperty(navigator, "clipboard", originalClipboardDescriptor);
    } else {
      Reflect.deleteProperty(navigator, "clipboard");
    }
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

  it("syntax highlights fenced code blocks with language hints", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst answer: number = 42;\n```"} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        const codeBlock = document.querySelector(".chat-markdown-shiki .shiki");
        expect(codeBlock).not.toBeNull();
        expect(codeBlock?.textContent).toContain("const answer: number = 42;");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("attempts language detection when fences omit a hint", async () => {
    const screen = await render(
      <ChatMarkdown text={'```\n{"name":"Ada","role":"engineer"}\n```'} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        const highlighted = document.querySelector(".chat-markdown-shiki .shiki");
        expect(highlighted).not.toBeNull();
        expect(highlighted?.querySelectorAll('span[style*="color"]').length).toBeGreaterThan(0);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("collapses code blocks longer than twenty lines", async () => {
    const longCode = Array.from({ length: 21 }, (_, index) => `item ${index + 1}`).join("\n");
    const screen = await render(
      <ChatMarkdown text={`\`\`\`ts\n${longCode}\n\`\`\``} cwd="/repo/project" />,
    );

    try {
      const details = document.querySelector("details.chat-markdown-codeblock-details");
      expect(details).not.toBeNull();
      await expect.element(page.getByText("item 1", { exact: true })).toBeVisible();
      await expect.element(page.getByText("item 11", { exact: true })).not.toBeVisible();

      await page.getByText("item 1", { exact: true }).click();

      await expect.element(page.getByText("item 11", { exact: true })).toBeVisible();
      await expect.element(page.getByText("item 21", { exact: true })).toBeVisible();
    } finally {
      await screen.unmount();
    }
  });

  it("copies only the code content from the copy button", async () => {
    setClipboardMock();

    const screen = await render(
      <ChatMarkdown text={"```ts\nconst answer = 42;\n```"} cwd="/repo/project" />,
    );

    try {
      await page.getByText("const answer = 42;", { exact: false }).hover();
      await page.getByRole("button", { name: "Copy code" }).click();

      await vi.waitFor(() => {
        expect(clipboardWriteTextMock).toHaveBeenCalledWith("const answer = 42;\n");
      });
    } finally {
      await screen.unmount();
    }
  });
});
