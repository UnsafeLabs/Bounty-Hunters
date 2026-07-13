import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
}));

import * as fs from "node:fs";
import {
  detectCI,
  detectCIProvider,
  detectDockerContainer,
  detectWSL,
  getEnvironmentInfo,
} from "./knownEnvironment.ts";

const mockFs = fs as unknown as {
  existsSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
};

describe("runtime environment detection", () => {
  beforeEach(() => {
    mockFs.existsSync.mockReset();
    mockFs.readFileSync.mockReset();
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockReturnValue("");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects docker via /.dockerenv", () => {
    mockFs.existsSync.mockImplementation((p: string) => p === "/.dockerenv");
    expect(detectDockerContainer()).toBe(true);
  });

  it("detects docker via cgroup entries", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockImplementation((p: string) =>
      p === "/proc/self/cgroup" ? "1:cpu:/kubepods/abc123" : "",
    );
    expect(detectDockerContainer()).toBe(true);
  });

  it("returns false when not in a container", () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });
    expect(detectDockerContainer()).toBe(false);
  });

  it("detects WSL via /proc/version Microsoft string", () => {
    mockFs.readFileSync.mockImplementation((p: string) =>
      p === "/proc/version" ? "Linux version 5.15 Microsoft" : "",
    );
    expect(detectWSL()).toBe(true);
  });

  it("returns false for WSL when not present", () => {
    mockFs.readFileSync.mockImplementation((p: string) =>
      p === "/proc/version" ? "Linux version 5.15 generic" : "",
    );
    expect(detectWSL()).toBe(false);
  });

  it("detects github-actions", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    expect(detectCIProvider()).toBe("github-actions");
    expect(detectCI()).toBe(true);
  });

  it("detects gitlab-ci", () => {
    vi.stubEnv("GITLAB_CI", "true");
    expect(detectCIProvider()).toBe("gitlab-ci");
  });

  it("detects jenkins", () => {
    vi.stubEnv("JENKINS_URL", "http://jenkins.local");
    expect(detectCIProvider()).toBe("jenkins");
  });

  it("detects circleci", () => {
    vi.stubEnv("CIRCLECI", "true");
    expect(detectCIProvider()).toBe("circleci");
  });

  it("detects travis", () => {
    vi.stubEnv("TRAVIS", "true");
    expect(detectCIProvider()).toBe("travis");
  });

  it("detects generic CI", () => {
    vi.stubEnv("CI", "true");
    expect(detectCIProvider()).toBe("ci");
  });

  it("returns null when not in CI", () => {
    expect(detectCIProvider()).toBeNull();
    expect(detectCI()).toBe(false);
  });

  it("returns a structured EnvironmentInfo object", () => {
    const info = getEnvironmentInfo();
    expect(info).toEqual(
      expect.objectContaining({
        runtime: expect.any(String),
        platform: expect.any(String),
        arch: expect.any(String),
        isContainer: expect.any(Boolean),
        isCI: expect.any(Boolean),
        ciProvider: expect.any(Object),
        isWSL: expect.any(Boolean),
      }),
    );
  });

  it("sets ciProvider to null when not in CI", () => {
    expect(getEnvironmentInfo().ciProvider).toBeNull();
  });
});
