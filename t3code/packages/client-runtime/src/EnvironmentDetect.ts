/**
 * Container, CI, and WSL environment detection (issue #836).
 */

export type CiProvider =
  | "github_actions"
  | "gitlab_ci"
  | "jenkins"
  | "circleci"
  | "travis"
  | "generic"
  | null;

export interface EnvironmentInfo {
  runtime: string;
  platform: string;
  arch: string;
  isContainer: boolean;
  isCI: boolean;
  ciProvider: CiProvider;
  isWSL: boolean;
}

export interface DetectDeps {
  env?: NodeJS.ProcessEnv;
  platform?: string;
  arch?: string;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string | null;
  runtime?: string;
}

export function detectCiProvider(env: NodeJS.ProcessEnv = process.env): CiProvider {
  if (env.GITHUB_ACTIONS === "true" || env.GITHUB_ACTIONS === "1") return "github_actions";
  if (env.GITLAB_CI === "true" || env.GITLAB_CI === "1") return "gitlab_ci";
  if (env.JENKINS_URL) return "jenkins";
  if (env.CIRCLECI === "true" || env.CIRCLECI === "1") return "circleci";
  if (env.TRAVIS === "true" || env.TRAVIS === "1") return "travis";
  if (env.CI === "true" || env.CI === "1") return "generic";
  return null;
}

export function detectContainer(
  fileExists: (path: string) => boolean = () => false,
  readFile: (path: string) => string | null = () => null,
): boolean {
  try {
    if (fileExists("/.dockerenv")) return true;
    const cgroup = readFile("/proc/1/cgroup") ?? readFile("/proc/self/cgroup");
    if (cgroup && /docker|containerd|kubepods|podman/i.test(cgroup)) return true;
  } catch {
    // missing files are fine
  }
  return false;
}

export function detectWSL(
  readFile: (path: string) => string | null = () => null,
): boolean {
  try {
    const ver = readFile("/proc/version");
    if (ver && /microsoft|wsl/i.test(ver)) return true;
  } catch {
    // ignore
  }
  return false;
}

export function detectEnvironment(deps: DetectDeps = {}): EnvironmentInfo {
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? (() => false);
  const readFile = deps.readFile ?? (() => null);
  const ciProvider = detectCiProvider(env);
  return {
    runtime: deps.runtime ?? (typeof process !== "undefined" ? process.versions?.node ? "node" : "unknown" : "unknown"),
    platform: deps.platform ?? (typeof process !== "undefined" ? process.platform : "unknown"),
    arch: deps.arch ?? (typeof process !== "undefined" ? process.arch : "unknown"),
    isContainer: detectContainer(fileExists, readFile),
    isCI: ciProvider !== null,
    ciProvider,
    isWSL: detectWSL(readFile),
  };
}
