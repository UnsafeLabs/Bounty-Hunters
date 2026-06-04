import { assert, describe, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import * as DesktopDeepLink from "./DesktopDeepLink.ts";

describe("DesktopDeepLink", () => {
  it("parses open-settings links", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://open-settings");
    assert.deepEqual(action, Option.some({ kind: "open-settings" }));
  });

  it("parses open-project links with query parameters", () => {
    const action = DesktopDeepLink.parseDeepLinkAction(
      "t3code://open-project?environmentId=env-1&projectId=proj-1&path=%2Ftmp%2Frepo",
    );
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-project",
        environmentId: EnvironmentId.make("env-1"),
        projectId: ProjectId.make("proj-1"),
        path: "/tmp/repo",
      });
    }
  });

  it("parses open-project links from path segments", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://project/env-1/proj-1");
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-project",
        environmentId: EnvironmentId.make("env-1"),
        projectId: ProjectId.make("proj-1"),
      });
    }
  });

  it("parses open/project links", () => {
    const action = DesktopDeepLink.parseDeepLinkAction(
      "t3code://open/project?environmentId=env-1&projectId=proj-1&path=%2Ftmp%2Frepo",
    );
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-project",
        environmentId: EnvironmentId.make("env-1"),
        projectId: ProjectId.make("proj-1"),
        path: "/tmp/repo",
      });
    }
  });

  it("rejects unsafe project paths", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://project/..%2Fproj-1");
    assert.isTrue(Option.isNone(action));
  });

  it("parses open/project path-only links", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://open/project?path=%2Ftmp%2Frepo");
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-project",
        path: "/tmp/repo",
      });
    }
  });

  it("parses open-thread links with threadId", () => {
    const action = DesktopDeepLink.parseDeepLinkAction(
      "t3code://open-thread?environmentId=env-1&threadId=thread-1",
    );
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-thread",
        environmentId: EnvironmentId.make("env-1"),
        threadId: ThreadId.make("thread-1"),
      });
    }
  });

  it("parses open/thread links with environment in path", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://open/thread/env-1/thread-1");
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-thread",
        environmentId: EnvironmentId.make("env-1"),
        threadId: ThreadId.make("thread-1"),
      });
    }
  });

  it("parses chat thread links", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("t3code://chat/thread?id=abc123");
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-thread",
        threadId: ThreadId.make("abc123"),
      });
    }
  });

  it("picks the first matching deep link from arguments", () => {
    const action = DesktopDeepLink.parseDeepLinkFromArguments([
      "--help",
      "t3code://open-thread/thread-2?environmentId=env-2",
      "t3code://open-project?environmentId=env-1&projectId=proj-1",
    ]);
    assert.isTrue(Option.isSome(action));
    if (Option.isSome(action)) {
      assert.deepEqual(action.value, {
        kind: "open-thread",
        environmentId: EnvironmentId.make("env-2"),
        threadId: ThreadId.make("thread-2"),
      });
    }
  });

  it("returns none for unsupported URLs", () => {
    const action = DesktopDeepLink.parseDeepLinkAction("https://example.com");
    assert.isTrue(Option.isNone(action));
  });
});
