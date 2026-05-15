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
      label: "Mac",
      browser: "Electron",
      deviceType: "desktop",
      ipAddress: "127.0.0.1",
      os: "macOS",
    });
  });

  it("infers a device label from mobile user agents when no label is provided", () => {
    const metadata = deriveAuthClientMetadata({
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
        },
        source: {
          remoteAddress: "10.0.0.8",
        },
      } as never,
    });

    expect(metadata).toMatchObject({
      label: "iPhone",
      browser: "Safari",
      deviceType: "mobile",
      ipAddress: "10.0.0.8",
      os: "iOS",
    });
  });

  it("keeps explicit labels over parsed device labels", () => {
    const metadata = deriveAuthClientMetadata({
      label: "Workbench laptop",
      request: {
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        },
        source: {},
      } as never,
    });

    expect(metadata.label).toBe("Workbench laptop");
  });
});
