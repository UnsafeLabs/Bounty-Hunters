import { describe, expect, it, vi } from "vitest";
import { ProviderCache } from "./ProviderCache.ts";

describe("ProviderCache (#865)", () => {
  it("serves hits within TTL", async () => {
    const cache = new ProviderCache({ modelsTtlMs: 60_000 });
    let calls = 0;
    const load = async () => {
      calls += 1;
      return ["gpt-4"];
    };
    await cache.getOrLoad("p1", "models", load);
    await cache.getOrLoad("p1", "models", load);
    expect(calls).toBe(1);
    expect(cache.metrics.hits).toBe(1);
    expect(cache.metrics.misses).toBe(1);
  });

  it("expires after TTL", async () => {
    const cache = new ProviderCache({ modelsTtlMs: 20 });
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    await cache.getOrLoad("p1", "models", load);
    await new Promise((r) => setTimeout(r, 30));
    await cache.getOrLoad("p1", "models", load);
    expect(calls).toBe(2);
  });

  it("dedupes concurrent misses to one lookup", async () => {
    const cache = new ProviderCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 40));
      return "ok";
    };
    const [a, b, c] = await Promise.all([
      cache.getOrLoad("p1", "capabilities", load),
      cache.getOrLoad("p1", "capabilities", load),
      cache.getOrLoad("p1", "capabilities", load),
    ]);
    expect(a).toBe("ok");
    expect(b).toBe("ok");
    expect(c).toBe("ok");
    expect(calls).toBe(1);
  });

  it("invalidates by provider id", async () => {
    const cache = new ProviderCache();
    let calls = 0;
    const load = async () => {
      calls += 1;
      return calls;
    };
    await cache.getOrLoad("p1", "models", load);
    cache.invalidateProvider("p1");
    await cache.getOrLoad("p1", "models", load);
    expect(calls).toBe(2);
    expect(cache.metrics.invalidations).toBeGreaterThanOrEqual(1);
  });

  it("bounds max entries", async () => {
    const cache = new ProviderCache({ maxEntries: 3 });
    for (let i = 0; i < 10; i++) {
      await cache.getOrLoad(`p${i}`, "models", async () => i);
    }
    expect(cache.size()).toBeLessThanOrEqual(3);
  });

  it("uses longer TTL for capabilities", () => {
    const cache = new ProviderCache({
      modelsTtlMs: 5_000,
      capabilitiesTtlMs: 15_000,
    });
    expect(cache.ttlFor("models")).toBe(5_000);
    expect(cache.ttlFor("capabilities")).toBe(15_000);
  });
});
