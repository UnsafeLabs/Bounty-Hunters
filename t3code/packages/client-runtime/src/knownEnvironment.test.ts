import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createKnownEnvironment,
  detectKnownEnvironmentRuntime,
  getKnownEnvironmentHttpBaseUrl,
} from "./knownEnvironment.ts";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopedProjectKey,
  scopedRefKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "./scoped.ts";

describe("known environment bootstrap helpers", () => {
  it("creates known environments from explicit server base urls", () => {
    expect(
      createKnownEnvironment({
        label: "Remote environment",
        target: {
          httpBaseUrl: "https://remote.example.com",
          wsBaseUrl: "wss://remote.example.com",
        },
      }),
    ).toEqual({
      id: "ws:Remote environment",
      label: "Remote environment",
      runtime: {
        isCi: false,
        isContainer: false,
        isWsl: false,
      },
      source: "manual",
      target: {
        httpBaseUrl: "https://remote.example.com",
        wsBaseUrl: "wss://remote.example.com",
      },
    });
  });

  it("returns the explicit fetchable http origin", () => {
    expect(
      getKnownEnvironmentHttpBaseUrl(
        createKnownEnvironment({
          label: "Local environment",
          target: {
            httpBaseUrl: "http://localhost:3773",
            wsBaseUrl: "ws://localhost:3773",
          },
        }),
      ),
    ).toBe("http://localhost:3773");

    expect(
      getKnownEnvironmentHttpBaseUrl(
        createKnownEnvironment({
          label: "Remote environment",
          target: {
            httpBaseUrl: "https://remote.example.com/api",
            wsBaseUrl: "wss://remote.example.com/api",
          },
        }),
      ),
    ).toBe("https://remote.example.com/api");
  });

  it("exposes detected runtime flags on known environments", () => {
    const runtime = detectKnownEnvironmentRuntime({
      env: {
        GITHUB_ACTIONS: "true",
        WSL_DISTRO_NAME: "Ubuntu",
      },
      fileExists: (path) => path === "/.dockerenv",
    });

    expect(
      createKnownEnvironment({
        label: "CI container",
        runtime,
        target: {
          httpBaseUrl: "http://127.0.0.1:3773",
          wsBaseUrl: "ws://127.0.0.1:3773",
        },
      }).runtime,
    ).toEqual({
      isCi: true,
      isContainer: true,
      isWsl: true,
      ciProvider: "github-actions",
      containerKind: "docker",
      wslDistroName: "Ubuntu",
    });
  });

  it("detects container runtimes from cgroup markers", () => {
    expect(
      detectKnownEnvironmentRuntime({
        readTextFile: (path) =>
          path === "/proc/1/cgroup" ? "0::/kubepods.slice/kubepods-besteffort.slice" : "",
      }),
    ).toMatchObject({
      isContainer: true,
      containerKind: "kubernetes",
    });

    expect(
      detectKnownEnvironmentRuntime({
        readTextFile: (path) =>
          path === "/proc/1/cgroup" ? "0::/system.slice/containerd.service" : "",
      }),
    ).toMatchObject({
      isContainer: true,
      containerKind: "containerd",
    });
  });

  it("detects generic CI and WSL release markers", () => {
    expect(
      detectKnownEnvironmentRuntime({
        env: {
          CI: "1",
        },
        release: "5.15.146.1-microsoft-standard-WSL2",
      }),
    ).toMatchObject({
      isCi: true,
      isWsl: true,
    });
  });
});

describe("scoped refs", () => {
  const environmentId = EnvironmentId.make("environment-test");
  const projectRef = scopeProjectRef(environmentId, ProjectId.make("project-1"));
  const threadRef = scopeThreadRef(environmentId, ThreadId.make("thread-1"));

  it("builds stable scoped project and thread keys", () => {
    expect(scopedRefKey(projectRef)).toBe("environment-test:project-1");
    expect(scopedRefKey(threadRef)).toBe("environment-test:thread-1");
    expect(scopedProjectKey(projectRef)).toBe("environment-test:project-1");
    expect(scopedThreadKey(threadRef)).toBe("environment-test:thread-1");
  });

  it("returns typed scoped refs", () => {
    expect(projectRef).toEqual({
      environmentId,
      projectId: ProjectId.make("project-1"),
    });
    expect(threadRef).toEqual({
      environmentId,
      threadId: ThreadId.make("thread-1"),
    });
  });

  it("parses scoped project and thread keys back into refs", () => {
    expect(parseScopedProjectKey("environment-test:project-1")).toEqual(projectRef);
    expect(parseScopedThreadKey("environment-test:thread-1")).toEqual(threadRef);
    expect(parseScopedProjectKey("bad-key")).toBeNull();
    expect(parseScopedThreadKey("bad-key")).toBeNull();
  });
});
