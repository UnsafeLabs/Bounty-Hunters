import { assert, describe, it } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";

import {
  findT3CodeDeepLinkArg,
  parseT3CodeDeepLink,
  validateDeepLinkProjectPath,
} from "./ElectronDeepLinks.ts";

describe("ElectronDeepLinks", () => {
  it("parses supported t3code links", () => {
    assert.deepEqual(parseT3CodeDeepLink("t3code://settings"), {
      type: "settings",
    });
    assert.deepEqual(parseT3CodeDeepLink("t3code://chat/thread?id=abc123"), {
      type: "chat-thread",
      threadId: ThreadId.make("abc123"),
    });
    assert.deepEqual(
      parseT3CodeDeepLink("t3code://open/project?path=%2FUsers%2Falice%2Frepo", "darwin"),
      {
        type: "open-project",
        path: "/Users/alice/repo",
      },
    );
  });

  it("rejects unsafe project paths", () => {
    assert.equal(
      validateDeepLinkProjectPath("../repo", "darwin"),
      "Project links must use an absolute path.",
    );
    assert.equal(
      validateDeepLinkProjectPath("/Users/alice/../repo", "darwin"),
      "Project links cannot contain path traversal segments.",
    );
    assert.equal(
      parseT3CodeDeepLink("t3code://open/project?path=..%2Frepo", "darwin").type,
      "error",
    );
  });

  it("extracts deep links from launch arguments", () => {
    assert.equal(
      findT3CodeDeepLinkArg(["--flag", "t3code://settings", "dist-electron/main.cjs"]),
      "t3code://settings",
    );
    assert.equal(findT3CodeDeepLinkArg(["--flag", "https://example.com"]), null);
  });
});
