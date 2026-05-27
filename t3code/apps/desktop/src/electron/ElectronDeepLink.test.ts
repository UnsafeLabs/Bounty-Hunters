import { vi } from "vitest";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";

const { setAsDefaultProtocolClientMock, onMock, browserWindowGetAllWindowsMock } = vi.hoisted(
  () => ({
    setAsDefaultProtocolClientMock: vi.fn(),
    onMock: vi.fn(),
    browserWindowGetAllWindowsMock: vi.fn(() => []),
  }),
);

vi.mock("electron", () => ({
  app: {
    setAsDefaultProtocolClient: setAsDefaultProtocolClientMock,
    on: onMock,
  },
  BrowserWindow: {
    getAllWindows: browserWindowGetAllWindowsMock,
  },
}));

import * as ElectronDeepLink from "./ElectronDeepLink.ts";

function runToExit<A, E>(effect: Effect.Effect<A, E>): Exit.Exit<A, E> {
  return Effect.runSyncExit(effect);
}

describe("ElectronDeepLink", () => {
  describe("parseDeepLinkUrl", () => {
    it("parses settings route", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://settings"),
      );
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.equal(exit.value.kind, "open-settings");
      }
    });

    it("parses settings route with trailing slash", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://settings/"),
      );
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.equal(exit.value.kind, "open-settings");
      }
    });

    it("parses open/project route", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl(
          "t3code://open/project?path=/home/user/my-project",
        ),
      );
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.equal(exit.value.kind, "open-project");
        assert.equal(exit.value.path, "home/user/my-project");
      }
    });

    it("parses chat/thread route", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://chat/thread?id=abc123"),
      );
      assert.isTrue(Exit.isSuccess(exit));
      if (Exit.isSuccess(exit)) {
        assert.equal(exit.value.kind, "open-thread");
        assert.equal(exit.value.id, "abc123");
      }
    });

    it("fails on unsupported protocol", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("https://example.com"),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("fails on missing id for chat/thread", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://chat/thread"),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("fails on missing path for open/project", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://open/project"),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("fails on path traversal in project path", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl(
          "t3code://open/project?path=../../etc/passwd",
        ),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("rejects malformed URL", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("not-a-url"),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("rejects unrecognized route", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://unknown/route"),
      );
      assert.isTrue(Exit.isFailure(exit));
    });

    it("rejects empty id in chat/thread", () => {
      const exit = runToExit(
        ElectronDeepLink.parseDeepLinkUrl("t3code://chat/thread?id="),
      );
      assert.isTrue(Exit.isFailure(exit));
    });
  });

  describe("validateDeepLinkPath", () => {
    it("accepts normal paths with leading slash", () => {
      const result = ElectronDeepLink.validateDeepLinkPath("path/to/repo");
      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.equal(result.value, "path/to/repo");
      }
    });

    it("normalizes redundant slashes", () => {
      const result = ElectronDeepLink.validateDeepLinkPath(
        "home/user//repo",
      );
      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.equal(result.value, "home/user/repo");
      }
    });

    it("rejects path traversal", () => {
      const result = ElectronDeepLink.validateDeepLinkPath("../etc/passwd");
      assert.isTrue(Option.isNone(result));
    });

    it("rejects deep path traversal", () => {
      const result = ElectronDeepLink.validateDeepLinkPath(
        "a/b/../../../../etc/passwd",
      );
      assert.isTrue(Option.isNone(result));
    });

    it("handles single segment", () => {
      const result = ElectronDeepLink.validateDeepLinkPath("project");
      assert.isTrue(Option.isSome(result));
      if (Option.isSome(result)) {
        assert.equal(result.value, "project");
      }
    });
  });
});
