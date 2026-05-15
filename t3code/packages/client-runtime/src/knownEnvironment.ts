import type { EnvironmentId, ExecutionEnvironmentDescriptor } from "@t3tools/contracts";

export interface EnvironmentInfo {
  readonly runtime: string;
  readonly platform: string;
  readonly arch: string;
  readonly isContainer: boolean;
  readonly isCI: boolean;
  readonly ciProvider: string | null;
  readonly isWSL: boolean;
}

export interface EnvironmentDetectionInput {
  readonly env?: Record<string, string | undefined>;
  readonly runtime?: string;
  readonly platform?: string;
  readonly arch?: string;
  readonly fileExists?: (path: string) => boolean;
  readonly readFile?: (path: string) => string | null | undefined;
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

const ciProviders: ReadonlyArray<readonly [string, string]> = [
  ["GITHUB_ACTIONS", "github-actions"],
  ["GITLAB_CI", "gitlab-ci"],
  ["JENKINS_URL", "jenkins"],
  ["CIRCLECI", "circleci"],
  ["TRAVIS", "travis"],
  ["CI", "ci"],
];

function getProcessLike():
  | {
      readonly env?: Record<string, string | undefined>;
      readonly platform?: string;
      readonly arch?: string;
      readonly versions?: Record<string, string | undefined>;
      readonly getBuiltinModule?: (name: string) => unknown;
    }
  | undefined {
  return typeof process === "undefined" ? undefined : process;
}

interface EnvironmentFileAccessors {
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string | null | undefined;
}

function getNodeFsAccessors(): EnvironmentFileAccessors {
  const fs = getProcessLike()?.getBuiltinModule?.("node:fs") as
    | {
        readonly existsSync?: (path: string) => boolean;
        readonly readFileSync?: (path: string, encoding: "utf8") => string;
      }
    | undefined;

  const accessors: EnvironmentFileAccessors = {};
  if (fs?.existsSync) {
    accessors.fileExists = (path) => {
      try {
        return fs.existsSync?.(path) ?? false;
      } catch {
        return false;
      }
    };
  }
  if (fs?.readFileSync) {
    accessors.readFile = (path) => {
      try {
        return fs.readFileSync?.(path, "utf8") ?? null;
      } catch {
        return null;
      }
    };
  }
  return accessors;
}

function detectRuntime(inputRuntime: string | undefined): string {
  if (inputRuntime) return inputRuntime;

  const versions = getProcessLike()?.versions;
  if (versions?.bun) return "bun";
  if (versions?.node) return "node";
  const globals = globalThis as typeof globalThis & {
    readonly Deno?: unknown;
    readonly window?: unknown;
  };
  if (globals.Deno) return "deno";
  if (globals.window) return "browser";
  return "unknown";
}

function detectCiProvider(env: Record<string, string | undefined>): string | null {
  for (const [key, provider] of ciProviders) {
    if (env[key]) return provider;
  }
  return null;
}

function readAny(
  readFile: (path: string) => string | null | undefined,
  paths: readonly string[],
): string {
  return paths
    .map((path) => {
      try {
        return readFile(path) ?? "";
      } catch {
        return "";
      }
    })
    .join("\n");
}

function detectContainer(input: EnvironmentDetectionInput): boolean {
  const fsAccessors = getNodeFsAccessors();
  const fileExists = input.fileExists ?? fsAccessors.fileExists;
  const readFile = input.readFile ?? fsAccessors.readFile;

  try {
    if (fileExists?.("/.dockerenv")) return true;
  } catch {
    // Fall back to cgroup detection if the direct marker cannot be checked.
  }
  if (!readFile) return false;

  const cgroup = readAny(readFile, ["/proc/1/cgroup", "/proc/self/cgroup"]).toLowerCase();
  return ["docker", "kubepods", "containerd", "libpod", "podman"].some((marker) =>
    cgroup.includes(marker),
  );
}

function detectWsl(input: EnvironmentDetectionInput, platform: string): boolean {
  const readFile = input.readFile ?? getNodeFsAccessors().readFile;
  if (!readFile || platform !== "linux") return false;

  try {
    return readFile("/proc/version")?.toLowerCase().includes("microsoft") ?? false;
  } catch {
    return false;
  }
}

export function detectEnvironmentInfo(input: EnvironmentDetectionInput = {}): EnvironmentInfo {
  const processLike = getProcessLike();
  const env = input.env ?? processLike?.env ?? {};
  const platform = input.platform ?? processLike?.platform ?? "unknown";
  const arch = input.arch ?? processLike?.arch ?? "unknown";
  const ciProvider = detectCiProvider(env);

  return {
    runtime: detectRuntime(input.runtime),
    platform,
    arch,
    isContainer: detectContainer(input),
    isCI: ciProvider !== null,
    ciProvider,
    isWSL: detectWsl(input, platform),
  };
}
