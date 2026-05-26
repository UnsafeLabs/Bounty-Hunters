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
  it("detects Docker from dockerenv", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        runtime: "node",
        platform: "linux",
        arch: "x64",
        fileExists: (path) => path === "/.dockerenv",
      }),
    ).toMatchObject({
      runtime: "node",
      platform: "linux",
      arch: "x64",
      isContainer: true,
      isCI: false,
      ciProvider: null,
      isWSL: false,
    });
  });

  it("detects containers from cgroup entries", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        platform: "linux",
        readFile: (path) =>
          path === "/proc/self/cgroup" ? "0::/system.slice/docker/test.scope" : null,
      }).isContainer,
    ).toBe(true);
  });

  it.each([
    ["GITHUB_ACTIONS", "github-actions"],
    ["GITLAB_CI", "gitlab"],
    ["JENKINS_URL", "jenkins"],
    ["CIRCLECI", "circleci"],
    ["TRAVIS", "travis"],
  ] as const)("detects %s as %s", (variableName, provider) => {
    expect(
      detectEnvironmentInfo({
        env: { [variableName]: "true" },
      }),
    ).toMatchObject({
      isCI: true,
      ciProvider: provider,
    });
  });

  it("detects generic CI without a provider name", () => {
    expect(detectEnvironmentInfo({ env: { CI: "true" } })).toMatchObject({
      isCI: true,
      ciProvider: null,
    });
  });

  it("detects WSL from proc version", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        platform: "linux",
        readFile: (path) => (path === "/proc/version" ? "Linux version Microsoft WSL2" : null),
      }).isWSL,
    ).toBe(true);
  });

  it("returns false flags when no container or CI signals exist", () => {
    expect(
      detectEnvironmentInfo({
        env: {},
        runtime: "browser",
        platform: "win32",
        arch: "x64",
      }),
    ).toMatchObject({
      runtime: "browser",
      platform: "win32",
      arch: "x64",
      isContainer: false,
      isCI: false,
      ciProvider: null,
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
