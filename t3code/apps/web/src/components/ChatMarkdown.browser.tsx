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
    vi.unstubAllGlobals();
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

  it("auto-detects unlabeled fenced TypeScript code blocks and keeps inline code plain", async () => {
    const screen = await render(
      <ChatMarkdown
        text={
          "Inline `const value = 1` stays inline.\n\n```\nimport { z } from 'zod';\nexport const value: string = z.string().parse('ok');\n```"
        }
        cwd="/repo/project"
      />,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('.chat-markdown-shiki[data-language="typescript"]')).not.toBeNull();
      });
      expect(document.querySelector(".chat-markdown :not(pre) > code")?.textContent).toBe(
        "const value = 1",
      );
    } finally {
      await screen.unmount();
    }
  });

  it("renders aligned line numbers for code blocks", async () => {
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;\n```"} cwd="/repo/project" />,
    );

    try {
      await vi.waitFor(() => {
        expect(document.querySelectorAll(".chat-markdown-line-numbers span").length).toBe(3);
      });
      expect(
        [...document.querySelectorAll(".chat-markdown-line-numbers span")].map((node) =>
          node.textContent?.trim(),
        ),
      ).toEqual(["1", "2", "3"]);
    } finally {
      await screen.unmount();
    }
  });

  it("collapses long code blocks to a ten-line preview and expands on summary click", async () => {
    const longCode = Array.from({ length: 21 }, (_, index) => `console.log(${index + 1});`).join(
      "\n",
    );
    const screen = await render(<ChatMarkdown text={`\`\`\`ts\n${longCode}\n\`\`\``} cwd="/repo/project" />);

    try {
      await vi.waitFor(() => {
        expect(document.querySelector('[data-collapsible="true"]')).not.toBeNull();
      });
      const body = document.querySelector(".chat-markdown-codeblock-body");
      expect(body?.getAttribute("data-collapsed")).toBe("true");

      await page.getByText("Show all 21 lines").click();

      await vi.waitFor(() => {
        expect(body?.getAttribute("data-collapsed")).toBe("false");
      });
    } finally {
      await screen.unmount();
    }
  });

  it("copies only the fenced code content", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText },
    });
    const screen = await render(
      <ChatMarkdown text={"```ts\nconst copied = true;\n```"} cwd="/repo/project" />,
    );

    try {
      await page.getByRole("button", { name: "Copy code" }).click();
      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith("const copied = true;\n");
      });
    } finally {
      await screen.unmount();
    }
  });
});
