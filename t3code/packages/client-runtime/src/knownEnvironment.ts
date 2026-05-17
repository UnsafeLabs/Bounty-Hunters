import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

export interface KnownEnvironmentConnectionTarget {
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

export type KnownEnvironmentSource = "configured" | "desktop-managed" | "manual" | "window-origin";

export type KnownEnvironmentContainerKind =
  | "containerd"
  | "docker"
  | "kubernetes"
  | "podman"
  | "unknown";

export interface KnownEnvironmentRuntimeFlags {
  readonly isCi: boolean;
  readonly isContainer: boolean;
  readonly isWsl: boolean;
  readonly ciProvider?: string;
  readonly containerKind?: KnownEnvironmentContainerKind;
  readonly wslDistroName?: string;
}

export interface KnownEnvironmentRuntimeDetectionInput {
  readonly env?: Record<string, string | undefined>;
  readonly fileExists?: (path: string) => boolean;
  readonly platform?: string;
  readonly readTextFile?: (path: string) => string | null | undefined;
  readonly release?: string;
}

export interface KnownEnvironment {
  readonly id: string;
  readonly label: string;
  readonly runtime?: KnownEnvironmentRuntimeFlags;
  readonly source: KnownEnvironmentSource;
  readonly environmentId?: EnvironmentId;
  readonly target: KnownEnvironmentConnectionTarget;
}

const DEFAULT_KNOWN_ENVIRONMENT_RUNTIME: KnownEnvironmentRuntimeFlags = {
  isCi: false,
  isContainer: false,
  isWsl: false,
};

const CI_PROVIDER_ENV_KEYS: ReadonlyArray<readonly [string, string]> = [
  ["GITHUB_ACTIONS", "github-actions"],
  ["GITLAB_CI", "gitlab-ci"],
  ["CIRCLECI", "circleci"],
  ["BUILDKITE", "buildkite"],
  ["TRAVIS", "travis-ci"],
  ["APPVEYOR", "appveyor"],
  ["TF_BUILD", "azure-pipelines"],
  ["TEAMCITY_VERSION", "teamcity"],
  ["JENKINS_URL", "jenkins"],
  ["BITBUCKET_BUILD_NUMBER", "bitbucket-pipelines"],
  ["VERCEL", "vercel"],
  ["NETLIFY", "netlify"],
];

function truthyEnv(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

function safeFileExists(
  fileExists: KnownEnvironmentRuntimeDetectionInput["fileExists"],
  path: string,
): boolean {
  if (!fileExists) {
    return false;
  }

  try {
    return fileExists(path);
  } catch {
    return false;
  }
}

function safeReadTextFile(
  readTextFile: KnownEnvironmentRuntimeDetectionInput["readTextFile"],
  path: string,
): string {
  if (!readTextFile) {
    return "";
  }

  try {
    return readTextFile(path) ?? "";
  } catch {
    return "";
  }
}

function detectContainerKind(input: KnownEnvironmentRuntimeDetectionInput): {
  isContainer: boolean;
  containerKind?: KnownEnvironmentContainerKind;
} {
  if (safeFileExists(input.fileExists, "/.dockerenv")) {
    return {
      isContainer: true,
      containerKind: "docker",
    };
  }

  const cgroup = safeReadTextFile(input.readTextFile, "/proc/1/cgroup").toLowerCase();
  if (cgroup.includes("kubepods")) {
    return {
      isContainer: true,
      containerKind: "kubernetes",
    };
  }
  if (cgroup.includes("containerd")) {
    return {
      isContainer: true,
      containerKind: "containerd",
    };
  }
  if (cgroup.includes("docker")) {
    return {
      isContainer: true,
      containerKind: "docker",
    };
  }
  if (cgroup.includes("libpod") || cgroup.includes("podman")) {
    return {
      isContainer: true,
      containerKind: "podman",
    };
  }

  return {
    isContainer: false,
  };
}

function detectCiProvider(env: Record<string, string | undefined>): {
  isCi: boolean;
  ciProvider?: string;
} {
  for (const [key, provider] of CI_PROVIDER_ENV_KEYS) {
    if (truthyEnv(env[key])) {
      return {
        isCi: true,
        ciProvider: provider,
      };
    }
  }

  return {
    isCi: truthyEnv(env.CI),
  };
}

function detectWsl(input: KnownEnvironmentRuntimeDetectionInput): {
  isWsl: boolean;
  wslDistroName?: string;
} {
  const env = input.env ?? {};
  const wslDistroName = env.WSL_DISTRO_NAME?.trim();
  if (wslDistroName) {
    return {
      isWsl: true,
      wslDistroName,
    };
  }

  if (truthyEnv(env.WSL_INTEROP)) {
    return {
      isWsl: true,
    };
  }

  const release = input.release?.toLowerCase() ?? "";
  const procVersion = safeReadTextFile(input.readTextFile, "/proc/version").toLowerCase();
  const isWsl =
    release.includes("microsoft") || release.includes("wsl") || procVersion.includes("microsoft");
  return {
    isWsl,
  };
}

export function createKnownEnvironmentRuntimeFlags(
  overrides: Partial<KnownEnvironmentRuntimeFlags> = {},
): KnownEnvironmentRuntimeFlags {
  return {
    ...DEFAULT_KNOWN_ENVIRONMENT_RUNTIME,
    ...overrides,
  };
}

export function detectKnownEnvironmentRuntime(
  input: KnownEnvironmentRuntimeDetectionInput = {},
): KnownEnvironmentRuntimeFlags {
  const processLike = (
    globalThis as typeof globalThis & {
      process?: {
        env?: Record<string, string | undefined>;
        platform?: string;
      };
    }
  ).process;
  const env = input.env ?? processLike?.env ?? {};
  const container = detectContainerKind(input);
  const ci = detectCiProvider(env);
  const wsl = detectWsl({
    ...input,
    env,
    platform: input.platform ?? processLike?.platform,
  });

  return createKnownEnvironmentRuntimeFlags({
    ...container,
    ...ci,
    ...wsl,
  });
}

export function createKnownEnvironment(input: {
  readonly id?: string;
  readonly label: string;
  readonly runtime?: KnownEnvironmentRuntimeFlags;
  readonly source?: KnownEnvironmentSource;
  readonly target: KnownEnvironmentConnectionTarget;
}): KnownEnvironment {
  return {
    id: input.id ?? `ws:${input.label}`,
    label: input.label,
    runtime: input.runtime ?? createKnownEnvironmentRuntimeFlags(),
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
