import { Context, Effect, Layer, Schedule } from "effect";

interface ProviderCacheConfig {
  modelListTTL: number;
  capabilityQueryTTL: number;
  maxCacheEntries: number;
}

const ProviderCache = Context.GenericTag<ProviderCacheService>("@services/ProviderCache");

interface ProviderCacheService {
  config: ProviderCacheConfig;
  modelListTTL: number;
  capabilityQueryTTL: number;
  maxCacheEntries: number;
}

export const makeProviderCache = (config: ProviderCacheConfig) => 
  Effect.gen(function*(_) {
    const modelListTTL = config.modelListTTL;
    const capabilityQueryTTL = config.capabilityQueryTTL;
    const maxCacheEntries = config.maxCacheEntries;
    
    return {
      modelListTTL,
      capabilityQueryTTL,
      maxCacheEntries,
      getModelList,
      getCapability
    };
  })

export const makeProviderCache = (config: ProviderCacheConfig) => 
  Effect.gen(function*(_) {
    const modelListTTL = config.modelListTTL;
    const capabilityQueryTTL = config.capabilityQueryTTL;
    const maxCacheEntries = config.maxCacheEntries;
    
    return {
      modelListTTL,
      capabilityQueryTTL,
      maxCacheEntries,
      getModelList,
      getCapability
    };
  })