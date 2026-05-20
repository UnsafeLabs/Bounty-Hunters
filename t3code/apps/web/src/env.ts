/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.nativeApi via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);

export type DetectedEnv = {
  wsl: boolean;
  container: boolean;
  ci: "github-actions" | "gitlab-ci" | null;
};

let cachedEnv: DetectedEnv | null = null;

function safeProcessEnv(): Record<string, string | undefined> {
  try {
    if (typeof process !== "undefined" && process.env) {
      return process.env as Record<string, string | undefined>;
    }
  } catch {
    // not in Node.js/Electron context
  }
  return {};
}

function detectWSL(): boolean {
  const env = safeProcessEnv();
  if (env.WSL_DISTRO_NAME) return true;
  try {
    return /linux/i.test(navigator.platform) && /microsoft|WSL/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function detectContainer(): boolean {
  const env = safeProcessEnv();
  if (env.container) return true;
  return false;
}

function detectCI(): "github-actions" | "gitlab-ci" | null {
  const env = safeProcessEnv();
  if (env.GITHUB_ACTIONS) return "github-actions";
  if (env.GITLAB_CI) return "gitlab-ci";
  return null;
}

export function detectEnvironment(): DetectedEnv {
  if (cachedEnv) return cachedEnv;
  cachedEnv = {
    wsl: detectWSL(),
    container: detectContainer(),
    ci: detectCI(),
  };
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
