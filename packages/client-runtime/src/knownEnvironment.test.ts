typescript
import { existsSync, readFileSync } from 'fs';

/**
 * Represents the detected environment information.
 */
export interface EnvironmentInfo {
  /** JavaScript runtime: 'node', 'browser', or 'unknown' */
  runtime: string;
  /** Operating system platform: 'darwin', 'linux', 'win32', etc. */
  platform: string;
  /** CPU architecture: 'x64', 'arm64', etc. */
  arch: string;
  /** Whether the code is running inside a Docker container */
  isContainer: boolean;
  /** Whether the code is running in a CI environment */
  isCI: boolean;
  /** CI provider name if in CI, otherwise null */
  ciProvider: string | null;
  /** Whether the code is running under Windows Subsystem for Linux */
  isWSL: boolean;
}

// ---------------------------------------------------------------------------
// Simple logger that respects test environments
// ---------------------------------------------------------------------------
const LOGGER = {
  warn: (msg: string) => {
    if (process.env.NODE_ENV !== 'test' && typeof console !== 'undefined') {
      console.warn(msg);
    }
  },
  error: (msg: string) => {
    if (process.env.NODE_ENV !== 'test' && typeof console !== 'undefined') {
      console.error(msg);
    }
  },
};

// ---------------------------------------------------------------------------
// Docker detection
// ---------------------------------------------------------------------------

/**
 * Checks whether the current process runs inside a Docker container.
 * Looks for the `/dockerenv` file or the presence of `docker` in `/proc/1/cgroup`.
 * @returns `true` if inside a Docker container, `false` otherwise.
 */
export function isDocker(): boolean {
  try {
    if (existsSync('/.dockerenv')) {
      return true;
    }
    if (existsSync('/proc/1/cgroup')) {
      const cgroup = readFileSync('/proc/1/cgroup', 'utf8');
      return cgroup.includes('docker');
    }
  } catch (err) {
    LOGGER.warn(`isDocker detection failed: ${err}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// WSL detection
// ---------------------------------------------------------------------------

/**
 * Checks whether the current process runs under Windows Subsystem for Linux (WSL).
 * Inspects `/proc/version` for a line containing "Microsoft".
 * @returns `true` if running under WSL, `false` otherwise.
 */
export function isWSL(): boolean {
  try {
    if (existsSync('/proc/version')) {
      const version = readFileSync('/proc/version', 'utf8');
      return version.includes('Microsoft');
    }
  } catch (err) {
    LOGGER.warn(`isWSL detection failed: ${err}`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// CI detection
// ---------------------------------------------------------------------------

/**
 * Detects whether the code is running in a known CI environment.
 * Checks environment variables: `GITHUB_ACTIONS`, `GITLAB_CI`, `JENKINS_URL`,
 * `CIRCLECI`, `TRAVIS`, and `CI`.
 * @returns `true` if a CI environment is detected, `false` otherwise.
 */
export function isCI(): boolean {
  // Specific providers checked first
  if (
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.JENKINS_URL ||
    process.env.CIRCLECI ||
    process.env.TRAVIS
  ) {
    return true;
  }

  // Generic CI variable – treat only truthy strings, but ignore 'false'
  const ciValue = process.env.CI;
  if (ciValue && ciValue.toLowerCase() !== 'false') {
    return true;
  }

  return false;
}

/**
 * Returns the name of the CI provider if the code is running in a CI environment.
 * The order of precedence matches `isCI`.
 * @returns Provider name string or `null` if not in a CI environment.
 */
export function getCIProvider(): string | null {
  if (process.env.GITHUB_ACTIONS) return 'github-actions';
  if (process.env.GITLAB_CI) return 'gitlab';
  if (process.env.JENKINS_URL) return 'jenkins';
  if (process.env.CIRCLECI) return 'circleci';
  if (process.env.TRAVIS) return 'travis';

  const ciValue = process.env.CI;
  if (ciValue && ciValue.toLowerCase() !== 'false') {
    return 'generic';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Runtime / Platform / Architecture detection (preserved from original)
// ---------------------------------------------------------------------------

function detectRuntime(): string {
  try {
    if (typeof globalThis?.process?.release?.name === 'string' && globalThis.process.release.name === 'node') {
      return 'node';
    }
    if (typeof window !== 'undefined') {
      return 'browser';
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

function detectPlatform(): string {
  try {
    if (typeof process?.platform === 'string') {
      return process.platform;
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

function detectArch(): string {
  try {
    if (typeof process?.arch === 'string') {
      return process.arch;
    }
  } catch {
    // ignore
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Main function: getKnownEnvironment
// ---------------------------------------------------------------------------

/**
 * Retrieves a comprehensive description of the current execution environment.
 * Combines runtime, platform, architecture, container, CI, and WSL detection.
 * All file-system reads are wrapped in try/catch, and environment variables are
 * accessed safely.
 * @returns {EnvironmentInfo} A structured object representing the environment.
 */
export function getKnownEnvironment(): EnvironmentInfo {
  const runtime = detectRuntime();
  const platform = detectPlatform();
  const arch = detectArch();
  const isContainer = isDocker();
  const ci = isCI();
  const ciProvider = getCIProvider();
  const wsl = isWSL();

  return {
    runtime,
    platform,
    arch,
    isContainer,
    isCI: ci,
    ciProvider,
    isWSL: wsl,
  };
}