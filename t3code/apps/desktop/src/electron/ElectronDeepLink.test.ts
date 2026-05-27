import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import { vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    quit: vi.fn(),
    requestSingleInstanceLock: vi.fn(() => true),
    setAsDefaultProtocolClient: vi.fn(),
  },
}));

import * as ElectronDeepLink from "./ElectronDeepLink.ts";

function parse(url: string) {
  return Effect.runSyncExit(ElectronDeepLink.parseDeepLinkUrl(url));
}

function expectSuccess<A, E>(exit: Exit.Exit<A, E>): A {
  assert.isTrue(Exit.isSuccess(exit));
  if (Exit.isFailure(exit)) {
    throw new Error("expected success");
  }
  return exit.value;
}

describe("ElectronDeepLink", () => {
  it("parses supported routes", () => {
    assert.deepEqual(expectSuccess(parse("t3code://settings")), { kind: "open-settings" });
    assert.deepEqual(expectSuccess(parse("t3code://chat/thread?id=abc123")), {
      kind: "open-thread",
      id: "abc123",
    });
    assert.deepEqual(expectSuccess(parse("t3code://open/project?path=/repo/app")), {
      kind: "open-project",
      path: "/repo/app",
    });
  });

  it("rejects unsupported or incomplete links", () => {
    assert.isTrue(Exit.isFailure(parse("https://example.com")));
    assert.isTrue(Exit.isFailure(parse("t3code://chat/thread")));
    assert.isTrue(Exit.isFailure(parse("t3code://open/project")));
    assert.isTrue(Exit.isFailure(parse("t3code://unknown")));
  });

  it("rejects traversal project paths while preserving valid absolute paths", () => {
    assert.isTrue(Option.isNone(ElectronDeepLink.validateDeepLinkProjectPath("../secret")));
    assert.isTrue(Option.isNone(ElectronDeepLink.validateDeepLinkProjectPath("/repo/../secret")));
    assert.equal(
      Option.getOrNull(ElectronDeepLink.validateDeepLinkProjectPath("C:\\Users\\me\\repo")),
      "C:\\Users\\me\\repo",
    );
  });

  it("finds deep links in process arguments", () => {
    assert.equal(
      Option.getOrNull(ElectronDeepLink.findDeepLinkArg(["app", "t3code://settings"])),
      "t3code://settings",
    );
    assert.isTrue(Option.isNone(ElectronDeepLink.findDeepLinkArg(["app", "--flag"])));
  });
});
