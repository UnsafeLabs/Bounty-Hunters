import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { existsSync, readFileSync } from "node:fs";

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

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
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

// --- Container / CI / WSL Detection ---

const CI_ENV_VARS: Record<string, string> = {
  CI: "generic",
  GITHUB_ACTIONS: "github",
  GITLAB_CI: "gitlab",
  JENKINS_URL: "jenkins",
  CIRCLECI: "circleci",
  TRAVIS: "travis",
  BUILDKITE: "buildkite",
  DRONE: "drone",
  TEAMCITY_VERSION: "teamcity",
  AZURE_PIPELINES: "azure",
};

function isDockerContainer(): boolean {
  try {
    if (existsSync("/.dockerenv")) {
      return true;
    }
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

function isWSL(): boolean {
  try {
    const version = readFileSync("/proc/version", "utf8");
    return version.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function detectCI(): { isCI: boolean; ciProvider: string | null } {
  for (const [envVar, provider] of Object.entries(CI_ENV_VARS)) {
    if (process.env[envVar]) {
      return { isCI: true, ciProvider: provider };
    }
  }
  return { isCI: false, ciProvider: null };
}

export function detectEnvironment(): EnvironmentInfo {
  const { isCI, ciProvider } = detectCI();

  return {
    runtime: `node-${process.version}`,
    platform: process.platform,
    arch: process.arch,
    isContainer: isDockerContainer(),
    isCI,
    ciProvider,
    isWSL: isWSL(),
  };
}
