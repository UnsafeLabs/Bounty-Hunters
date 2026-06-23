import { describe, expect, it } from "vitest";

import { deriveAuthClientMetadata } from "./utils.ts";

describe("deriveAuthClientMetadata", () => {
  it("labels Electron user agents as Electron instead of Chrome", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) t3code/0.0.15 Chrome/136.0.7103.93 Electron/36.3.2 Safari/537.36",
        },
        source: {
          remoteAddress: "::ffff:127.0.0.1",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("classifies Android tablets (no Mobile token) as tablet, not desktop", () => {
    // Android tablets send "Android" without the "Mobile" token that phones
    // include, and without an "iPad"/"Tablet" marker, so the device list must
    // not fall through to "desktop".
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        source: { remoteAddress: "10.0.0.5" },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Chrome",
      deviceType: "tablet",
      os: "Android",
    });
  });

  it("classifies Android phones (Mobile token) as mobile", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
        },
        source: { remoteAddress: "10.0.0.6" },
      } as never,
    });

    expect(metadata).toMatchObject({
      browser: "Chrome",
      deviceType: "mobile",
      os: "Android",
    });
  });

  it("classifies iPads as tablet and iPhones as mobile", () => {
    const ipad = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        },
        source: { remoteAddress: "10.0.0.7" },
      } as never,
    });
    const iphone = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
        },
        source: { remoteAddress: "10.0.0.8" },
      } as never,
    });

    expect(ipad).toMatchObject({ deviceType: "tablet", os: "iOS" });
    expect(iphone).toMatchObject({ deviceType: "mobile", os: "iOS" });
  });

  it("classifies automated clients as bot and missing user agents as unknown", () => {
    const bot = deriveAuthClientMetadata({
      request: {
        headers: { "user-agent": "curl/8.4.0" },
        source: { remoteAddress: "10.0.0.9" },
      } as never,
    });
    const headless = deriveAuthClientMetadata({
      request: {
        headers: {},
        source: { remoteAddress: "10.0.0.10" },
      } as never,
    });

    expect(bot).toMatchObject({ deviceType: "bot" });
    expect(headless).toMatchObject({ deviceType: "unknown" });
  });
});
