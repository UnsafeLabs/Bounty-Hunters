// @ts-nocheck
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

import * as fs from "fs";

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
}

export function getEnvironmentInfo(): EnvironmentInfo {
  let runtime = "browser";
  let platform = "unknown";
  let arch = "unknown";

  if (typeof process !== "undefined" && process.versions) {
    if (process.versions.bun) {
      runtime = "bun";
    } else if (process.versions.node) {
      runtime = "node";
    }
    platform = process.platform || "unknown";
    arch = process.arch || "unknown";
  }

  let isContainer = false;
  let isWSL = false;

  // Docker Container Detection
  try {
    if (fs.existsSync("/.dockerenv")) {
      isContainer = true;
    } else if (fs.existsSync("/proc/self/cgroup")) {
      const cgroup = fs.readFileSync("/proc/self/cgroup", "utf8");
      if (cgroup.includes("docker") || cgroup.includes("kubepods")) {
        isContainer = true;
      }
    }
  } catch {
    // ignore
  }

  // WSL Detection
  try {
    if (fs.existsSync("/proc/version")) {
      const version = fs.readFileSync("/proc/version", "utf8");
      if (version.toLowerCase().includes("microsoft")) {
        isWSL = true;
      }
    }
  } catch {
    // ignore
  }

  // CI Detection
  let isCI = false;
  let ciProvider: string | null = null;

  if (typeof process !== "undefined" && process.env) {
    const env = process.env;
    if (env.GITHUB_ACTIONS) {
      isCI = true;
      ciProvider = "GitHub Actions";
    } else if (env.GITLAB_CI) {
      isCI = true;
      ciProvider = "GitLab CI";
    } else if (env.JENKINS_URL) {
      isCI = true;
      ciProvider = "Jenkins";
    } else if (env.CIRCLECI) {
      isCI = true;
      ciProvider = "CircleCI";
    } else if (env.TRAVIS) {
      isCI = true;
      ciProvider = "Travis CI";
    } else if (env.CI) {
      isCI = true;
      ciProvider = "CI";
    }
  }

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

