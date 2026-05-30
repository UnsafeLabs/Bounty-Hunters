```typescript
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
      // Use Effect.Cache's lookup function for caching
      const modelLists = await providerCache.lookup('modelLists', fetch);
      if (!modelLists) {
        const response = await fetch(`https://external-api.com/modelLists`);
        const result = await response.json();
        await providerCache.set('modelLists', result, 300000);
        return result;
      }

      // Use Effect.Cache's lookup function for caching
      const capabilityQueries = await providerCache.lookup('capabilityQueries', fetch);
      if (!capabilityQueries) {
        const response = await fetch(`https://external-api.com/capabilityQueries`);
        const result = await response.json();
        await providerCache.set('capabilityQueries', result, 900000);
        return result;
      }

      // Return cached values
      return { modelLists, capabilityQueries };
    },
    [hub],
  );
};

// Define fetch function for cache lookup
const fetch = async (key: string) => {
  try {
    const response = await fetch(`https://external-api.com/${key}`);
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Define capabilityQuery function for cache lookup
const capabilityQuery = async (key: string) => {
  try {
    const response = await fetch(`https://external-api.com/capabilityQueries/${key}`);
    if (!response.ok) throw new Error(response.statusText);
    return await response.json();
  } catch (error) {
    console.error(error);
    throw error;
  }
};
```