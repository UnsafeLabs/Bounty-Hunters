import { describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  buildThreadActionItems,
  filterCommandPaletteGroups,
  fuzzyMatch,
  type CommandPaletteGroup,
} from "./CommandPalette.logic";

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    codexThreadId: null,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
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
    ...overrides,
  };
}

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const group: CommandPaletteGroup = {
      value: "threads-search",
      label: "Threads",
      items: [
        {
          kind: "action",
          value: "thread:project-context-only",
          searchTerms: ["Fix navbar spacing", "Project"],
          title: "Fix navbar spacing",
          description: "Project",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});


describe("fuzzyMatch", () => {
  it("matches across word boundaries (ofl -> Open File)", () => {
    const r = fuzzyMatch("ofl", "Open File");
    expect(r.matched).toBe(true);
    expect(r.indices).toEqual([0, 3, 4]);
  });

  it("scores consecutive matches higher than scattered matches", () => {
    const consecutive = fuzzyMatch("abc", "abc def");
    const scattered = fuzzyMatch("abc", "a x b x c");
    expect(consecutive.score).toBeGreaterThan(scattered.score);
  });

  it("scores word-boundary matches higher than mid-word matches", () => {
    const boundary = fuzzyMatch("fi", "Fix it");
    const mid = fuzzyMatch("fi", "office");
    expect(boundary.score).toBeGreaterThan(mid.score);
  });

  it("returns no match when characters are missing", () => {
    expect(fuzzyMatch("xyz", "Open File").matched).toBe(false);
  });

  it("empty query matches everything with no indices", () => {
    const r = fuzzyMatch("", "anything");
    expect(r.matched).toBe(true);
    expect(r.indices).toEqual([]);
  });
});

describe("filterCommandPaletteGroups fuzzy search", () => {
  const group: CommandPaletteGroup = {
    value: "actions",
    label: "Actions",
    items: [
      {
        kind: "action",
        value: "open-file",
        searchTerms: ["Open File"],
        title: "Open File",
        icon: null,
        run: async () => undefined,
      },
      {
        kind: "action",
        value: "close-window",
        searchTerms: ["Close Window"],
        title: "Close Window",
        icon: null,
        run: async () => undefined,
      },
    ],
  };

  it("matches 'ofl' to 'Open File' and records highlight indices", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "ofl",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["open-file"]);
    expect(groups[0]?.items[0]?.fuzzyMatchIndices).toEqual([0, 3, 4]);
  });

  it("returns all items for an empty query", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items).toHaveLength(2);
  });

  it("filters by a single character", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "c",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });
    expect(groups[0]?.items.map((item) => item.value)).toContain("close-window");
  });
});
