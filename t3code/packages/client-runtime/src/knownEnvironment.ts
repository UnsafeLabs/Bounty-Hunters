import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

export interface KnownEnvironmentConnectionTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type KnownEnvironmentSource = "configured" | "desktop-managed" | "manual" | "window-origin";

export type CiProvider = "circleci" | "github-actions" | "gitlab" | "jenkins" | "travis";

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: CiProvider | null;
  readonly isWSL: boolean;
}

export interface EnvironmentInfoDetectionInput {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly runtime?: string;
  readonly platform?: string;
  readonly arch?: string;
  readonly fileExists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string | null | undefined;
}

export interface KnownEnvironment {
  readonly id: string;
  readonly label: string;
  readonly source: KnownEnvironmentSource;
  readonly environmentId?: EnvironmentId;
  readonly target: KnownEnvironmentConnectionTarget;
}

const CI_PROVIDER_ENV: ReadonlyArray<readonly [CiProvider, string]> = [
  ["github-actions", "GITHUB_ACTIONS"],
  ["gitlab", "GITLAB_CI"],
  ["jenkins", "JENKINS_URL"],
  ["circleci", "CIRCLECI"],
  ["travis", "TRAVIS"],
];

const getProcess = () =>
  typeof process === "undefined"
    ? null
    : (process as {
        readonly env?: Record<string, string | undefined>;
        readonly platform?: string;
        readonly arch?: string;
        readonly versions?: { readonly bun?: string; readonly node?: string };
      });

const getNavigatorPlatform = () => (typeof navigator === "undefined" ? null : navigator.platform);

const defaultRuntime = (): string => {
  const currentProcess = getProcess();

  if (currentProcess?.versions?.bun !== undefined) {
    return "bun";
  }

  if (currentProcess?.versions?.node !== undefined) {
    return "node";
  }

  if (typeof window !== "undefined") {
    return "browser";
  }

  return "unknown";
};

const detectCiProvider = (env: Readonly<Record<string, string | undefined>>): CiProvider | null => {
  for (const [provider, variableName] of CI_PROVIDER_ENV) {
    if (env[variableName] !== undefined && env[variableName] !== "") {
      return provider;
    }
  }

  return null;
};

const detectContainer = (
  fileExists: (path: string) => boolean,
  readFile: (path: string) => string | null | undefined,
) => {
  if (fileExists("/.dockerenv")) {
    return true;
  }

  const cgroup = readFile("/proc/self/cgroup")?.toLowerCase() ?? "";
  return cgroup.includes("docker") || cgroup.includes("containerd") || cgroup.includes("kubepods");
};

const detectWsl = (platform: string, readFile: (path: string) => string | null | undefined) =>
  platform === "linux" && /microsoft|wsl/i.test(readFile("/proc/version") ?? "");

export function detectEnvironmentInfo(input: EnvironmentInfoDetectionInput = {}): EnvironmentInfo {
  const currentProcess = getProcess();
  const env = input.env ?? currentProcess?.env ?? {};
  const platform =
    input.platform ?? currentProcess?.platform ?? getNavigatorPlatform() ?? "unknown";
  const arch = input.arch ?? currentProcess?.arch ?? "unknown";
  const fileExists = input.fileExists ?? (() => false);
  const readFile = input.readFile ?? (() => null);
  const ciProvider = detectCiProvider(env);
  const isCI = ciProvider !== null || env["CI"] !== undefined;

  return {
    runtime: input.runtime ?? defaultRuntime(),
    platform,
    arch,
    isContainer: detectContainer(fileExists, readFile),
    isCI,
    ciProvider,
    isWSL: detectWsl(platform, readFile),
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
