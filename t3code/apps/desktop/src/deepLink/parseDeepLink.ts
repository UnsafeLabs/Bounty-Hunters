/**
 * Parse t3code:// deep links for desktop navigation.
 * Supported:
 *   t3code://open/project?path=/abs/path
 *   t3code://chat/thread?id=abc123
 *   t3code://settings
 * Also accepts t3:// as an alias for the existing desktop scheme.
 */

export type DeepLinkAction =
  | { readonly kind: "open_project"; readonly path: string }
  | { readonly kind: "chat_thread"; readonly id: string }
  | { readonly kind: "settings" };

export type DeepLinkParseResult =
  | { readonly ok: true; readonly action: DeepLinkAction }
  | { readonly ok: false; readonly error: string };

const SCHEMES = new Set(["t3code:", "t3:"]);

/** Reject path traversal and empty project paths. */
export function sanitizeProjectPath(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  let path = raw.trim();
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (path.length === 0 || path.length > 4096) return null;
  // Disallow null bytes and obvious traversal
  if (path.includes("\0") || path.includes("..")) return null;
  // Windows drive or absolute posix
  const isWinAbs = /^[a-zA-Z]:[\\/]/.test(path);
  const isPosixAbs = path.startsWith("/");
  if (!isWinAbs && !isPosixAbs) return null;
  return path;
}

export function parseDeepLink(urlString: string): DeepLinkParseResult {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, error: "invalid_url" };
  }

  if (!SCHEMES.has(url.protocol)) {
    return { ok: false, error: "unsupported_scheme" };
  }

  // hostname is first segment for non-standard schemes: t3code://open/project
  const host = url.hostname.toLowerCase();
  const pathParts = url.pathname.split("/").filter(Boolean);
  const segments = [host, ...pathParts].filter(Boolean);

  if (segments[0] === "settings" || (segments[0] === "open" && segments[1] === "settings")) {
    return { ok: true, action: { kind: "settings" } };
  }

  if (segments[0] === "open" && segments[1] === "project") {
    const projectPath = sanitizeProjectPath(url.searchParams.get("path") ?? "");
    if (!projectPath) {
      return { ok: false, error: "invalid_project_path" };
    }
    return { ok: true, action: { kind: "open_project", path: projectPath } };
  }

  if (segments[0] === "chat" && segments[1] === "thread") {
    const id = (url.searchParams.get("id") ?? "").trim();
    if (!id || id.length > 256 || !/^[a-zA-Z0-9._-]+$/.test(id)) {
      return { ok: false, error: "invalid_thread_id" };
    }
    return { ok: true, action: { kind: "chat_thread", id } };
  }

  // t3code://settings (empty host, path /settings)
  if (url.pathname === "/settings" || url.pathname === "settings") {
    return { ok: true, action: { kind: "settings" } };
  }

  return { ok: false, error: "unknown_route" };
}
