import { describe, it, assert } from "@effect/vitest";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { makeProviderCache } from "./ProviderCache.ts";

const driver = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const fastModeCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

const makeProvider = (
  checkedAt: string,
  capabilities: ServerProvider["models"][number]["capabilities"] = fastModeCapabilities,
): ServerProvider => ({
  instanceId,
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt,
  models: [
    {
      slug: "gpt-test",
      name: "GPT Test",
      isCustom: false,
      capabilities,
    },
  ],
  slashCommands: [],
  skills: [],
});

describe("ProviderCache", () => {
  it.effect("caches provider model list refreshes until the model TTL expires", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache({
        modelListTtl: Duration.minutes(5),
        capabilityTtl: Duration.minutes(15),
      });
      const calls = yield* Ref.make(0);
      const refresh = Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) => makeProvider(`2026-07-05T00:00:0${count}.000Z`)),
      );
      const input = {
        instanceId,
        driver,
        refresh,
      };

      const first = yield* cache.refreshProvider(input);
      const second = yield* cache.refreshProvider(input);
      yield* TestClock.adjust(Duration.minutes(6));
      const third = yield* cache.refreshProvider(input);
      const stats = yield* cache.getStats;

      assert.strictEqual(first.checkedAt, "2026-07-05T00:00:01.000Z");
      assert.strictEqual(second.checkedAt, "2026-07-05T00:00:01.000Z");
      assert.strictEqual(third.checkedAt, "2026-07-05T00:00:02.000Z");
      assert.strictEqual(yield* Ref.get(calls), 2);
      assert.strictEqual(stats.modelHits, 1);
      assert.strictEqual(stats.modelMisses, 2);
    }),
  );

  it.effect("keeps cached capabilities available after the model-list TTL expires", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache({
        modelListTtl: Duration.minutes(5),
        capabilityTtl: Duration.minutes(15),
      });
      const calls = yield* Ref.make(0);
      const refresh = Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) =>
          count === 1
            ? makeProvider("2026-07-05T00:00:01.000Z", fastModeCapabilities)
            : makeProvider("2026-07-05T00:06:01.000Z", null),
        ),
      );
      const input = {
        instanceId,
        driver,
        refresh,
      };

      yield* cache.refreshProvider(input);
      yield* TestClock.adjust(Duration.minutes(6));
      const refreshed = yield* cache.refreshProvider(input);
      const stats = yield* cache.getStats;

      assert.strictEqual(refreshed.checkedAt, "2026-07-05T00:06:01.000Z");
      assert.deepStrictEqual(refreshed.models[0]?.capabilities, fastModeCapabilities);
      assert.strictEqual(stats.capabilityHits, 1);
      assert.strictEqual(stats.capabilityMisses, 1);
    }),
  );

  it.effect("invalidates cached provider data on demand", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const calls = yield* Ref.make(0);
      const refresh = Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) => makeProvider(`2026-07-05T00:00:0${count}.000Z`)),
      );
      const input = {
        instanceId,
        driver,
        refresh,
      };

      const first = yield* cache.refreshProvider(input);
      const cached = yield* cache.refreshProvider(input);
      yield* cache.invalidateProvider(instanceId);
      const refreshed = yield* cache.refreshProvider(input);
      const stats = yield* cache.getStats;

      assert.strictEqual(first.checkedAt, "2026-07-05T00:00:01.000Z");
      assert.strictEqual(cached.checkedAt, "2026-07-05T00:00:01.000Z");
      assert.strictEqual(refreshed.checkedAt, "2026-07-05T00:00:02.000Z");
      assert.strictEqual(stats.invalidations, 1);
    }),
  );

  it.effect("remembers streamed provider snapshots as the latest cached value", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const calls = yield* Ref.make(0);
      const refresh = Ref.updateAndGet(calls, (count) => count + 1).pipe(
        Effect.map((count) => makeProvider(`2026-07-05T00:00:0${count}.000Z`)),
      );
      const input = {
        instanceId,
        driver,
        refresh,
      };

      yield* cache.refreshProvider(input);
      yield* cache.rememberProvider(makeProvider("2026-07-05T00:00:09.000Z"));
      const cached = yield* cache.refreshProvider(input);

      assert.strictEqual(cached.checkedAt, "2026-07-05T00:00:09.000Z");
      assert.strictEqual(yield* Ref.get(calls), 1);
    }),
  );

  it.effect("deduplicates concurrent cache misses for the same provider instance", () =>
    Effect.gen(function* () {
      const cache = yield* makeProviderCache();
      const calls = yield* Ref.make(0);
      const release = yield* Deferred.make<void>();
      const refresh = Ref.update(calls, (count) => count + 1).pipe(
        Effect.andThen(Deferred.await(release)),
        Effect.as(makeProvider("2026-07-05T00:00:01.000Z")),
      );
      const input = {
        instanceId,
        driver,
        refresh,
      };

      const fiber = yield* Effect.all(
        [cache.refreshProvider(input), cache.refreshProvider(input), cache.refreshProvider(input)],
        { concurrency: "unbounded" },
      ).pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.strictEqual(yield* Ref.get(calls), 1);
      yield* Deferred.succeed(release, undefined);
      const providers = yield* Fiber.join(fiber);

      assert.strictEqual(yield* Ref.get(calls), 1);
      assert.deepStrictEqual(
        providers.map((provider) => provider.checkedAt),
        ["2026-07-05T00:00:01.000Z", "2026-07-05T00:00:01.000Z", "2026-07-05T00:00:01.000Z"],
      );
    }),
  );
});
