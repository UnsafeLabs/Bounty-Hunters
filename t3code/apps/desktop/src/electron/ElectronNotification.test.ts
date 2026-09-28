import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vitest";

const { isSupportedMock, notificationShowMock, notificationConstructorMock } = vi.hoisted(() => ({
  isSupportedMock: vi.fn(),
  notificationShowMock: vi.fn(),
  notificationConstructorMock: vi.fn(),
}));

vi.mock("electron", () => {
  class MockNotification {
    constructor(options: unknown) {
      notificationConstructorMock(options);
    }
    show() {
      notificationShowMock();
    }
    static isSupported() {
      return isSupportedMock();
    }
  }

  return {
    Notification: MockNotification,
  };
});

import * as ElectronNotification from "./ElectronNotification.ts";

describe("ElectronNotification", () => {
  beforeEach(() => {
    isSupportedMock.mockReset();
    notificationShowMock.mockReset();
    notificationConstructorMock.mockReset();
  });

  it.effect("shows notification when supported", () =>
    Effect.gen(function* () {
      isSupportedMock.mockReturnValue(true);

      const notification = yield* ElectronNotification.ElectronNotification;
      yield* notification.show({
        title: "T3 Code",
        body: "Backend service restarting...",
      });

      assert.equal(notificationConstructorMock.mock.calls.length, 1);
      assert.deepEqual(notificationConstructorMock.mock.calls[0], [
        {
          title: "T3 Code",
          body: "Backend service restarting...",
        },
      ]);
      assert.equal(notificationShowMock.mock.calls.length, 1);
    }).pipe(Effect.provide(ElectronNotification.layer)),
  );

  it.effect("does not show notification when unsupported", () =>
    Effect.gen(function* () {
      isSupportedMock.mockReturnValue(false);

      const notification = yield* ElectronNotification.ElectronNotification;
      yield* notification.show({
        title: "T3 Code",
        body: "Backend service restarting...",
      });

      assert.equal(notificationConstructorMock.mock.calls.length, 0);
      assert.equal(notificationShowMock.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronNotification.layer)),
  );
});
