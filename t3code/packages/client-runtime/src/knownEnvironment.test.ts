import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  createKnownEnvironment,
  detectRuntimeEnvironment,
  getKnownEnvironmentHttpBaseUrl,
  type RuntimeEnvironmentInfo,
  type FsProvider,
} from "./knownEnvironment.ts";

function makeMockFs(overrides?: Partial<FsProvider>): FsProvider {
  const fs: FsProvider = {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    }),
  };
  return { ...fs, ...overrides };
}

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

// ---------------------------------------------------------------------------
// Runtime environment detection tests
// ---------------------------------------------------------------------------

describe("detectRuntimeEnvironment", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reports a known runtime name", () => {
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.runtime).toBe("node");
  });

  it("reports platform and arch from process", () => {
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.platform).toBe(process.platform);
    expect(info.arch).toBe(process.arch);
  });

  // ── CI detection ────────────────────────────────────────────────────

  it("detects GitHub Actions CI", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("GitHub Actions");
  });

  it("detects GitLab CI", () => {
    vi.stubEnv("GITLAB_CI", "true");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("GitLab CI");
  });

  it("detects Jenkins CI", () => {
    vi.stubEnv("JENKINS_URL", "https://jenkins.example.com");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("Jenkins");
  });

  it("detects CircleCI", () => {
    vi.stubEnv("CIRCLECI", "true");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("CircleCI");
  });

  it("detects Travis CI", () => {
    vi.stubEnv("TRAVIS", "true");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("Travis CI");
  });

  it("uses generic CI label when only CI env var is set", () => {
    vi.stubEnv("CI", "true");
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(true);
    expect(info.ciProvider).toBe("generic CI");
  });

  it("reports not in CI when no CI env vars are present", () => {
    for (const key of ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "TRAVIS"]) {
      vi.stubEnv(key, "");
    }
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isCI).toBe(false);
    expect(info.ciProvider).toBeNull();
  });

  // ── Docker detection ────────────────────────────────────────────────

  it("detects Docker when /.dockerenv exists", () => {
    const mockFs = makeMockFs({ existsSync: vi.fn().mockReturnValue(true) });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isContainer).toBe(true);
  });

  it("detects Docker when /proc/1/cgroup contains docker", () => {
    const mockFs = makeMockFs({
      readFileSync: vi.fn().mockImplementation((path: string) => {
        if (path === "/proc/1/cgroup") return "0::/system.slice/docker-abc123.scope";
        throw new Error("ENOENT");
      }),
    });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isContainer).toBe(true);
  });

  it("reports not in container when neither /.dockerenv nor cgroup match", () => {
    const existsSync = vi.fn().mockReturnValue(false);
    const readFileSync = vi.fn().mockImplementation((path: string) => {
      if (path === "/proc/1/cgroup") return "0::/system.slice/vanilla.scope";
      throw new Error("ENOENT");
    });
    const info = detectRuntimeEnvironment({ existsSync, readFileSync });
    expect(info.isContainer).toBe(false);
  });

  // ── WSL detection ───────────────────────────────────────────────────

  it("detects WSL when /proc/version contains microsoft (case-insensitive)", () => {
    const mockFs = makeMockFs({
      readFileSync: vi.fn().mockImplementation((path: string) => {
        if (path === "/proc/version") return "Linux version 5.10.16.3-microsoft-standard-WSL2";
        throw new Error("ENOENT");
      }),
    });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isWSL).toBe(true);
  });

  it("detects WSL with lowercase microsoft marker", () => {
    const mockFs = makeMockFs({
      readFileSync: vi.fn().mockImplementation((path: string) => {
        if (path === "/proc/version") return "Linux version 5.15.0-microsoft-standard-WSL2";
        throw new Error("ENOENT");
      }),
    });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isWSL).toBe(true);
  });

  it("reports not in WSL when /proc/version does not mention microsoft", () => {
    const mockFs = makeMockFs({
      readFileSync: vi.fn().mockImplementation((path: string) => {
        if (path === "/proc/version") return "Linux version 6.8.0-45-generic";
        throw new Error("ENOENT");
      }),
    });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isWSL).toBe(false);
  });

  // ── Default / fallback behaviour ────────────────────────────────────

  it("reports not in a container and not in WSL with default mock", () => {
    const info = detectRuntimeEnvironment(makeMockFs());
    expect(info.isContainer).toBe(false);
    expect(info.isWSL).toBe(false);
  });

  it("returns a complete RuntimeEnvironmentInfo object", () => {
    const info = detectRuntimeEnvironment(makeMockFs());
    const keys: Array<keyof RuntimeEnvironmentInfo> = [
      "runtime",
      "platform",
      "arch",
      "isContainer",
      "isCI",
      "ciProvider",
      "isWSL",
    ];
    for (const key of keys) {
      expect(info).toHaveProperty(key);
    }
  });

  it("gracefully handles null fs (browser or permission-restricted context)", () => {
    const info = detectRuntimeEnvironment(null);
    expect(info.isContainer).toBe(false);
    expect(info.isCI).toBe(false);
    expect(info.isWSL).toBe(false);
  });

  it("gracefully handles fs read errors (permission denied)", () => {
    const mockFs = makeMockFs({
      existsSync: vi.fn().mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      }),
      readFileSync: vi.fn().mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      }),
    });
    const info = detectRuntimeEnvironment(mockFs);
    expect(info.isContainer).toBe(false);
    expect(info.isWSL).toBe(false);
  });
});
