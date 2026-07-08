import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { readFileSync, existsSync } from "fs";
import { env, platform, arch } from "process";

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
    label: descriptor.label,
  };
}

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
}

function detectContainer(): boolean {
  try {
    if (existsSync("/.dockerenv")) {
      return true;
    }
    const cgroup = readFileSync("/proc/self/cgroup", "utf-8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

function detectCI(): { isCI: boolean; ciProvider: string | null } {
  const ciProviders: Record<string, string> = {
    CI: "ci",
    GITHUB_ACTIONS: "github-actions",
    GITLAB_CI: "gitlab",
    JENKINS_URL: "jenkins",
    CIRCLECI: "circleci",
    TRAVIS: "travis",
  };

  for (const [envVar, provider] of Object.entries(ciProviders)) {
    if (env[envVar] !== undefined) {
      return { isCI: true, ciProvider: provider };
    }
  }

  return { isCI: false, ciProvider: null };
}

function detectWSL(): boolean {
  try {
    const version = readFileSync("/proc/version", "utf-8");
    return version.includes("Microsoft") || version.includes("microsoft");
  } catch {
    return false;
  }
}

function getRuntime(): string {
  if (typeof Bun !== "undefined") return "bun";
  if (typeof Deno !== "undefined") return "deno";
  if (typeof process !== "undefined" && process.versions?.node) return "node";
  if (typeof window !== "undefined") return "browser";
  return "unknown";
}

export function getEnvironmentInfo(): EnvironmentInfo {
  const { isCI, ciProvider } = detectCI();

  return {
    runtime: getRuntime(),
    platform: platform,
    arch: arch,
    isContainer: detectContainer(),
    isCI,
    ciProvider,
    isWSL: detectWSL(),
  };
}

export const environmentInfo: EnvironmentInfo = getEnvironmentInfo();
}
