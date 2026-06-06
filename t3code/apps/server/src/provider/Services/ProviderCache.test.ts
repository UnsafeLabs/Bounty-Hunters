import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { it, assert } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeProviderCache } from "./ProviderCache.ts";

const instanceId = ProviderInstanceId.make("codex");
const driverKind = ProviderDriverKind.make("codex");

const makeProvider = (version: number): ServerProvider =>
  ({
    instanceId,
    driver: driverKind,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-06-06T00:00:00.000Z",
    models: [
      { slug: `model-${version}`, name: `Model ${version}`, isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
  });

it.effect("serves model lists from cache until TTL expires", () =>
  Effect.gen(function* () {
    const cache = yield* makeProviderCache({ modelListTtl: "1 minute" });
    const calls = yield* Ref.make(0);
    const lookup = Ref.updateAndGet(calls, (value) => value + 1).pipe(Effect.map(makeProvider));

    assert.strictEqual((yield* cache.getModelList(instanceId, lookup)).models[0]?.slug, "model-1");
    assert.strictEqual((yield* cache.getModelList(instanceId, lookup)).models[0]?.slug, "model-1");
    assert.strictEqual(yield* Ref.get(calls), 1);

    yield* TestClock.adjust("61 seconds");

    assert.strictEqual((yield* cache.getModelList(instanceId, lookup)).models[0]?.slug, "model-2");
    assert.strictEqual(yield* Ref.get(calls), 2);
  }),
);

it.effect("invalidates provider entries on config changes", () =>
  Effect.gen(function* () {
    const cache = yield* makeProviderCache({ modelListTtl: "5 minutes" });
    const calls = yield* Ref.make(0);
    const lookup = Ref.updateAndGet(calls, (value) => value + 1).pipe(Effect.map(makeProvider));

    yield* cache.getModelList(instanceId, lookup);
    yield* cache.invalidateProvider(instanceId);
    assert.strictEqual((yield* cache.getModelList(instanceId, lookup)).models[0]?.slug, "model-2");
  }),
);

it.effect("deduplicates concurrent same-key model list misses", () =>
  Effect.gen(function* () {
    const cache = yield* makeProviderCache({ modelListTtl: "5 minutes" });
    const calls = yield* Ref.make(0);
    const lookup = Effect.gen(function* () {
      yield* Ref.update(calls, (value) => value + 1);
      yield* Effect.sleep("1 second");
      return makeProvider(1);
    });

    const left = yield* cache.getModelList(instanceId, lookup).pipe(Effect.forkScoped);
    const right = yield* cache.getModelList(instanceId, lookup).pipe(Effect.forkScoped);
    yield* TestClock.adjust("1 second");
    yield* Fiber.join(left);
    yield* Fiber.join(right);

    assert.strictEqual(yield* Ref.get(calls), 1);
  }),
);

it.effect("tracks hit and miss stats for model lists and capabilities", () =>
  Effect.gen(function* () {
    const cache = yield* makeProviderCache({ modelListTtl: "5 minutes", capabilityTtl: "15 minutes" });
    yield* cache.getModelList(instanceId, Effect.succeed(makeProvider(1)));
    yield* cache.getModelList(instanceId, Effect.succeed(makeProvider(2)));
    yield* cache.getCapabilities(instanceId, Effect.succeed({ sessionModelSwitch: "unsupported" }));
    yield* cache.getCapabilities(instanceId, Effect.succeed({ sessionModelSwitch: "in-session" }));

    assert.deepStrictEqual(yield* cache.getStats, {
      modelList: { hits: 1, misses: 1 },
      capabilities: { hits: 1, misses: 1 },
    });
  }),
);
