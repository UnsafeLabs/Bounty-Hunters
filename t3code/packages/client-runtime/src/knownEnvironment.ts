import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

type RuntimeGlobal = typeof globalThis & {
  readonly Bun?: {
    readonly version?: string;
  };
  readonly process?: {
    readonly arch?: string;
    readonly env?: Record<string, string | undefined>;
    readonly platform?: string;
    readonly versions?: {
      readonly bun?: string;
      readonly node?: string;
    };
  };
};

export type RuntimeName = "browser" | "bun" | "node" | "unknown";

export type CiProvider =
  | "circleci"
  | "generic"
  | "github-actions"
  | "gitlab-ci"
  | "jenkins"
  | "travis";

export interface EnvironmentInfo {
  readonly runtime: RuntimeName;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: CiProvider | null;
  readonly isWSL: boolean;
}

export interface EnvironmentDetectionHost {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: string;
  readonly arch?: string;
  readonly runtime?: RuntimeName;
  readonly fileExists?: (path: string) => boolean;
  readonly readTextFile?: (path: string) => string | null | undefined;
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

export function detectEnvironmentInfo(host: EnvironmentDetectionHost = {}): EnvironmentInfo {
  const env = host.env ?? getProcessEnv();
  const ciProvider = detectCiProvider(env);

  return {
    runtime: host.runtime ?? detectRuntime(),
    platform: host.platform ?? getProcessPlatform(),
    arch: host.arch ?? getProcessArch(),
    isContainer: detectContainer(host),
    isCI: ciProvider !== null,
    ciProvider,
    isWSL: detectWsl(host),
  };
}

function detectRuntime(): RuntimeName {
  const runtimeGlobal = globalThis as RuntimeGlobal;

  if (runtimeGlobal.Bun || runtimeGlobal.process?.versions?.bun) {
    return "bun";
  }

  if (runtimeGlobal.process?.versions?.node) {
    return "node";
  }

  if (typeof window !== "undefined" && typeof document !== "undefined") {
    return "browser";
  }

  return "unknown";
}

function getProcessEnv(): Record<string, string | undefined> {
  return (globalThis as RuntimeGlobal).process?.env ?? {};
}

function getProcessPlatform(): string {
  return (globalThis as RuntimeGlobal).process?.platform ?? "unknown";
}

function getProcessArch(): string {
  return (globalThis as RuntimeGlobal).process?.arch ?? "unknown";
}

function detectCiProvider(env: Record<string, string | undefined>): CiProvider | null {
  if (isTruthyEnv(env.GITHUB_ACTIONS)) {
    return "github-actions";
  }

  if (isTruthyEnv(env.GITLAB_CI)) {
    return "gitlab-ci";
  }

  if (hasEnvValue(env.JENKINS_URL)) {
    return "jenkins";
  }

  if (isTruthyEnv(env.CIRCLECI)) {
    return "circleci";
  }

  if (isTruthyEnv(env.TRAVIS)) {
    return "travis";
  }

  if (isTruthyEnv(env.CI)) {
    return "generic";
  }

  return null;
}

function detectContainer(host: EnvironmentDetectionHost): boolean {
  return (
    safeFileExists(host, "/.dockerenv") ||
    containsContainerCgroupMarker(safeReadTextFile(host, "/proc/1/cgroup"))
  );
}

function detectWsl(host: EnvironmentDetectionHost): boolean {
  const version = safeReadTextFile(host, "/proc/version");

  return /\b(microsoft|wsl)\b/i.test(version ?? "");
}

function containsContainerCgroupMarker(value: string | null): boolean {
  return value !== null && /\b(docker|kubepods|containerd|libpod|podman|lxc)\b/i.test(value);
}

function safeFileExists(host: EnvironmentDetectionHost, path: string): boolean {
  if (!host.fileExists) {
    return false;
  }

  try {
    return host.fileExists(path);
  } catch {
    return false;
  }
}

function safeReadTextFile(host: EnvironmentDetectionHost, path: string): string | null {
  if (!host.readTextFile) {
    return null;
  }

  try {
    return host.readTextFile(path) ?? null;
  } catch {
    return null;
  }
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.length > 0;
}

function isTruthyEnv(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "0" &&
    value.toLowerCase() !== "false"
  );
}
