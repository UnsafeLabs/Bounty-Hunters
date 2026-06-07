import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createKnownEnvironment,
  detectEnvironmentInfo,
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

describe("environment info detection", () => {
  it("returns runtime, platform, and arch while defaulting container and CI flags off", () => {
    expect(
      detectEnvironmentInfo({
        runtime: "node",
        platform: "linux",
        arch: "x64",
        env: {},
      }),
    ).toEqual({
      runtime: "node",
      platform: "linux",
      arch: "x64",
      isContainer: false,
      isCI: false,
      ciProvider: null,
      isWSL: false,
    });
  });

  it("detects Docker from /.dockerenv", () => {
    const info = detectEnvironmentInfo({
      env: {},
      fileExists: (path) => path === "/.dockerenv",
    });

    expect(info.isContainer).toBe(true);
  });

  it("detects container cgroup entries without throwing on missing files", () => {
    const info = detectEnvironmentInfo({
      env: {},
      readFile: (path) => (path === "/proc/1/cgroup" ? "0::/docker/test-id" : undefined),
    });

    expect(info.isContainer).toBe(true);
  });

  it.each([
    ["GITHUB_ACTIONS", "GitHub Actions"],
    ["GITLAB_CI", "GitLab CI"],
    ["JENKINS_URL", "Jenkins"],
    ["CIRCLECI", "CircleCI"],
    ["TRAVIS", "Travis CI"],
    ["CI", "Generic CI"],
  ] as const)("detects CI provider from %s", (envVar, provider) => {
    const info = detectEnvironmentInfo({
      env: { [envVar]: "true" },
    });

    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe(provider);
  });

  it("prefers specific CI provider over generic CI", () => {
    const info = detectEnvironmentInfo({
      env: {
        CI: "true",
        GITHUB_ACTIONS: "true",
      },
    });

    expect(info.ciProvider).toBe("GitHub Actions");
  });

  it("detects WSL from proc version text", () => {
    const info = detectEnvironmentInfo({
      env: {},
      readFile: (path) => (path === "/proc/version" ? "Linux version Microsoft WSL2" : undefined),
    });

    expect(info.isWSL).toBe(true);
  });

  it("detects WSL from environment fallback", () => {
    const info = detectEnvironmentInfo({
      env: {
        WSL_DISTRO_NAME: "Ubuntu",
      },
    });

    expect(info.isWSL).toBe(false);

    const interopInfo = detectEnvironmentInfo({
      env: {
        WSL_INTEROP: "/run/WSL/123_interop",
      },
    });

    expect(interopInfo.isWSL).toBe(true);
  });

  it("does not throw when file probes fail", () => {
    const info = detectEnvironmentInfo({
      env: {},
      fileExists: () => {
        throw new Error("permission denied");
      },
      readFile: () => {
        throw new Error("permission denied");
      },
    });

    expect(info.isContainer).toBe(false);
    expect(info.isWSL).toBe(false);
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
