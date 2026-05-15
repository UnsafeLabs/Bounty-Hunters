export interface DeviceInfo {
  readonly deviceName: string;
  readonly deviceType: "desktop" | "mobile" | "tablet" | "unknown";
  readonly os: string | null;
  readonly browser: string | null;
}

const browserPatterns: ReadonlyArray<[RegExp, string]> = [
  [/\bEdg\/(\d+)/, "Edge"],
  [/\bOPR\/(\d+)/, "Opera"],
  [/\bFirefox\/(\d+)/, "Firefox"],
  [/\bChrome\/(\d+)/, "Chrome"],
  [/\bSafari\/(\d+)/, "Safari"],
];

const osPatterns: ReadonlyArray<[RegExp, string]> = [
  [/\bWindows NT (\d+\.\d+)/, "Windows"],
  [/\bMac OS X (\d+[._]\d+)/, "macOS"],
  [/\bLinux/, "Linux"],
  [/\bAndroid (\d+\.\d+)/, "Android"],
  [/\biPhone OS (\d+_?\d*)/, "iOS"],
  [/\biPad.*OS (\d+_?\d*)/, "iOS"],
];

const mobilePatterns: ReadonlyArray<RegExp> = [
  /\bAndroid\b/,
  /\biPhone\b/,
  /\biPod\b/,
  /\bMobile\b/,
];

const tabletPatterns: ReadonlyArray<RegExp> = [
  /\biPad\b/,
  /\bTablet\b/,
  /\bSilk\b/,
];

export function parseUserAgent(userAgent: string | null): DeviceInfo {
  if (!userAgent) {
    return { deviceName: "Unknown Device", deviceType: "unknown", os: null, browser: null };
  }

  let browser: string | null = null;
  for (const [pattern, name] of browserPatterns) {
    if (pattern.test(userAgent)) {
      browser = name;
      break;
    }
  }

  let os: string | null = null;
  for (const [pattern, name] of osPatterns) {
    if (pattern.test(userAgent)) {
      os = name;
      break;
    }
  }

  let deviceType: DeviceInfo["deviceType"] = "desktop";
  if (tabletPatterns.some((p) => p.test(userAgent))) {
    deviceType = "tablet";
  } else if (mobilePatterns.some((p) => p.test(userAgent))) {
    deviceType = "mobile";
  }

  const deviceName = buildDeviceName(os, browser);

  return { deviceName, deviceType, os, browser };
}

function buildDeviceName(os: string | null, browser: string | null): string {
  const parts: string[] = [];
  if (os) parts.push(os);
  if (browser) parts.push(browser);
  return parts.length > 0 ? parts.join(" - "): "Unknown Device";
}
