import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  createKnownEnvironment,
  detectEnvironmentInfo,
  getKnownEnvironmentHttpBaseUrl,
  type CiProvider,
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
  it("returns runtime, platform, and arch without container or CI flags by default", () => {
    expect(
      detectEnvironmentInfo({
        arch: "x64",
        env: {},
        platform: "linux",
        runtime: "node",
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

  it("detects Docker from the container marker file", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        fileExists: (path) => path === "/.dockerenv",
      }).isContainer,
    ).toBe(true);
  });

  it("detects containers from cgroup markers", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        readTextFile: (path) =>
          path === "/proc/1/cgroup"
            ? "0::/system.slice/containerd.service/kubepods-burstable-pod123"
            : null,
      }).isContainer,
    ).toBe(true);
  });

  it.each([
    ["GITHUB_ACTIONS", "github-actions"],
    ["GITLAB_CI", "gitlab-ci"],
    ["JENKINS_URL", "jenkins"],
    ["CIRCLECI", "circleci"],
    ["TRAVIS", "travis"],
    ["CI", "generic"],
  ] satisfies ReadonlyArray<readonly [string, CiProvider]>)(
    "detects %s as %s",
    (envName, expectedProvider) => {
      const info = detectEnvironmentInfo({
        env: {
          [envName]: "true",
        },
      });

      expect(info.isCI).toBe(true);
      expect(info.ciProvider).toBe(expectedProvider);
    },
  );

  it("does not treat false-like CI values as CI", () => {
    const info = detectEnvironmentInfo({
      env: {
        CI: "false",
        GITHUB_ACTIONS: "0",
      },
    });

    expect(info.isCI).toBe(false);
    expect(info.ciProvider).toBeNull();
  });

  it("detects WSL from proc version text", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        readTextFile: (path) =>
          path === "/proc/version" ? "Linux version 5.15.90.1-microsoft-standard-WSL2" : null,
      }).isWSL,
    ).toBe(true);
  });

  it("does not throw when file system probes are unavailable or fail", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        fileExists: () => {
          throw new Error("permission denied");
        },
        readTextFile: () => {
          throw new Error("missing procfs");
        },
      }),
    ).toMatchObject({
      isContainer: false,
      isWSL: false,
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
