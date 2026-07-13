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


export interface EnvironmentInfo {
  readonly runtime: "node" | "browser" | "unknown";
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
}

const CI_PROVIDERS: ReadonlyArray<readonly [string, string]> = [
  ["GITHUB_ACTIONS", "github-actions"],
  ["GITLAB_CI", "gitlab-ci"],
  ["JENKINS_URL", "jenkins"],
  ["CIRCLECI", "circleci"],
  ["TRAVIS", "travis"],
  ["CI", "ci"],
];

export function detectCIProvider(
  env: Readonly<Record<string, string | undefined>>,
): string | null {
  for (const [key, provider] of CI_PROVIDERS) {
    const value = env[key];
    if (value !== undefined && value !== "") {
      return provider;
    }
  }
  return null;
}

export function detectContainer(readText: (path: string) => string | null): boolean {
  if (readText("/.dockerenv") !== null) {
    return true;
  }
  const cgroup = readText("/proc/1/cgroup");
  if (cgroup !== null && /docker|containerd|kubepods|github|actions/i.test(cgroup)) {
    return true;
  }
  return false;
}

export function detectWSL(readText: (path: string) => string | null): boolean {
  const version = readText("/proc/version");
  return version !== null && /microsoft/i.test(version);
}

function createSafeReadText(): (path: string) => string | null {
  return (path: string) => {
    try {
      const req = (globalThis as { require?: (id: string) => unknown }).require;
      if (typeof req !== "function") {
        return null;
      }
      const fs = req("node:fs") as
        | { readFileSync: (path: string, encoding: string) => string }
        | undefined;
      if (!fs || typeof fs.readFileSync !== "function") {
        return null;
      }
      return fs.readFileSync(path, "utf8");
    } catch {
      return null;
    }
  };
}

export function detectEnvironmentInfo(): EnvironmentInfo {
  const g = globalThis as {
    process?: { platform?: unknown; arch?: unknown; env?: Record<string, string | undefined> };
    window?: unknown;
  };
  const hasProcess = typeof g.process !== "undefined";
  const hasWindow = typeof g.window !== "undefined";
  const runtime: EnvironmentInfo["runtime"] = hasProcess && !hasWindow
    ? "node"
    : hasWindow
      ? "browser"
      : "unknown";
  const env = hasProcess && g.process?.env ? g.process.env : {};
  const platform = hasProcess
    ? String(g.process?.platform ?? "unknown")
    : typeof navigator !== "undefined" && navigator.platform
      ? navigator.platform
      : "unknown";
  const arch = hasProcess ? String(g.process?.arch ?? "unknown") : "unknown";

  const ciProvider = detectCIProvider(env);
  const readText = createSafeReadText();
  const isContainer = detectContainer(readText);
  const isWSL = platform === "linux" ? detectWSL(readText) : false;

  return {
    runtime,
    platform,
    arch,
    isContainer,
    isCI: ciProvider !== null,
    ciProvider,
    isWSL,
  };
}
