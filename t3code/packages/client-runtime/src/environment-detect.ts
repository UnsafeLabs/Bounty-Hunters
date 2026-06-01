/**
 * Container, CI, and WSL environment detection for client runtime.
 */

export interface EnvironmentInfo {
  isContainer: boolean;
  isCI: boolean;
  isWSL: boolean;
  isDocker: boolean;
  isKubernetes: boolean;
  platform: string;
  shell: string;
}

export function detectEnvironment(): EnvironmentInfo {
  const env = process.env;

  return {
    isContainer: isContainer(),
    isCI: isCI(),
    isWSL: isWSL(),
    isDocker: isDocker(),
    isKubernetes: isKubernetes(),
    platform: process.platform,
    shell: env.SHELL || env.ComSpec || "unknown",
  };
}

function isContainer(): boolean {
  try {
    const fs = require("fs");
    if (fs.existsSync("/.dockerenv")) return true;
    const cgroup = fs.readFileSync("/proc/1/cgroup", "utf-8");
    if (cgroup.includes("docker") || cgroup.includes("containerd")) return true;
  } catch {}
  return false;
}

function isCI(): boolean {
  const env = process.env;
  return Boolean(
    env.CI || env.GITHUB_ACTIONS || env.GITLAB_CI || env.CIRCLECI ||
    env.TRAVIS || env.JENKINS_URL || env.BUILDKITE || env.CODEBUILD_BUILD_ID
  );
}

function isWSL(): boolean {
  try {
    const { execSync } = require("child_process");
    const version = execSync("uname -r", { encoding: "utf-8" });
    return version.toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function isDocker(): boolean {
  return isContainer() || Boolean(process.env.DOCKER_CONTAINER);
}

function isKubernetes(): boolean {
  return Boolean(process.env.KUBERNETES_SERVICE_HOST);
}
