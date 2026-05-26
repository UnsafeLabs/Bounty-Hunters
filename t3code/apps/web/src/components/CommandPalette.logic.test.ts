import { describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  buildThreadActionItems,
  filterCommandPaletteGroups,
  fuzzyMatchCommandPaletteText,
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

describe("filterCommandPaletteGroups fuzzy search", () => {
  it("matches command titles across gaps and exposes title highlight indices", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
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
          ],
        },
      ],
      query: "ofl",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items[0]?.value).toBe("open-file");
    expect(groups[0]?.items[0]?.titleMatchIndices).toEqual([0, 5, 7]);
  });

  it("ranks consecutive matches ahead of looser word-boundary matches", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "other-project",
              searchTerms: ["Other Project"],
              title: "Other Project",
              icon: null,
              run: async () => undefined,
            },
            {
              kind: "action",
              value: "open-file",
              searchTerms: ["Open File"],
              title: "Open File",
              icon: null,
              run: async () => undefined,
            },
          ],
        },
      ],
      query: "op",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual(["open-file", "other-project"]);
  });

  it("keeps empty queries in their original order", () => {
    const group: CommandPaletteGroup = {
      value: "actions",
      label: "Actions",
      items: [
        {
          kind: "action",
          value: "second",
          searchTerms: ["Second Action"],
          title: "Second Action",
          icon: null,
          run: async () => undefined,
        },
        {
          kind: "action",
          value: "first",
          searchTerms: ["First Action"],
          title: "First Action",
          icon: null,
          run: async () => undefined,
        },
      ],
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [group],
      query: "",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual(["second", "first"]);
  });

  it("filters single-character queries", () => {
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        {
          value: "actions",
          label: "Actions",
          items: [
            {
              kind: "action",
              value: "save",
              searchTerms: ["Save File"],
              title: "Save File",
              icon: null,
              run: async () => undefined,
            },
            {
              kind: "action",
              value: "open",
              searchTerms: ["Open File"],
              title: "Open File",
              icon: null,
              run: async () => undefined,
            },
          ],
        },
      ],
      query: "s",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual(["save"]);
  });
});

describe("fuzzyMatchCommandPaletteText", () => {
  it("returns matched indices for gapped query characters", () => {
    expect(fuzzyMatchCommandPaletteText("Open File", "ofl")?.indices).toEqual([0, 5, 7]);
  });

  it("scores compact consecutive matches above wider matches", () => {
    const consecutive = fuzzyMatchCommandPaletteText("Open File", "op");
    const loose = fuzzyMatchCommandPaletteText("Other Project", "op");

    expect(consecutive?.score).toBeGreaterThan(loose?.score ?? 0);
  });
});
