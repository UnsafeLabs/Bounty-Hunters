import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as fs from "fs";

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

    environmentId: descriptor.environmentId,
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

function readFileSafe(path: string): string | null {
  try {
    return fs.readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}

function checkIsContainer(): boolean {
  // Check for Docker-specific file
  if (readFileSafe("/.dockerenv") !== null) {
    return true;
  }

  // Check cgroup for container indicators
  const cgroup = readFileSafe("/proc/self/cgroup");
  if (cgroup !== null && cgroup.includes("docker")) {
    return true;
  }

  return false;
}

function checkCIProvider(): string | null {
  if (process.env.CI === "true" || process.env.CI === "1") {
    return "ci";
  }
  if (process.env.GITHUB_ACTIONS === "true" || process.env.GITHUB_ACTIONS === "1") {
    return "github";
  }
  if (process.env.GITLAB_CI === "true" || process.env.GITLAB_CI === "1") {
    return "gitlab";
  }
  if (process.env.JENKINS_URL && process.env.JENKINS_URL.length > 0) {
    return "jenkins";
  }
  if (process.env.CIRCLECI === "true" || process.env.CIRCLECI === "1") {
    return "circleci";
  }
  if (process.env.TRAVIS === "true" || process.env.TRAVIS === "1") {
    return "travis";
  }

  return null;
}

function checkIsWSL(): boolean {
  const procVersion = readFileSafe("/proc/version");
  if (procVersion !== null && procVersion.toLowerCase().includes("microsoft")) {
    return true;
  }
  return false;
}

export function detectEnvironment(): EnvironmentInfo {
  const ciProvider = checkCIProvider();
  const isCI = ciProvider !== null;

  return {
    runtime: typeof process !== "undefined" && process.versions?.node ? "node" : "unknown",
    platform: typeof process !== "undefined" ? process.platform : "unknown",
    arch: typeof process !== "undefined" ? process.arch : "unknown",
    isContainer: checkIsContainer(),
    isCI,
    ciProvider: isCI ? ciProvider : null,
    isWSL: checkIsWSL(),
  };
}
  return {
    ...environment,
    environmentId: descriptor.environmentId,
    label: descriptor.label,
  };
}
