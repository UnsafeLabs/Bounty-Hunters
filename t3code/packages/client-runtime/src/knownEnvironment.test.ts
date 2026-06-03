// @ts-nocheck
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock("fs", () => {
  return {
    existsSync: (p: string) => mockExistsSync(p),
    readFileSync: (p: string, encoding: string) => mockReadFileSync(p, encoding),
  };
});

import { createKnownEnvironment, getKnownEnvironmentHttpBaseUrl, getEnvironmentInfo } from "./knownEnvironment.ts";
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

describe("getEnvironmentInfo", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    // Clear CI/Actions/etc env vars
    const envKeys = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "TRAVIS"];
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore original env vars
    const envKeys = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "TRAVIS"];
    for (const key of envKeys) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("identifies platform, arch, and runtime correctly", () => {
    const info = getEnvironmentInfo();
    expect(info.runtime).toBe(typeof (process.versions as any)?.bun !== "undefined" ? "bun" : "node");
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });

  it("detects docker container via /.dockerenv file presence", () => {
    mockExistsSync.mockImplementation((p) => p === "/.dockerenv");
    const info = getEnvironmentInfo();
    expect(info.isContainer).toBe(true);
    expect(info.isWSL).toBe(false);
  });

  it("detects docker container via cgroup file contents", () => {
    mockExistsSync.mockImplementation((p) => p === "/proc/self/cgroup");
    mockReadFileSync.mockImplementation((p) => {
      if (p === "/proc/self/cgroup") {
        return "1:name=systemd:/docker/1234abcd";
      }
      return "";
    });
    const info = getEnvironmentInfo();
    expect(info.isContainer).toBe(true);
  });

  it("detects WSL environment via proc/version Microsoft string", () => {
    mockExistsSync.mockImplementation((p) => p === "/proc/version");
    mockReadFileSync.mockImplementation((p) => {
      if (p === "/proc/version") {
        return "Linux version 5.15.0-microsoft-standard-WSL2";
      }
      return "";
    });
    const info = getEnvironmentInfo();
    expect(info.isWSL).toBe(true);
  });

  it("detects various CI environments and providers", () => {
    // 1. GitHub Actions
    process.env.GITHUB_ACTIONS = "true";
    let info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("GitHub Actions");

    // 2. GitLab CI
    delete process.env.GITHUB_ACTIONS;
    process.env.GITLAB_CI = "true";
    info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("GitLab CI");

    // 3. Jenkins
    delete process.env.GITLAB_CI;
    process.env.JENKINS_URL = "http://jenkins.local";
    info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("Jenkins");

    // 4. CircleCI
    delete process.env.JENKINS_URL;
    process.env.CIRCLECI = "true";
    info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("CircleCI");

    // 5. Travis CI
    delete process.env.CIRCLECI;
    process.env.TRAVIS = "true";
    info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("Travis CI");

    // 6. Generic CI
    delete process.env.TRAVIS;
    process.env.CI = "true";
    info = getEnvironmentInfo();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("CI");
  });

  it("returns default values when not in container, CI, or WSL", () => {
    mockExistsSync.mockReturnValue(false);
    const info = getEnvironmentInfo();
    expect(info.isContainer).toBe(false);
    expect(info.isCI).toBe(false);
    expect(info.ciProvider).toBeNull();
    expect(info.isWSL).toBe(false);
  });
});

