import { describe, it, expect } from "vitest";
import {
  detectCIProvider,
  detectDockerSync,
  detectWSLSync,
  detectEnvironmentSync,
  type CIProvider,
} from "./environmentDetection";

describe("detectCIProvider", () => {
  it("detects GitHub Actions", () => {
    const getEnv = (key: string) =>
      key === "GITHUB_ACTIONS" ? "true" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("github-actions");
  });

  it("detects GitLab CI", () => {
    const getEnv = (key: string) =>
      key === "GITLAB_CI" ? "true" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("gitlab-ci");
  });

  it("detects Jenkins", () => {
    const getEnv = (key: string) =>
      key === "JENKINS_URL" ? "http://jenkins:8080" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("jenkins");
  });

  it("detects CircleCI", () => {
    const getEnv = (key: string) =>
      key === "CIRCLECI" ? "true" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("circleci");
  });

  it("detects Travis CI", () => {
    const getEnv = (key: string) =>
      key === "TRAVIS" ? "true" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("travis");
  });

  it("detects generic CI=true with unknown provider", () => {
    const getEnv = (key: string) =>
      key === "CI" ? "true" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("unknown");
  });

  it("returns false when no CI env vars set", () => {
    const getEnv = () => undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(false);
    expect(result.ciProvider).toBeNull();
  });

  it("ignores CI=false", () => {
    const getEnv = (key: string) =>
      key === "CI" ? "false" : undefined;
    const result = detectCIProvider(getEnv);
    expect(result.isCI).toBe(false);
  });
});

describe("detectDockerSync", () => {
  it("detects Docker via cgroup", () => {
    const readFileSync = (path: string) => {
      if (path === "/proc/1/cgroup") return "12:pids:/docker/abc123\n";
      return null;
    };
    expect(detectDockerSync(readFileSync)).toBe(true);
  });

  it("detects Docker via /.dockerenv", () => {
    const readFileSync = (path: string) => {
      if (path === "/.dockerenv") return "";
      return null;
    };
    expect(detectDockerSync(readFileSync)).toBe(true);
  });

  it("detects Kubernetes via cgroup", () => {
    const readFileSync = (path: string) => {
      if (path === "/proc/1/cgroup") return "10:memory:/kubepods/pod123\n";
      return null;
    };
    expect(detectDockerSync(readFileSync)).toBe(true);
  });

  it("returns false when not in container", () => {
    const readFileSync = () => null;
    expect(detectDockerSync(readFileSync)).toBe(false);
  });
});

describe("detectWSLSync", () => {
  it("detects WSL via /proc/version with Microsoft", () => {
    const readFileSync = (path: string) => {
      if (path === "/proc/version")
        return "Linux version 5.15.0-microsoft-standard-WSL2";
      return null;
    };
    expect(detectWSLSync(readFileSync)).toBe(true);
  });

  it("detects WSL via /proc/version with WSL", () => {
    const readFileSync = (path: string) => {
      if (path === "/proc/version")
        return "Linux version 5.10.0 (wsl2@build)";
      return null;
    };
    expect(detectWSLSync(readFileSync)).toBe(true);
  });

  it("returns false on regular Linux", () => {
    const readFileSync = (path: string) => {
      if (path === "/proc/version")
        return "Linux version 5.15.0-generic";
      return null;
    };
    expect(detectWSLSync(readFileSync)).toBe(false);
  });

  it("returns false when /proc/version not available", () => {
    const readFileSync = () => null;
    expect(detectWSLSync(readFileSync)).toBe(false);
  });
});

describe("detectEnvironmentSync", () => {
  it("returns structured EnvironmentInfo", () => {
    const getEnv = (key: string) =>
      key === "GITHUB_ACTIONS" ? "true" : undefined;
    const readFileSync = () => null;

    const result = detectEnvironmentSync(getEnv, readFileSync);
    expect(result.isCI).toBe(true);
    expect(result.ciProvider).toBe("github-actions");
    expect(result.isContainer).toBe(false);
    expect(result.isWSL).toBe(false);
    expect(result.runtime).toBeDefined();
    expect(result.platform).toBeDefined();
    expect(result.arch).toBeDefined();
  });
});
