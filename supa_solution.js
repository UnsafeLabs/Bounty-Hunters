```
// ProviderCache.ts
import { EffectCache, EffectCacheOptions } from '@effect-cache/effect-cache';
import { Hub } from '@effect-cache/effect-hub';

const providerCache = new EffectCache({
  ttl: {
    modelLists: 300000, // 5 minutes
    capabilityQueries: 900000, // 15 minutes
  },
} as EffectCacheOptions);

const hub = new Hub();

providerCache.on('cacheInvalidated', () => {
  hub.emit('providerConfigChanged');
});

// Add cache hit/miss metrics to observability layer
const metrics = providerCache.metrics();

export const ProviderCacheService = () => {
  return effect(
    async (context) => {
      const modelLists = await providerCache.get<ModelList[]>('modelLists');
      // Cache hits: modelLists

      const capabilityQueries = await providerCache.get<CapabilityQuery[]>('capabilityQueries');
      // Cache hits: capabilityQueries

      // Use providerAPI function to call external API on cache miss
      return Effect.fromPromise(providerAPI, {
        ...providerCache.options,
        lookup: async (key) => {
          if (providerCache.has(key)) {
            return providerCache.get(key);
          }
          const result = await providerAPI(key);
          providerCache.set(key, result);
          return result;
        },
      });
    },
    [hub],
  );
};

// providerAPI function to call external API
const providerAPI = async (key: string): Promise<any> => {
  // Implement logic to call external API for the given key
  if (!key) throw new Error('Missing key');
  const result = await fetch(`https://external-api.com/${key}`).then((res) => res.json());
  return result;
};
```