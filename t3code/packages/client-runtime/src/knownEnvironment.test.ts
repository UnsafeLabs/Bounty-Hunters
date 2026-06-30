import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createKnownEnvironment,
  detectRuntimeEnvironment,
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
});

describe("runtime environment detection", () => {
  it("detects container, ci, and wsl signals from injected readers", () => {
    expect(
      detectRuntimeEnvironment({
        runtime: "node",
        platform: "linux",
        arch: "x64",
        env: {
          CI: "true",
          GITHUB_ACTIONS: "true",
          WSL_DISTRO_NAME: "Ubuntu",
        },
        pathExists: (path) => path === "/.dockerenv",
        readTextFile: (path) =>
          path === "/proc/1/cgroup"
            ? "0::/docker/123"
            : path === "/proc/version"
              ? "Linux microsoft"
              : null,
      }),
    ).toEqual({
      runtime: "node",
      platform: "linux",
      arch: "x64",
      isContainer: true,
      isCi: true,
      ciProvider: "github-actions",
      isWsl: true,
    });
  });

  it("detects ci providers from provider-specific environment variables", () => {
    expect(
      detectRuntimeEnvironment({
        env: {
          CI: "true",
          GITLAB_CI: "true",
        },
      }),
    ).toMatchObject({
      isCi: true,
      ciProvider: "gitlab-ci",
    });
  });

  it("falls back to a non-container desktop-friendly snapshot when no signals are present", () => {
    expect(
      detectRuntimeEnvironment({
        runtime: "browser",
        platform: "darwin",
        arch: "arm64",
        env: {},
      }),
    ).toEqual({
      runtime: "browser",
      platform: "darwin",
      arch: "arm64",
      isContainer: false,
      isCi: false,
      ciProvider: null,
      isWsl: false,
    });
  });

  it("treats ci-only environments as ci even when no named provider matches", () => {
    expect(
      detectRuntimeEnvironment({
        env: {
          CI: "true",
        },
      }),
    ).toMatchObject({
      isCi: true,
      ciProvider: null,
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
