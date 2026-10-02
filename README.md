import * as fs from 'fs';
import * as os from 'os';

export interface EnvironmentInfo {
  runtime: string;
  platform: NodeJS.Platform;
  arch: string;
  isContainer: boolean;
  isCI: boolean;
  ciProvider: string | null;
  isWSL: boolean;
}

function getCIProvider(): string | null {
  const ciVars = [
    'GITHUB_ACTIONS', 'GITLAB_CI', 'JENKINS_URL', 
    'CIRCLECI', 'TRAVIS', 'CI'
  ];
  for (const envVar of ciVars) {
    if (process.env[envVar]) return envVar;
  }
  return null;
}

function isContainer(): boolean {
  try {
    if (fs.existsSync('/.dockerenv')) return true;
    const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
    return cgroup.includes('docker') || cgroup.includes('kubepods');
  } catch {
    return false;
  }
}

function isWSL(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf8');
    return version.toLowerCase().includes('microsoft');
  } catch {
    return false;
  }
}

export function getEnvironmentInfo(): EnvironmentInfo {
  const ci = getCIProvider();
  return {
    runtime: typeof process !== 'undefined' ? 'node' : 'unknown',
    platform: os.platform(),
    arch: os.arch(),
    isContainer: isContainer(),
    isCI: !!ci,
    ciProvider: ci,
    isWSL: isWSL(),
  };
}