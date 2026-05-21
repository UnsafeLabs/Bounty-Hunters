import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

export interface KnownEnvironmentConnectionTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type KnownEnvironmentSource = "configured" | "desktop-managed" | "manual" | "window-origin";

export interface KnownEnvironment {
  readonly id: string;
  readonly label: string;
  readonly source: KnownEnvironmentSource;
  readonly environmentId?: EnvironmentId;
  readonly target: KnownEnvironmentConnectionTarget;
}

export function createKnownEnvironment(input: {
  readonly id?: string;
  readonly label: string;
  readonly source?: KnownEnvironmentSource;
  readonly target: KnownEnvironmentConnectionTarget;
}): KnownEnvironment {
  return {
    id: input.id ?? `ws:${input.label}`,
    label: input.label,
    source: input.source ?? "manual",
    target: input.target,
  };
}

export function getKnownEnvironmentWsBaseUrl(
  environment: KnownEnvironment | null | undefined,
): string | null {
  return environment?.target.wsBaseUrl ?? null;
}

export function getKnownEnvironmentHttpBaseUrl(
  environment: KnownEnvironment | null | undefined,
): string | null {
  return environment?.target.httpBaseUrl ?? null;
}

export function attachEnvironmentDescriptor(
  environment: KnownEnvironment,
  descriptor: ExecutionEnvironmentDescriptor,
): KnownEnvironment {
  return {
    ...environment,
    environmentId: descriptor.environmentId,
    label: descriptor.label,
  };
}

// ---------------------------------------------------------------------------
// Runtime environment detection (Docker, CI, WSL)
// ---------------------------------------------------------------------------

export interface RuntimeEnvironmentInfo {
  /** The runtime name (e.g. "node", "browser", "bun", "deno"). */
  readonly runtime: string;
  /** The OS platform (e.g. "linux", "win32", "darwin"). */
  readonly platform: string;
  /** The CPU architecture (e.g. "x64", "arm64"). */
  readonly arch: string;
  /** Whether the process is running inside a Docker container. */
  readonly isContainer: boolean;
  /** Whether the process is running inside a CI environment. */
  readonly isCI: boolean;
  /** The name of the CI provider when isCI is true, otherwise null. */
  readonly ciProvider: string | null;
  /** Whether the process is running under WSL (Windows Subsystem for Linux). */
  readonly isWSL: boolean;
}

/** Minimal filesystem interface used by Docker / WSL detection. */
export interface FsProvider {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
}

// Map well-known CI environment variables to provider names.
const CI_PROVIDERS: ReadonlyArray<[string, string]> = [
  ["GITHUB_ACTIONS", "GitHub Actions"],
  ["GITLAB_CI", "GitLab CI"],
  ["JENKINS_URL", "Jenkins"],
  ["CIRCLECI", "CircleCI"],
  ["TRAVIS", "Travis CI"],
  ["CI", "generic CI"],
];

/**
 * Detect whether the current process is running inside a Docker container.
 * Checks for the `/.dockerenv` file or `/proc/1/cgroup` entries containing
 * "docker".  Returns `false` when the file system checks are unavailable
 * (e.g. browser, Deno without --allow-read).
 */
function detectDocker(fs: FsProvider | null): boolean {
  if (!fs) return false;

  try {
    if (fs.existsSync("/.dockerenv")) return true;

    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf8");
    return cgroup.includes("docker");
  } catch {
    return false;
  }
}

/**
 * Detect whether the current process is running inside a CI environment.
 * Returns `[true, "GitHub Actions"]` or `[true, "generic CI"]` etc.
 * Returns `[false, null]` when no CI env vars are present.
 */
function detectCI(): [isCI: boolean, provider: string | null] {
  if (typeof process === "undefined" || !process.env) {
    return [false, null];
  }

  for (const [envVar, provider] of CI_PROVIDERS) {
    if (process.env[envVar]) return [true, provider];
  }
  return [false, null];
}

/**
 * Detect whether the current process is running under WSL.
 * Checks `/proc/version` for the presence of "Microsoft" or "microsoft"
 * (WSL1 indicates via "Microsoft", WSL2 via "microsoft").
 */
function detectWSL(fs: FsProvider | null): boolean {
  if (!fs) return false;

  try {
    const version = fs.readFileSync("/proc/version", "utf8");
    return /microsoft/i.test(version);
  } catch {
    return false;
  }
}

/**
 * Resolve the `fs` module at runtime.  Returns `null` when the module
 * is unavailable (e.g. browser bundlers, Deno without Node compat).
 */
function resolveNodeFs(): FsProvider | null {
  if (typeof process === "undefined" || !process.env) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    return require("fs") as unknown as FsProvider;
  } catch {
    return null;
  }
}

/**
 * Detect the current runtime environment and return a structured
 * `RuntimeEnvironmentInfo` object.
 *
 * Safe to call in browser, Node.js, Bun, and Deno — detection degrades
 * gracefully when file system or environment access is unavailable.
 *
 * @param fs - Optional filesystem provider for testing. When omitted the
 *   function attempts to resolve `fs` at runtime via `require("fs")`.
 */
export function detectRuntimeEnvironment(fs?: FsProvider | null): RuntimeEnvironmentInfo {
  const runtime = typeof process !== "undefined"
    ? process.release?.name === "node"
      ? "node"
      : typeof Bun !== "undefined"
        ? "bun"
        : typeof Deno !== "undefined"
          ? "deno"
          : typeof process?.versions?.node !== "undefined"
            ? "node"
            : "unknown"
    : typeof window !== "undefined"
      ? "browser"
      : "unknown";

  const platform = typeof process !== "undefined"
    ? process.platform
    : typeof navigator !== "undefined"
      ? navigator.platform.toLowerCase()
      : "unknown";

  const arch = typeof process !== "undefined"
    ? process.arch
    : "unknown";

  const nodeFs = fs ?? resolveNodeFs();
  const isContainer = detectDocker(nodeFs);
  const [isCI, ciProvider] = detectCI();
  const isWSL = detectWSL(nodeFs);

  return {
    runtime,
    platform,
    arch,
    isContainer,
    isCI,
    ciProvider,
    isWSL,
  };
}
