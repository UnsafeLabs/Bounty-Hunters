import type {
  ProviderInstanceId,
  ServerProviderModel,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { ProviderAdapterCapabilities } from "./ProviderAdapter.ts";

export interface ProviderCapabilities extends ProviderAdapterCapabilities {
  readonly modelCount: number;
  readonly capabilitiesByModel: ReadonlyArray<{
    readonly slug: string;
    readonly optionDescriptors: ReadonlyArray<string>;
  }>;
}

export class ProviderCacheEntryNotFoundError extends Context.TaggedError(
  "ProviderCacheEntryNotFoundError",
)<{ readonly instanceId: ProviderInstanceId; readonly cause?: unknown }>() {}

export type ProviderCacheError = ProviderCacheEntryNotFoundError;

export interface ProviderCacheShape {
  readonly getModelList: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ReadonlyArray<ServerProviderModel>, ProviderCacheError>;

  readonly getCapabilities: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderCapabilities, ProviderCacheError>;

  readonly invalidateProvider: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<void>;
}

export class ProviderCache extends Context.Service<
  ProviderCache,
  ProviderCacheShape
>()("t3/provider/Services/ProviderCache") {}
