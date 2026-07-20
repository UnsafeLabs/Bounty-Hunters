/**
 * Parse a human-readable device name from a User-Agent string (issue #835).
 */

export function parseDeviceName(userAgent: string | null | undefined): string {
  if (!userAgent || !userAgent.trim()) {
    return "Unknown device";
  }
  const ua = userAgent;

  const os =
    /iPhone|iPad|iPod/.test(ua)
      ? "iOS"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X|Macintosh/.test(ua)
          ? "macOS"
          : /Windows NT/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;

  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua) || /Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua) || /CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua) && !/Chrome\//.test(ua)
            ? "Safari"
            : null;

  const deviceType = /iPad|Tablet/i.test(ua)
    ? "tablet"
    : /iPhone|Android.+Mobile|Mobile/i.test(ua)
      ? "mobile"
      : /bot|crawler|spider|curl|wget/i.test(ua)
        ? "bot"
        : "desktop";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return `${browser} (${deviceType})`;
  if (os) return `${os} ${deviceType}`;
  return `${deviceType} device`;
}
