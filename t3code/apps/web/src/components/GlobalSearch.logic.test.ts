import { describe, expect, it } from "vitest";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import type { Project, Thread } from "../types";
import {
  buildGlobalSearchMatcher,
  createSnippet,
  highlightSearchText,
  searchChatMessages,
} from "./GlobalSearch.logic";

const ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");
const THREAD_ID = ThreadId.make("thread-1");

const project: Project = {
  id: PROJECT_ID,
  environmentId: ENVIRONMENT_ID,
  name: "Money Maker",
  cwd: "/repo",
  repositoryIdentity: null,
  defaultModelSelection: null,
  scripts: [],
};

function makeThread(messages: Thread["messages"]): Thread {
  return {
    id: THREAD_ID,
    environmentId: ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Search thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages,
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
  };
}

describe("buildGlobalSearchMatcher", () => {
  it("matches plain text case-insensitively by default", () => {
    const result = buildGlobalSearchMatcher("wallet", { regex: false, caseSensitive: false });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.matcher.matches("Wallet migration")).toBe(true);
    expect(result.matcher.ranges("Wallet migration")).toEqual([{ start: 0, end: 6 }]);
  });

  it("honors case-sensitive plain text matching", () => {
    const result = buildGlobalSearchMatcher("Wallet", { regex: false, caseSensitive: true });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.matcher.matches("wallet migration")).toBe(false);
    expect(result.matcher.matches("Wallet migration")).toBe(true);
  });

  it("returns an invalid result for malformed regex queries", () => {
    const result = buildGlobalSearchMatcher("[", { regex: true, caseSensitive: false });

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.message).toContain("regular expression");
  });
});

describe("highlightSearchText", () => {
  it("splits matching segments for rendering", () => {
    const result = buildGlobalSearchMatcher("bar", { regex: false, caseSensitive: false });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(highlightSearchText("foo bar baz", result.matcher)).toEqual([
      { text: "foo ", match: false },
      { text: "bar", match: true },
      { text: " baz", match: false },
    ]);
  });
});

describe("searchChatMessages", () => {
  it("returns matching chat messages with project and thread context", () => {
    const matcherResult = buildGlobalSearchMatcher("bridge", {
      regex: false,
      caseSensitive: false,
    });
    expect(matcherResult.status).toBe("valid");
    if (matcherResult.status !== "valid") return;

    const thread = makeThread([
      {
        id: MessageId.make("message-1"),
        role: "user",
        text: "Please inspect the bridge nonce handling.",
        createdAt: "2026-03-01T00:00:00.000Z",
        streaming: false,
      },
      {
        id: MessageId.make("message-2"),
        role: "assistant",
        text: "No match here.",
        createdAt: "2026-03-01T00:00:01.000Z",
        streaming: false,
      },
    ]);

    expect(
      searchChatMessages({
        projects: [project],
        threads: [thread],
        matcher: matcherResult.matcher,
      }),
    ).toMatchObject([
      {
        threadTitle: "Search thread",
        projectName: "Money Maker",
        role: "user",
        snippet: "Please inspect the bridge nonce handling.",
      },
    ]);
  });
});

describe("createSnippet", () => {
  it("centers snippets around the first match", () => {
    const snippet = createSnippet("start ".repeat(20) + "needle" + " end".repeat(20), [
      { start: 120, end: 126 },
    ]);

    expect(snippet).toContain("needle");
    expect(snippet.startsWith("...")).toBe(true);
    expect(snippet.endsWith("...")).toBe(true);
  });
});
