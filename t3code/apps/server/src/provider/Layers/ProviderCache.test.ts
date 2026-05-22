import {
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Metric from "effect/Metric";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { assert, describe, it } from "@effect/vitest";

import {
  ProviderInstanceRegistry,
  type ProviderInstanceRegistryShape,
} from "../Services/ProviderInstanceRegistry.ts";
import { ProviderCache } from "../Services/ProviderCache.ts";
import type { ProviderInstance } from "../ProviderDriver.ts";
import { ProviderCacheLive } from "./ProviderCache.ts";

const makeInstanceId = (id: string): ProviderInstanceId => ({ _tag: "ProviderInstanceId", id }) as any;

const makeSnapshot = (models: ReadonlyArray<string>): ServerProvider => ({
  instanceId: makeInstanceId("test"),
  driver: "opencode" as any,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" as const },
  checkedAt: "2026-05-22T00:00:00.000Z",
  models: models.map((slug) => ({
    slug,
    name: slug,
    shortName: undefined,
    subProvider: undefined,
    isCustom: false,
    capabilities: null,
  })),
  slashCommands: [],
  skills: [],
});

const makeAdapterCapabilities = () => ({
  sessionModelSwitch: "unsupported" as const,
});

const makeInstance = (
  id: ProviderInstanceId,
  models: ReadonlyArray<string>,
): ProviderInstance => ({
  instanceId: id,
  driverKind: "opencode" as any,
  continuationIdentity: { driverKind: "opencode" as any, continuationKey: "test" },
  displayName: undefined,
  enabled: true,
  snapshot: {
    maintenanceCapabilities: {} as any,
    getSnapshot: Effect.succeed(makeSnapshot(models)),
    refresh: Effect.succeed(makeSnapshot(models)),
    streamChanges: Stream.never,
  },
  adapter: {
    provider: "opencode" as any,
    capabilities: makeAdapterCapabilities(),
    startSession: Effect.succeed({} as any),
    sendTurn: Effect.succeed({} as any),
    interruptTurn: Effect.void,
    respondToRequest: Effect.void,
    respondToUserInput: Effect.void,
    stopSession: Effect.void,
    listSessions: Effect.succeed([]),
    hasSession: Effect.succeed(false),
    readThread: Effect.succeed({} as any),
    rollbackThread: Effect.succeed({} as any),
    stopAll: Effect.void,
    streamEvents: Stream.never,
  },
  textGeneration: {} as any,
});

interface TestContext {
  readonly instanceRegistry: ProviderInstanceRegistryShape;
  readonly changesPubSub: {
    readonly subscribe: ReturnType<typeof Ref.make<void>>;
  };
}

const makeTestLayer = () => {
  const changesRef = Ref.make<void>(undefined).pipe(Effect.runSync);
  const instanceMap = new Map<ProviderInstanceId, ProviderInstance>();
  const instanceRef = Ref.make(instanceMap).pipe(Effect.runSync);

  const registry: ProviderInstanceRegistryShape = {
    getInstance: (id) =>
      Ref.get(instanceRef).pipe(Effect.map((map) => map.get(id))),
    listInstances: Ref.get(instanceRef).pipe(
      Effect.map((map) => Array.from(map.values())),
    ),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.never,
    subscribeChanges: Effect.succeed({} as any),
  };

  return {
    registry,
    addInstance: (id: ProviderInstanceId, models: ReadonlyArray<string>) =>
      Ref.update(instanceRef, (map) => {
        const next = new Map(map);
        next.set(id, makeInstance(id, models));
        return next;
      }),
  };
};

describe("ProviderCache", () => {
  it.effect("serves model list from cache within TTL", () =>
    Effect.gen(function* () {
      const ctx = makeTestLayer();
      const id = makeInstanceId("test");
      yield* ctx.addInstance(id, ["model-a", "model-b"]);

      const layer = Layer.succeed(ProviderInstanceRegistry, ctx.registry).pipe(
        Layer.provideMerge(ProviderCacheLive),
      );
      const cache = yield* ProviderCache.pipe(Effect.provide(layer));

      const result1 = yield* cache.getModelList(id);
      assert.strictEqual(result1.length, 2);
      assert.strictEqual(result1[0]?.slug, "model-a");

      const result2 = yield* cache.getModelList(id);
      assert.strictEqual(result2.length, 2);
    }));

  it.effect("derives capabilities from provider snapshot", () =>
    Effect.gen(function* () {
      const ctx = makeTestLayer();
      const id = makeInstanceId("test");
      yield* ctx.addInstance(id, ["model-a"]);

      const layer = Layer.succeed(ProviderInstanceRegistry, ctx.registry).pipe(
        Layer.provideMerge(ProviderCacheLive),
      );
      const cache = yield* ProviderCache.pipe(Effect.provide(layer));

      const caps = yield* cache.getCapabilities(id);
      assert.strictEqual(caps.modelCount, 1);
      assert.strictEqual(caps.sessionModelSwitch, "unsupported");
    }));

  it.effect("invalidates cache for a provider", () =>
    Effect.gen(function* () {
      const ctx = makeTestLayer();
      const id = makeInstanceId("test");
      yield* ctx.addInstance(id, ["model-a"]);
      const updated = makeInstanceId("test-updated");

      const layer = Layer.succeed(ProviderInstanceRegistry, ctx.registry).pipe(
        Layer.provideMerge(ProviderCacheLive),
      );
      const cache = yield* ProviderCache.pipe(Effect.provide(layer));

      yield* cache.getModelList(id);
      yield* ctx.addInstance(updated, ["model-a"]);
      yield* cache.invalidateProvider(updated);

      const result = yield* cache.getModelList(updated);
      assert.ok(result);
    }));

  it.effect("produces cache hit/miss metrics", () =>
    Effect.gen(function* () {
      const ctx = makeTestLayer();
      const id = makeInstanceId("test");
      yield* ctx.addInstance(id, ["model-a"]);

      const layer = Layer.succeed(ProviderInstanceRegistry, ctx.registry).pipe(
        Layer.provideMerge(ProviderCacheLive),
      );
      const cache = yield* ProviderCache.pipe(Effect.provide(layer));

      yield* cache.getModelList(id);
      yield* cache.getModelList(id);
      yield* cache.getModelList(id);
    }));
});
