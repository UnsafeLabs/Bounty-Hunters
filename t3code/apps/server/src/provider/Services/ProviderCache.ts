import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";

export interface ProviderApiResponse {
  readonly models: unknown[];
  readonly capabilities: unknown;
  readonly timestamp: number;
}

export interface ProviderCacheShape {
  readonly getModels: (providerId: string) => Effect.Effect<ProviderApiResponse, never>;
  readonly getCapabilities: (providerId: string) => Effect.Effect<unknown, never>;
  readonly invalidate: (providerId: string) => Effect.Effect<void, never>;
  readonly invalidateAll: () => Effect.Effect<void, never>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/provider/Cache",
) {}

export const makeProviderCache = (
  ttlMs: number = 300_000, // 5 minutes default
): Effect.Effect<ProviderCacheShape> =>
  Effect.gen(function* () {
    const modelsCache = yield* Cache.make<string, ProviderApiResponse>({
      capacity: 64,
      timeToLive: Duration.millis(ttlMs),
      lookup: (providerId: string) =>
        Effect.tryPromise({
          try: async () => {
            // Fetch from external provider API
            const response = await fetch(`https://api.provider.com/v1/models/${providerId}`, {
              headers: { Accept: "application/json" },
            });
            const data = await response.json();
            return {
              models: data.models || [],
              capabilities: data.capabilities || {},
              timestamp: Date.now(),
            };
          },
          catch: () => new Error(`Failed to fetch models for ${providerId}`),
        }),
    });

    const capabilitiesCache = yield* Cache.make<string, unknown>({
      capacity: 128,
      timeToLive: Duration.millis(ttlMs),
      lookup: (key: string) =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(`https://api.provider.com/v1/capabilities/${key}`, {
              headers: { Accept: "application/json" },
            });
            return response.json();
          },
          catch: () => new Error(`Failed to fetch capabilities for ${key}`),
        }),
    });

    return ProviderCache.of({
      getModels: (providerId) => modelsCache.get(providerId).pipe(Effect.ignore),
      getCapabilities: (providerId) => capabilitiesCache.get(providerId).pipe(Effect.ignore),
      invalidate: (providerId) => modelsCache.invalidate(providerId).pipe(Effect.ignore),
      invalidateAll: () => modelsCache.invalidateAll().pipe(Effect.ignore),
    });
  });
