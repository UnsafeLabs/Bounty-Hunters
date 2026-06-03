import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { beforeEach, vi } from "vitest";

const { onMock, removeListenerMock, themeState } = vi.hoisted(() => ({
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
  themeState: {
    shouldUseDarkColors: true,
    themeSource: "system",
  },
}));

vi.mock("electron", () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return themeState.shouldUseDarkColors;
    },
    get themeSource() {
      return themeState.themeSource;
    },
    set themeSource(value: string) {
      themeState.themeSource = value;
    },
    on: onMock,
    removeListener: removeListenerMock,
  },
}));

vi.mock("electron-store", () => {
  return {
    default: class MockStore {
      store = new Map<string, any>();
      constructor(options: any) {
        this.store.set("theme", options?.defaults?.theme ?? "system");
      }
      get(key: string) {
        return this.store.get(key);
      }
      set(key: string, value: any) {
        this.store.set(key, value);
      }
    },
  };
});

import * as ElectronTheme from "./ElectronTheme.ts";

describe("ElectronTheme", () => {
  beforeEach(() => {
    onMock.mockClear();
    removeListenerMock.mockClear();
    themeState.shouldUseDarkColors = true;
    themeState.themeSource = "system";
  });

  it.effect("scopes native theme update listeners", () =>
    Effect.gen(function* () {
      const listener = vi.fn();

      yield* Effect.scoped(
        Effect.gen(function* () {
          const electronTheme = yield* ElectronTheme.ElectronTheme;
          yield* electronTheme.onUpdated(listener);
        }),
      );

      assert.deepEqual(onMock.mock.calls, [["updated", listener]]);
      assert.deepEqual(removeListenerMock.mock.calls, [["updated", listener]]);
    }).pipe(Effect.provide(ElectronTheme.layer)),
  );

  it.effect("gets and sets theme source correctly", () =>
    Effect.gen(function* () {
      const electronTheme = yield* ElectronTheme.ElectronTheme;
      
      const initial = yield* electronTheme.getSource;
      assert.equal(initial, "system");

      yield* electronTheme.setSource("dark");
      const updated = yield* electronTheme.getSource;
      assert.equal(updated, "dark");
      assert.equal(themeState.themeSource, "dark");
    }).pipe(Effect.provide(ElectronTheme.layer)),
  );
});

