import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as DesktopIpc from "./DesktopIpc.ts";

class TestIpcMain implements DesktopIpc.DesktopIpcMain {
  readonly handlers = new Map<string, DesktopIpc.DesktopIpcHandleListener>();
  readonly syncHandlers = new Map<string, DesktopIpc.DesktopIpcSyncListener>();

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  handle(channel: string, listener: DesktopIpc.DesktopIpcHandleListener): void {
    this.handlers.set(channel, listener);
  }

  removeAllListeners(channel: string): void {
    this.syncHandlers.delete(channel);
  }

  on(channel: string, listener: DesktopIpc.DesktopIpcSyncListener): void {
    this.syncHandlers.set(channel, listener);
  }

  invoke(channel: string, raw: unknown) {
    const listener = this.handlers.get(channel);
    if (listener === undefined) {
      throw new Error(`No handler registered for ${channel}`);
    }
    return listener({}, raw);
  }
}

describe("DesktopIpc queue", () => {
  it.effect("runs calls directly while the backend is connected", () =>
    Effect.gen(function* () {
      const backendReady = yield* Ref.make(true);
      const ipcMain = new TestIpcMain();
      const ipc = DesktopIpc.make(ipcMain, { backendReady });

      yield* Effect.scoped(Effect.gen(function* () {
        yield* ipc.handle({
          channel: "test:direct",
          handler: (raw) => Effect.succeed({ raw }),
        });

        const result = yield* Effect.promise(() =>
          Promise.resolve(ipcMain.invoke("test:direct", "alpha")),
        );
        assert.deepStrictEqual(result, { raw: "alpha" });
        assert.equal(yield* SubscriptionRef.get(ipc.connectionState), "connected");
      }));
    }),
  );

  it.effect("queues disconnected calls and flushes them in FIFO order on reconnect", () =>
    Effect.gen(function* () {
      const backendReady = yield* Ref.make(false);
      const ipcMain = new TestIpcMain();
      const seen: unknown[] = [];
      const ipc = DesktopIpc.make(ipcMain, {
        backendReady,
        pollInterval: "5 millis",
      });

      yield* Effect.scoped(Effect.gen(function* () {
        yield* ipc.handle({
          channel: "test:fifo",
          handler: (raw) =>
            Effect.sync(() => {
              seen.push(raw);
              return raw;
            }),
        });

        const first = ipcMain.invoke("test:fifo", 1);
        const second = ipcMain.invoke("test:fifo", 2);

        yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 10)));
        assert.equal(yield* SubscriptionRef.get(ipc.connectionState), "reconnecting");
        yield* Ref.set(backendReady, true);
        yield* ipc.flushQueue;
        const third = ipcMain.invoke("test:fifo", 3);

        const results = yield* Effect.promise(() =>
          Promise.all([Promise.resolve(first), Promise.resolve(second), Promise.resolve(third)]),
        );
        assert.deepStrictEqual(results, [1, 2, 3]);
        assert.deepStrictEqual(seen, [1, 2, 3]);
        assert.equal(yield* SubscriptionRef.get(ipc.connectionState), "connected");
      }));
    }),
  );

  it.effect("drops the oldest queued message when the queue is full", () =>
    Effect.gen(function* () {
      const backendReady = yield* Ref.make(false);
      const ipcMain = new TestIpcMain();
      const ipc = DesktopIpc.make(ipcMain, {
        backendReady,
        maxSize: 1,
        pollInterval: "5 millis",
      });

      yield* Effect.scoped(Effect.gen(function* () {
        yield* ipc.handle({
          channel: "test:overflow",
          handler: (raw) => Effect.succeed(raw),
        });

        const first = ipcMain.invoke("test:overflow", "oldest");
        const second = ipcMain.invoke("test:overflow", "newest");

        const firstError = yield* Effect.promise<unknown>(() =>
          Promise.resolve(first).catch((error) => error),
        );
        assert.equal((firstError as { readonly _tag?: string })._tag, "DesktopIpcQueueOverflowError");

        yield* Ref.set(backendReady, true);
        const secondResult = yield* Effect.promise(() => Promise.resolve(second));
        assert.equal(secondResult, "newest");
      }));
    }),
  );

  it.effect("expires queued messages with a typed timeout error", () =>
    Effect.gen(function* () {
      const backendReady = yield* Ref.make(false);
      const ipcMain = new TestIpcMain();
      const ipc = DesktopIpc.make(ipcMain, {
        backendReady,
        messageTtl: "10 millis",
      });

      yield* Effect.scoped(Effect.gen(function* () {
        yield* ipc.handle({
          channel: "test:timeout",
          handler: (raw) => Effect.succeed(raw),
        });

        const result = yield* Effect.promise<unknown>(() =>
          Promise.resolve(ipcMain.invoke("test:timeout", "late")).catch((error) => error),
        );

        assert.equal((result as { readonly _tag?: string })._tag, "DesktopIpcQueueTimeoutError");
      }));
    }),
  );
});
