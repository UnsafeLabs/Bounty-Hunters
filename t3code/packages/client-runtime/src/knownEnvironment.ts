import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as fs from "node:fs";

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

/* --- Runtime environment detection (container / CI / WSL) ----------- */

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
}

function readTextFileSafe(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

export function detectDockerContainer(): boolean {
  if (readTextFileSafe("/.dockerenv") !== null) {
    return true;
  }
  const cgroup = readTextFileSafe("/proc/self/cgroup");
  if (cgroup !== null && /docker|containerd|kubepods|cri-o/i.test(cgroup)) {
    return true;
  }
  return false;
}

export function detectWSL(): boolean {
  const version = readTextFileSafe("/proc/version");
  return version !== null && /microsoft/i.test(version);
}

export function detectCIProvider(): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env ?? {};
  if (env.GITHUB_ACTIONS) return "github-actions";
  if (env.GITLAB_CI) return "gitlab-ci";
  if (env.JENKINS_URL) return "jenkins";
  if (env.CIRCLECI) return "circleci";
  if (env.TRAVIS) return "travis";
  if (env.CI) return "ci";
  return null;
}

export function detectCI(): boolean {
  return detectCIProvider() !== null;
}

export function getRuntimeInfo(): { runtime: string; platform: string; arch: string } {
  const g = globalThis as {
    process?: { platform?: string; arch?: string; versions?: { node?: string } };
    navigator?: { platform?: string; userAgent?: string };
  };
  if (g.process?.versions?.node) {
    return {
      runtime: "node",
      platform: g.process.platform ?? "unknown",
      arch: g.process.arch ?? "unknown",
    };
  }
  if (g.navigator) {
    return {
      runtime: "browser",
      platform: g.navigator.platform ?? "unknown",
      arch: g.navigator.userAgent ?? "unknown",
    };
  }
  return { runtime: "unknown", platform: "unknown", arch: "unknown" };
}

export function getEnvironmentInfo(): EnvironmentInfo {
  const { runtime, platform, arch } = getRuntimeInfo();
  return {
    runtime,
    platform,
    arch,
    isContainer: detectDockerContainer(),
    isCI: detectCI(),
    ciProvider: detectCIProvider(),
    isWSL: detectWSL(),
  };
}
