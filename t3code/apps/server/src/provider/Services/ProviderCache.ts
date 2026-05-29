import type {
  ModelCapabilities,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
  ServerProviderModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import type * as Effect from "effect/Effect";

export class ProviderCacheLookupError extends Data.TaggedError("ProviderCacheLookupError")<{
  readonly message: string;
  readonly instanceId?: ProviderInstanceId;
}> {}

export interface ProviderCapabilitySnapshot {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly capabilities: ModelCapabilities | null;
  }>;
}

export interface ProviderCacheStats {
  readonly providerSnapshotEntries: number;
  readonly capabilityEntries: number;
}

export interface ProviderCacheShape {
  readonly getProviders: Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly refresh: (provider?: ProviderDriverKind) => Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly refreshInstance: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProvider>>;
  readonly getModelList: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>, ProviderCacheLookupError>;
  readonly getCapabilitySnapshot: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderCapabilitySnapshot, ProviderCacheLookupError>;
  readonly invalidateInstance: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
  readonly invalidateAll: Effect.Effect<void>;
  readonly stats: Effect.Effect<ProviderCacheStats>;
}

export class ProviderCache extends Context.Service<ProviderCache, ProviderCacheShape>()(
  "t3/provider/Services/ProviderCache",
) {}
