import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as DesktopIpc from "./DesktopIpc.ts";

class FakeIpcMain implements DesktopIpc.DesktopIpcMain {
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

  invoke(channel: string, raw?: unknown): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (handler === undefined) {
      throw new Error(`No handler registered for ${channel}.`);
    }
    return Promise.resolve(handler({}, raw));
  }
}

const registerInvoke = (
  ipc: DesktopIpc.DesktopIpcShape,
  channel: string,
  handler: (raw: unknown) => Effect.Effect<unknown>,
) => ipc.handle({ channel, handler });

describe("DesktopIpc", () => {
  it.effect("queues invoke calls while disconnected and flushes them in FIFO order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = new FakeIpcMain();
        const ipc = DesktopIpc.make(fake, {
          initialConnectionState: "disconnected",
          messageTimeoutMs: 1_000,
        });
        const calls: unknown[] = [];

        yield* registerInvoke(ipc, "desktop:test", (raw) =>
          Effect.sync(() => {
            calls.push(raw);
            return `ok:${String(raw)}`;
          }),
        );

        const first = fake.invoke("desktop:test", "one");
        const second = fake.invoke("desktop:test", "two");

        assert.deepEqual(calls, []);

        yield* ipc.setConnectionState("connected");

        assert.equal(yield* Effect.promise(() => first), "ok:one");
        assert.equal(yield* Effect.promise(() => second), "ok:two");
        assert.deepEqual(calls, ["one", "two"]);
      }),
    ),
  );

  it.effect("drops the oldest queued invoke call when the queue is full", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = new FakeIpcMain();
        const ipc = DesktopIpc.make(fake, {
          initialConnectionState: "reconnecting",
          maxQueueSize: 2,
          messageTimeoutMs: 1_000,
        });

        yield* registerInvoke(ipc, "desktop:test", (raw) => Effect.succeed(raw));

        const first = fake.invoke("desktop:test", "one");
        const second = fake.invoke("desktop:test", "two");
        const third = fake.invoke("desktop:test", "three");

        yield* Effect.promise(() =>
          first.then(
            () => {
              throw new Error("Expected first queued request to be dropped.");
            },
            (error) => {
              assert.instanceOf(error, DesktopIpc.DesktopIpcQueueTimeoutError);
              assert.equal(error.reason, "queue-full");
            },
          ),
        );

        yield* ipc.setConnectionState("connected");

        assert.equal(yield* Effect.promise(() => second), "two");
        assert.equal(yield* Effect.promise(() => third), "three");
      }),
    ),
  );

  it.effect("expires queued invoke calls with a typed timeout error", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = new FakeIpcMain();
        const ipc = DesktopIpc.make(fake, {
          initialConnectionState: "disconnected",
          messageTimeoutMs: 5,
        });

        yield* registerInvoke(ipc, "desktop:test", (raw) => Effect.succeed(raw));

        const result = fake.invoke("desktop:test", "stale").then(
          () => {
            throw new Error("Expected queued request to expire.");
          },
          (error) => error,
        );

        const error = yield* Effect.promise(() => result);
        assert.instanceOf(error, DesktopIpc.DesktopIpcQueueTimeoutError);
        assert.equal(error.reason, "expired");
      }),
    ),
  );

  it.effect("emits connection state changes to scoped subscribers", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fake = new FakeIpcMain();
        const ipc = DesktopIpc.make(fake);
        const states: DesktopIpc.DesktopIpcConnectionState[] = [];

        yield* ipc.subscribeConnectionState((state) =>
          Effect.sync(() => {
            states.push(state);
          }),
        );

        yield* ipc.setConnectionState("reconnecting");
        yield* ipc.setConnectionState("connected");

        assert.deepEqual(states, ["connected", "reconnecting", "connected"]);
      }),
    ),
  );
});
