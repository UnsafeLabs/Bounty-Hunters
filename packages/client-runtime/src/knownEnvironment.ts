typescript
import * as fs from 'fs';
import * as os from 'os';

// ---------------------------------------------------------------------------
// Logger (conditionally enabled via AIGON_DEBUG environment variable)
// ---------------------------------------------------------------------------

const DEBUG_ENABLED = process.env.AIGON_DEBUG === 'true' || process.env.AIGON_DEBUG === '1';

function logDebug(context: string, message: string): void {
  if (DEBUG_ENABLED) {
    console.debug(`[AIGON:${context}] ${message}`);
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Describes the runtime environment of the application.
 */
export interface EnvironmentInfo {
  /** Runtime name (e.g. "node") */
  runtime: string;
  /** Operating system platform (e.g. "linux", "darwin") */
  platform: NodeJS.Platform;
  /** CPU architecture (e.g. "x64", "arm64") */
  arch: string;
  /** `true` if the process is running inside a Docker container */
  isContainer: boolean;
  /** `true` if the process is running inside a known CI environment */
  isCI: boolean;
  /** Name of the CI provider, or `null` when not in CI */
  ciProvider: string | null;
  /** `true` if the process is running under Windows Subsystem for Linux (WSL) */
  isWSL: boolean;
}

// ---------------------------------------------------------------------------
// Individual detection functions (exported for test compatibility)
// ---------------------------------------------------------------------------

/**
 * Detects whether the current process is running inside a Docker container.
 *
 * Detection methods:
 * - Checks for the existence of `/.dockerenv`
 * - Reads `/proc/1/cgroup` and looks for the presence of 'docker' or 'kubepods'
 *
 * @returns `true` if a Docker container is detected, `false` otherwise.
 */
export function isDocker(): boolean {
  try {
    if (fs.existsSync('/.dockerenv')) {
      logDebug('isDocker', 'Found /.dockerenv');
      return true;
    }
    const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf-8');
    const found = cgroup.includes('docker') || cgroup.includes('kubepods');
    if (found) {
      logDebug('isDocker', 'Docker/kubepods found in /proc/1/cgroup');
    }
    return found;
  } catch (error: unknown) {
    logDebug('isDocker', `Detection failed: ${error}`);
    return false;
  }
}

/**
 * Detects whether the current process is running inside a known CI provider
 * and returns the provider name.
 *
 * The following environment variables are checked:
 * - `GITHUB_ACTIONS` → GitHub Actions
 * - `GITLAB_CI`     → GitLab CI
 * - `JENKINS_URL`   → Jenkins
 * - `CIRCLECI`      → CircleCI
 * - `TRAVIS`        → Travis CI
 * - `CI`            → Generic CI (only if set to `'true'` or `'1'`)
 *
 * @returns An object with `isCI` (boolean) and `ciProvider` (string | null).
 */
export function detectCI(): { isCI: boolean; ciProvider: string | null } {
  const env = process.env;

  if (env.GITHUB_ACTIONS !== undefined) {
    logDebug('detectCI', 'GitHub Actions detected');
    return { isCI: true, ciProvider: 'GitHub Actions' };
  }
  if (env.GITLAB_CI !== undefined) {
    logDebug('detectCI', 'GitLab CI detected');
    return { isCI: true, ciProvider: 'GitLab CI' };
  }
  if (env.JENKINS_URL !== undefined) {
    logDebug('detectCI', 'Jenkins detected');
    return { isCI: true, ciProvider: 'Jenkins' };
  }
  if (env.CIRCLECI !== undefined) {
    logDebug('detectCI', 'CircleCI detected');
    return { isCI: true, ciProvider: 'CircleCI' };
  }
  if (env.TRAVIS !== undefined) {
    logDebug('detectCI', 'Travis CI detected');
    return { isCI: true, ciProvider: 'Travis CI' };
  }

  // Generic CI – only true if value is exactly 'true' or '1'
  const ciValue = env.CI;
  if (ciValue === 'true' || ciValue === '1') {
    logDebug('detectCI', 'Generic CI detected via CI env var');
    return { isCI: true, ciProvider: 'Generic CI' };
  }

  return { isCI: false, ciProvider: null };
}

/**
 * Detects whether the current process is running under Windows Subsystem for Linux (WSL).
 *
 * Reads `/proc/version` and checks for the keywords 'Microsoft' or 'WSL'.
 *
 * @returns `true` if WSL is detected, `false` otherwise.
 */
export function isWSL(): boolean {
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8');
    const found = version.includes('Microsoft') || version.includes('WSL');
    if (found) {
      logDebug('isWSL', 'WSL detected in /proc/version');
    }
    return found;
  } catch (error: unknown) {
    logDebug('isWSL', `Detection failed: ${error}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main environment info function
// ---------------------------------------------------------------------------

/**
 * Builds a complete `EnvironmentInfo` object describing the current runtime.
 *
 * - Uses Node.js runtime metadata and OS module for platform/arch.
 * - Delegates container, CI, and WSL detection to the exported helper functions.
 *
 * @returns An `EnvironmentInfo` instance with all fields populated.
 */
export function getKnownEnvironment(): EnvironmentInfo {
  const ciResult = detectCI();
  const info: EnvironmentInfo = {
    runtime: process.release?.name ?? 'node',
    platform: os.platform(),
    arch: os.arch(),
    isContainer: isDocker(),
    isCI: ciResult.isCI,
    ciProvider: ciResult.ciProvider,
    isWSL: isWSL(),
  };

  logDebug('getKnownEnvironment', JSON.stringify(info, null, 2));
  return info;
}