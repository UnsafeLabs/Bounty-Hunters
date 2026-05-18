import type { EnvironmentId } from "@t3tools/contracts";

// ─── Types ────────────────────────────────────────────────────────────────

export interface EnvironmentInfo {
  /** The detected runtime (e.g. "node", "browser", "deno", "bun") */
  readonly runtime: string;
  /** The OS platform (e.g. "linux", "darwin", "win32") */
  readonly platform: string;
  /** The CPU architecture (e.g. "x64", "arm64") */
  readonly arch: string;
  /** Whether the app is running inside a Docker container */
  readonly isContainer: boolean;
  /** Whether the app is running inside a CI environment */
  readonly isCI: boolean;
  /** The detected CI provider, if any */
  readonly ciProvider: CIProvider | null;
  /** Whether the app is running on Windows Subsystem for Linux */
  readonly isWSL: boolean;
}

export type CIProvider =
  | "github-actions"
  | "gitlab-ci"
  | "jenkins"
  | "circleci"
  | "travis"
  | "buildkite"
  | "azure-pipelines"
  | "vercel"
  | "netlify"
  | "unknown";

// ─── CI Detection ─────────────────────────────────────────────────────────

const CI_ENV_MAP: ReadonlyArray<{ envVar: string; provider: CIProvider }> = [
  { envVar: "GITHUB_ACTIONS", provider: "github-actions" },
  { envVar: "GITLAB_CI", provider: "gitlab-ci" },
  { envVar: "JENKINS_URL", provider: "jenkins" },
  { envVar: "CIRCLECI", provider: "circleci" },
  { envVar: "TRAVIS", provider: "travis" },
  { envVar: "BUILDKITE", provider: "buildkite" },
  { envVar: "TF_BUILD", provider: "azure-pipelines" }, // Azure DevOps
  { envVar: "VERCEL", provider: "vercel" },
  { envVar: "NETLIFY", provider: "netlify" },
];

/**
 * Detect CI environment by checking well-known environment variables.
 * Returns the specific CI provider, or null if not in CI.
 */
export function detectCIProvider(
  getEnv: (key: string) => string | undefined = getDefaultEnvGetter(),
): { isCI: boolean; ciProvider: CIProvider | null } {
  // Generic CI flag — many providers set this
  const ciFlag = getEnv("CI");
  if (ciFlag === "true" || ciFlag === "1") {
    // Check for specific provider first
    for (const { envVar, provider } of CI_ENV_MAP) {
      const value = getEnv(envVar);
      if (value !== undefined && value !== "" && value !== "false") {
        return { isCI: true, ciProvider: provider };
      }
    }
    // CI=true but no specific provider matched
    return { isCI: true, ciProvider: "unknown" };
  }

  // Even without CI=true, check specific providers
  for (const { envVar, provider } of CI_ENV_MAP) {
    const value = getEnv(envVar);
    if (value !== undefined && value !== "" && value !== "false") {
      return { isCI: true, ciProvider: provider };
    }
  }

  return { isCI: false, ciProvider: null };
}

// ─── Docker Detection ─────────────────────────────────────────────────────

/**
 * Detect whether the app is running inside a Docker container.
 * Checks for /.dockerenv file and docker indicators in /proc/1/cgroup.
 * In browser environments, always returns false.
 */
export async function detectDocker(
  readFile: (path: string) => Promise<string | null> = getDefaultFileReader(),
): Promise<boolean> {
  // Check /.dockerenv (Docker creates this file in containers)
  const dockerEnv = await readFile("/.dockerenv");
  if (dockerEnv !== null) return true;

  // Check cgroup for docker indicators
  const cgroup = await readFile("/proc/1/cgroup");
  if (cgroup !== null && /docker|kubepods/i.test(cgroup)) return true;

  return false;
}

/**
 * Synchronous Docker detection (cgroup only — cannot check files sync in browser).
 * For full detection use the async version.
 */
export function detectDockerSync(
  readFileSync: (path: string) => string | null = getDefaultFileSyncReader(),
): boolean {
  const cgroup = readFileSync("/proc/1/cgroup");
  if (cgroup !== null && /docker|kubepods/i.test(cgroup)) return true;

  const dockerEnv = readFileSync("/.dockerenv");
  if (dockerEnv !== null) return true;

  return false;
}

// ─── WSL Detection ────────────────────────────────────────────────────────

