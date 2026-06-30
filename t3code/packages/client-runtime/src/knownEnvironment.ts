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

export type RuntimeEnvironmentKind = "browser" | "electron" | "node";

export interface RuntimeEnvironmentInfo {
  readonly runtime: RuntimeEnvironmentKind;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCi: boolean;
  readonly ciProvider: string | null;
  readonly isWsl: boolean;
}

export interface RuntimeEnvironmentInput {
  readonly runtime?: RuntimeEnvironmentKind;
  readonly platform?: string;
  readonly arch?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly pathExists?: (path: string) => boolean;
  readonly readTextFile?: (path: string) => string | null;
}

const CI_PROVIDER_ENV_VARS: ReadonlyArray<{ name: string; provider: string }> = [
  { name: "GITHUB_ACTIONS", provider: "github-actions" },
  { name: "GITLAB_CI", provider: "gitlab-ci" },
  { name: "JENKINS_URL", provider: "jenkins" },
  { name: "CIRCLECI", provider: "circleci" },
  { name: "TRAVIS", provider: "travis-ci" },
];

function defaultRuntimeEnvironmentInput(): RuntimeEnvironmentInput {
  const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  const isElectron = typeof process !== "undefined" && Boolean(process.versions?.electron);
  return {
    runtime: isBrowser ? "browser" : isElectron ? "electron" : "node",
    platform: typeof process !== "undefined" ? process.platform : "unknown",
    arch: typeof process !== "undefined" ? process.arch : "unknown",
    ...(typeof process !== "undefined" ? { env: process.env } : {}),
  };
}

function readTextFile(input: RuntimeEnvironmentInput, path: string): string | null {
  try {
    return input.readTextFile?.(path) ?? null;
  } catch {
    return null;
  }
}

function pathExists(input: RuntimeEnvironmentInput, path: string): boolean {
  try {
    return input.pathExists?.(path) ?? false;
  } catch {
    return false;
  }
}

function getEnv(input: RuntimeEnvironmentInput, name: string): string | undefined {
  return input.env?.[name];
}

export function detectRuntimeEnvironment(
  input: RuntimeEnvironmentInput = {},
): RuntimeEnvironmentInfo {
  const resolved = {
    ...defaultRuntimeEnvironmentInput(),
    ...input,
  };

  const cgroup = readTextFile(resolved, "/proc/1/cgroup") ?? "";
  const procVersion = readTextFile(resolved, "/proc/version") ?? "";
  const isContainer =
    pathExists(resolved, "/.dockerenv") ||
    /docker|containerd|kubepods|podman/i.test(cgroup) ||
    /docker|containerd|kubepods|podman/i.test(procVersion);

  const ciProvider =
    CI_PROVIDER_ENV_VARS.find(({ name }) => getEnv(resolved, name) === "true")?.provider ?? null;
  const isCi = Boolean(ciProvider) || getEnv(resolved, "CI") === "true";
  const isWsl = /microsoft/i.test(procVersion) || Boolean(getEnv(resolved, "WSL_DISTRO_NAME"));

  return {
    runtime: resolved.runtime ?? "node",
    platform: resolved.platform ?? "unknown",
    arch: resolved.arch ?? "unknown",
    isContainer,
    isCi,
    ciProvider,
    isWsl,
  };
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
