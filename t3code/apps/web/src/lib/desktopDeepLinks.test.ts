import { beforeEach, describe, expect, it, vi } from "vitest";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { Project, SidebarThreadSummary } from "../types";

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  dispatch: vi.fn(),
  projects: vi.fn(),
  threads: vi.fn(),
  api: vi.fn(),
}));
vi.mock("../environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    environmentId: "local",
    ensureBootstrapped: mocks.bootstrap,
  }),
}));
vi.mock("../environmentApi", () => ({ readEnvironmentApi: mocks.api }));
vi.mock("../store", () => ({
  useStore: { getState: () => ({}) },
  selectProjectsAcrossEnvironments: mocks.projects,
  selectSidebarThreadsAcrossEnvironments: mocks.threads,
}));

import { handleDesktopDeepLink } from "./desktopDeepLinks";

describe("desktop deep-link navigation", () => {
  const navigation = { openSettings: vi.fn(), openThread: vi.fn(), openProject: vi.fn() };
  const project = {
    id: ProjectId.make("project-1"),
    environmentId: EnvironmentId.make("local"),
    cwd: "/work/repo",
  } as Project;
  const thread = {
    id: ThreadId.make("abc123"),
    environmentId: EnvironmentId.make("local"),
    projectId: project.id,
    createdAt: "2026-01-01T00:00:00Z",
    archivedAt: null,
  } as SidebarThreadSummary;

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.projects.mockReturnValue([]);
    mocks.threads.mockReturnValue([]);
    mocks.api.mockReturnValue({ orchestration: { dispatchCommand: mocks.dispatch } });
  });
  it("opens settings without waiting for the backend", async () => {
    await handleDesktopDeepLink({ type: "settings" }, navigation);
    expect(navigation.openSettings).toHaveBeenCalledTimes(1);
    expect(mocks.bootstrap).not.toHaveBeenCalled();
  });
  it("waits for the initial snapshot before looking up a thread", async () => {
    let resolve!: () => void;
    mocks.bootstrap.mockReturnValue(
      new Promise<void>((done) => {
        resolve = done;
      }),
    );
    const pending = handleDesktopDeepLink({ type: "thread", id: "abc123" }, navigation);
    expect(navigation.openThread).not.toHaveBeenCalled();
    mocks.threads.mockReturnValue([thread]);
    resolve();
    await pending;
    expect(navigation.openThread).toHaveBeenCalledWith({
      environmentId: "local",
      threadId: "abc123",
    });
  });
  it("rejects an unknown thread and does not select a matching remote ID", async () => {
    mocks.threads.mockReturnValue([{ ...thread, environmentId: "remote" }]);
    await expect(
      handleDesktopDeepLink({ type: "thread", id: "abc123" }, navigation),
    ).rejects.toThrow("could not be found");
    expect(navigation.openThread).not.toHaveBeenCalled();
  });
  it("opens an existing project's chat without creating another project", async () => {
    mocks.projects.mockReturnValue([project]);
    mocks.threads.mockReturnValue([thread]);
    await handleDesktopDeepLink({ type: "project", path: "/work/repo" }, navigation);
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(navigation.openThread).toHaveBeenCalledWith({
      environmentId: "local",
      threadId: "abc123",
    });
  });
  it("opens a draft for an existing project with no threads", async () => {
    mocks.projects.mockReturnValue([project]);
    await handleDesktopDeepLink({ type: "project", path: "/work/repo" }, navigation);
    expect(navigation.openProject).toHaveBeenCalledWith({
      environmentId: "local",
      projectId: "project-1",
    });
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });
  it("adds a project to the local backend without creating directories", async () => {
    mocks.projects.mockReturnValue([{ ...project, environmentId: "remote" }]);
    await handleDesktopDeepLink({ type: "project", path: "/work/repo" }, navigation);
    expect(mocks.api).toHaveBeenCalledWith("local");
    expect(mocks.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "project.create",
        workspaceRoot: "/work/repo",
        createWorkspaceRootIfMissing: false,
      }),
    );
    expect(navigation.openProject).toHaveBeenCalledWith({
      environmentId: "local",
      projectId: mocks.dispatch.mock.calls[0]![0].projectId,
    });
  });
  it("propagates errors for the notification handler and does not navigate", async () => {
    await expect(
      handleDesktopDeepLink({ type: "error", message: "Invalid path" }, navigation),
    ).rejects.toThrow("Invalid path");
    mocks.dispatch.mockRejectedValue(new Error("Project unavailable"));
    await expect(
      handleDesktopDeepLink({ type: "project", path: "/work/repo" }, navigation),
    ).rejects.toThrow("Project unavailable");
    expect(navigation.openProject).not.toHaveBeenCalled();
  });
});
