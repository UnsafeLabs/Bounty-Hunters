import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vitest";

import { createKnownEnvironment, getKnownEnvironmentHttpBaseUrl } from "./knownEnvironment.ts";
import {
  parseScopedProjectKey,
  parseScopedThreadKey,
  scopedProjectKey,
  scopedRefKey,
  scopedThreadKey,
  scopeProjectRef,
  scopeThreadRef,
} from "./scoped.ts";
import { detectEnvironment } from "./knownEnvironment.ts";

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

describe("detectEnvironment", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    vi.restoreAllMocks();
  });

  it("detects runtime, platform, and arch", () => {
    const info = detectEnvironment();
    expect(info.runtime).toMatch(/^node-v/);
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });

  it("detects GitHub Actions CI", () => {
    process.env.GITHUB_ACTIONS = "true";
    const info = detectEnvironment();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("github");
    delete process.env.GITHUB_ACTIONS;
  });

  it("detects GitLab CI", () => {
    process.env.GITLAB_CI = "true";
    const info = detectEnvironment();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("gitlab");
    delete process.env.GITLAB_CI;
  });

  it("detects Jenkins CI", () => {
    process.env.JENKINS_URL = "http://jenkins.example.com";
    const info = detectEnvironment();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("jenkins");
    delete process.env.JENKINS_URL;
  });

  it("detects CircleCI", () => {
    process.env.CIRCLECI = "true";
    const info = detectEnvironment();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("circleci");
    delete process.env.CIRCLECI;
  });

  it("detects generic CI", () => {
    process.env.CI = "true";
    const info = detectEnvironment();
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("generic");
    delete process.env.CI;
  });

  it("returns isCI=false and ciProvider=null when not in CI", () => {
    // Ensure no CI env vars are set
    const ciVars = ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "TRAVIS"];
    const saved: Record<string, string | undefined> = {};
    for (const v of ciVars) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
    const info = detectEnvironment();
    expect(info.isCI).toBe(false);
    expect(info.ciProvider).toBeNull();
    // Restore
    for (const [k, v] of Object.entries(saved)) {
      if (v !== undefined) process.env[k] = v;
    }
  });

  it("does not throw when container files are missing", () => {
    // In a test environment, /proc/1/cgroup may or may not exist
    // detectEnvironment should handle this gracefully
    expect(() => detectEnvironment()).not.toThrow();
  });
});
