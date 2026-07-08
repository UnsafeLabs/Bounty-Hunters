import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import { readFileSync, existsSync } from "fs";

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
    label: descriptor.label,
  };
}

export interface EnvironmentInfo {
  runtime: string;
  platform: string;
  arch: string;
  isContainer: boolean;
  isCI: boolean;
  ciProvider: string | null;
  isWSL: boolean;
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
  const ciProviders: [string, string][] = [
    ["CI", "generic"],
    ["GITHUB_ACTIONS", "github"],
    ["GITLAB_CI", "gitlab"],
    ["JENKINS_URL", "jenkins"],
    ["CIRCLECI", "circleci"],
    ["TRAVIS", "travis"],
  ];

  for (const [envVar, provider] of ciProviders) {
    if (process.env[envVar]) {
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

export function getEnvironmentInfo(): EnvironmentInfo {
  const { isCI, ciProvider } = detectCI();

  return {
    runtime: (() => {
      if (typeof Bun !== "undefined") return "bun";
      if (typeof Deno !== "undefined") return "deno";
      if (typeof process !== "undefined" && process.versions?.node) return "node";
      if (typeof window !== "undefined") return "browser";
      return "unknown";
    })(),
    platform: (() => {
      if (typeof process !== "undefined" && process.platform) return process.platform;
      if (typeof navigator !== "undefined" && navigator.platform) return navigator.platform;
      return "unknown";
    })(),
    arch: (() => {
      if (typeof process !== "undefined" && process.arch) return process.arch;
      return "unknown";
    })(),
    isContainer: detectContainer(),
    isCI,
    ciProvider,
    isWSL: detectWSL(),
  };
}
    environmentId: descriptor.environmentId,
    label: descriptor.label,
  };
}