/**
 * Detect whether the app is running on Windows Subsystem for Linux.
 * Checks /proc/version for "Microsoft" or "WSL" strings.
 */
export async function detectWSL(
  readFile: (path: string) => Promise<string | null> = getDefaultFileReader(),
): Promise<boolean> {
  const version = await readFile("/proc/version");
  if (version !== null && /microsoft|wsl/i.test(version)) return true;
  return false;
}

/**
 * Synchronous WSL detection.
 */
export function detectWSLSync(
  readFileSync: (path: string) => string | null = getDefaultFileSyncReader(),
): boolean {
  const version = readFileSync("/proc/version");
  if (version !== null && /microsoft|wsl/i.test(version)) return true;
  return false;
}

// ─── Full Environment Detection ───────────────────────────────────────────

/**
 * Detect the full environment info: runtime, platform, arch, container, CI, WSL.
 * Uses async detection for Docker (file reads) and WSL.
 */
export async function detectEnvironment(
  getEnv?: (key: string) => string | undefined,
  readFile?: (path: string) => Promise<string | null>,
): Promise<EnvironmentInfo> {
  const { isCI, ciProvider } = detectCIProvider(getEnv);
  const isContainer = await detectDocker(readFile);
  const isWSL = await detectWSL(readFile);

  return {
    runtime: detectRuntime(),
    platform: detectPlatform(),
    arch: detectArch(),
    isContainer,
    isCI,
    ciProvider,
    isWSL,
  };
}

/**
 * Synchronous environment detection (no file reads for Docker/WSL).
 * Uses process.env checks only. Docker/WSL will be false unless cgroup is readable.
 */
export function detectEnvironmentSync(
  getEnv?: (key: string) => string | undefined,
  readFileSync?: (path: string) => string | null,
): EnvironmentInfo {
  const { isCI, ciProvider } = detectCIProvider(getEnv);
  const isContainer = detectDockerSync(readFileSync);
  const isWSL = detectWSLSync(readFileSync);

  return {
    runtime: detectRuntime(),
    platform: detectPlatform(),
    arch: detectArch(),
    isContainer,
    isCI,
    ciProvider,
    isWSL,
  };
}

// ─── Runtime / Platform / Arch ────────────────────────────────────────────

function detectRuntime(): string {
  if (typeof Deno !== "undefined") return "deno";
  if (typeof Bun !== "undefined") return "bun";
  if (typeof process !== "undefined" && typeof process.versions?.node === "string") return "node";
  if (typeof navigator !== "undefined" && typeof window !== "undefined") return "browser";
  return "unknown";
}

function detectPlatform(): string {
  if (typeof process !== "undefined" && process.platform) return process.platform;
  if (typeof navigator !== "undefined" && navigator.platform) {
    const p = navigator.platform.toLowerCase();
    if (p.includes("win")) return "win32";
    if (p.includes("mac")) return "darwin";
    if (p.includes("linux")) return "linux";
    return p;
  }
  return "unknown";
}

function detectArch(): string {
  if (typeof process !== "undefined" && process.arch) return process.arch;
  if (typeof navigator !== "undefined" && navigator.userAgent) {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("arm") || ua.includes("aarch64")) return "arm64";
    if (ua.includes("x86_64") || ua.includes("x64") || ua.includes("amd64")) return "x64";
  }
  return "unknown";
}

// ─── Default I/O helpers ──────────────────────────────────────────────────

function getDefaultEnvGetter(): (key: string) => string | undefined {
  if (typeof process !== "undefined" && process.env) {
    return (key: string) => process.env[key];
  }
  return () => undefined;
}

function getDefaultFileReader(): (path: string) => Promise<string | null> {
  // In browser, file reads are not available
  if (typeof window !== "undefined") {
    return async () => null;
  }
  // In Node, use dynamic import to avoid bundling fs in browser builds
  return async (path: string) => {
    try {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(path, "utf-8");
      return content;
    } catch {
      return null;
    }
  };
}

function getDefaultFileSyncReader(): (path: string) => string | null {
  if (typeof window !== "undefined") {
    return () => null;
  }
  try {
    const fs = require("node:fs");
    return (path: string) => {
      try {
        return fs.readFileSync(path, "utf-8");
      } catch {
        return null;
      }
    };
  } catch {
    return () => null;
  }
}
