import "../index.css";

import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const writeTextMock = vi.fn(async () => undefined);

  afterEach(() => {
    openInPreferredEditorMock.mockClear();
    readLocalApiMock.mockClear();
    writeTextMock.mockClear();
    localStorage.clear();
    document.body.innerHTML = "";
  });

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeTextMock,
      },
    });
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

  it("copies only fenced code block contents", async () => {
    const code = "const answer = 42;\nconsole.log(answer);";
    const screen = await render(
      <ChatMarkdown text={`\`\`\`ts\n${code}\n\`\`\``} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelector(".chat-markdown-copy-button")).toBeTruthy();
      });

      const copyButton = document.querySelector<HTMLButtonElement>(".chat-markdown-copy-button");
      copyButton?.click();

      await vi.waitFor(() => {
        expect(writeTextMock).toHaveBeenCalledWith(`${code}\n`);
      });
    } finally {
      await screen.unmount();
    }
  });

  it("keeps inline code spans out of code block controls", async () => {
    const screen = await render(
      <ChatMarkdown text="Use `const answer = 42` inline." cwd="/repo/project" />,
    );

    try {
      expect(document.querySelector(".chat-markdown-codeblock")).toBeNull();
      expect(document.querySelector(".chat-markdown-copy-button")).toBeNull();
      expect(document.querySelector("p code")?.textContent).toBe("const answer = 42");
    } finally {
      await screen.unmount();
    }
  });

  it("auto-detects unlabeled TypeScript code fences", async () => {
    const screen = await render(
      <ChatMarkdown
        text={"```\nconst answer: number = 42;\nexport { answer };\n```"}
        cwd="/repo/project"
      />,
    );

    try {
      await vi.waitFor(() => {
        expect(
          document.querySelector('.chat-markdown-shiki[data-language="typescript"]'),
        ).toBeTruthy();
      });
    } finally {
      await screen.unmount();
    }
  });

  it("collapses long code blocks to a ten-line preview", async () => {
    const code = Array.from({ length: 25 }, (_, index) => `line-${index + 1}`).join("\n");
    const screen = await render(
      <ChatMarkdown text={`\`\`\`txt\n${code}\n\`\`\``} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        expect(
          document.querySelector('.chat-markdown-codeblock[data-collapsible="true"]'),
        ).toBeTruthy();
      });

      const codeBlock = document.querySelector<HTMLElement>(".chat-markdown-codeblock");
      const details = document.querySelector<HTMLDetailsElement>(
        ".chat-markdown-codeblock-details",
      );
      const preview = document.querySelector<HTMLElement>(".chat-markdown-codeblock-preview");

      expect(codeBlock?.dataset.lineCount).toBe("25");
      expect(details?.open).toBe(false);
      expect(preview?.textContent).toContain("line-10");
      expect(preview?.textContent).not.toContain("line-11");

      document.querySelector<HTMLElement>(".chat-markdown-codeblock-summary")?.click();

      await vi.waitFor(() => {
        expect(details?.open).toBe(true);
        expect(document.querySelector(".chat-markdown-codeblock-preview")).toBeNull();
      });
    } finally {
      await screen.unmount();
    }
  });
});
