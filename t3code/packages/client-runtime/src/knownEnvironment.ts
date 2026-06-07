import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Fs from "node:fs";

export type RuntimeEnvironmentKind = "container" | "ci" | "wsl" | "desktop" | "unknown";

export function detectRuntimeEnvironment(): RuntimeEnvironmentKind {
  try {
    if (Fs.existsSync("/.dockerenv")) return "container";
    const cgroup = Fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (/docker|containerd|kubepods/i.test(cgroup)) return "container";
  } catch {}

  for (const v of ["CI", "GITHUB_ACTIONS", "GITLAB_CI", "JENKINS_URL", "CIRCLECI", "TRAVIS"]) {
    if (process.env[v]) return "ci";
  }

  try {
    const version = Fs.readFileSync("/proc/version", "utf-8");
    if (/microsoft/i.test(version)) return "wsl";
  } catch {}

  return "desktop";
}

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
