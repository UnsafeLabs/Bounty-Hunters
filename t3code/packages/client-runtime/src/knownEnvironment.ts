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

export type RuntimeName = "browser" | "node" | "bun" | "unknown";

export type CiProvider =
  | "GitHub Actions"
  | "GitLab CI"
  | "Jenkins"
  | "CircleCI"
  | "Travis CI"
  | "Generic CI";

export interface EnvironmentInfo {
  readonly runtime: RuntimeName;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: CiProvider | null;
  readonly isWSL: boolean;
}

export interface EnvironmentDetectionSource {
  readonly env?: Record<string, string | undefined>;
  readonly platform?: string;
  readonly arch?: string;
  readonly runtime?: RuntimeName;
  readonly fileExists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string | undefined;
}

const CI_PROVIDER_ENV_VARS: ReadonlyArray<{
  readonly envVar: string;
  readonly provider: CiProvider;
}> = [
  { envVar: "GITHUB_ACTIONS", provider: "GitHub Actions" },
  { envVar: "GITLAB_CI", provider: "GitLab CI" },
  { envVar: "JENKINS_URL", provider: "Jenkins" },
  { envVar: "CIRCLECI", provider: "CircleCI" },
  { envVar: "TRAVIS", provider: "Travis CI" },
];

const readDefaultEnv = (): Record<string, string | undefined> => {
  const maybeProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process;
  return maybeProcess?.env ?? {};
};

const detectDefaultRuntime = (): RuntimeName => {
  const maybeGlobal = globalThis as {
    Bun?: unknown;
    process?: { versions?: { node?: string; bun?: string } };
    window?: unknown;
    document?: unknown;
  };
  if (maybeGlobal.Bun !== undefined || maybeGlobal.process?.versions?.bun !== undefined) {
    return "bun";
  }
  if (maybeGlobal.process?.versions?.node !== undefined) {
    return "node";
  }
  if (maybeGlobal.window !== undefined || maybeGlobal.document !== undefined) {
    return "browser";
  }
  return "unknown";
};

const detectDefaultPlatform = (): string => {
  const maybeGlobal = globalThis as {
    navigator?: { platform?: string };
    process?: { platform?: string };
  };
  return maybeGlobal.process?.platform ?? maybeGlobal.navigator?.platform ?? "unknown";
};

const detectDefaultArch = (): string => {
  const maybeProcess = (globalThis as { process?: { arch?: string } }).process;
  return maybeProcess?.arch ?? "unknown";
};

const safeFileExists = (
  fileExists: EnvironmentDetectionSource["fileExists"],
  path: string,
): boolean => {
  try {
    return fileExists?.(path) ?? false;
  } catch {
    return false;
  }
};

const safeReadFile = (
  readFile: EnvironmentDetectionSource["readFile"],
  path: string,
): string | undefined => {
  try {
    return readFile?.(path);
  } catch {
    return undefined;
  }
};

const hasTruthyEnv = (env: Record<string, string | undefined>, name: string): boolean => {
  const value = env[name];
  if (value === undefined) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
};

export function detectEnvironmentInfo(
  source: EnvironmentDetectionSource = {},
): EnvironmentInfo {
  const env = source.env ?? readDefaultEnv();
  const runtime = source.runtime ?? detectDefaultRuntime();
  const platform = source.platform ?? detectDefaultPlatform();
  const arch = source.arch ?? detectDefaultArch();
  const cgroupText =
    safeReadFile(source.readFile, "/proc/1/cgroup") ??
    safeReadFile(source.readFile, "/proc/self/cgroup") ??
    "";
  const procVersionText = safeReadFile(source.readFile, "/proc/version") ?? "";
  const isContainer =
    safeFileExists(source.fileExists, "/.dockerenv") ||
    /(?:docker|kubepods|containerd|podman|lxc)/i.test(cgroupText);
  const matchedCiProvider = CI_PROVIDER_ENV_VARS.find(({ envVar }) => hasTruthyEnv(env, envVar));
  const ciProvider =
    matchedCiProvider?.provider ?? (hasTruthyEnv(env, "CI") ? "Generic CI" : null);
  const isWSL =
    /microsoft|wsl/i.test(procVersionText) ||
    /microsoft|wsl/i.test(env.WSL_DISTRO_NAME ?? "") ||
    /microsoft|wsl/i.test(env.WSL_INTEROP ?? "");

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
