import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ProviderInstanceConfig, ProviderInstanceId } from "./providerInstance.ts";
import { CodexSettings, ClaudeSettings, CursorSettings, OpenCodeSettings } from "./settings.ts";

export class ProviderConfigValidationError extends Data.TaggedError(
  "ProviderConfigValidationError",
)<{
  readonly instanceId: string;
  readonly driver: string;
  readonly errors: ReadonlyArray<ProviderConfigFieldError>;
}> {
  override get message() {
    return `Provider '${this.instanceId}' (${this.driver}) has ${this.errors.length} invalid field(s)`;
  }
}

export interface ProviderConfigFieldError {
  readonly field: string;
  readonly message: string;
}

export interface ProviderConfigResult {
  readonly valid: ReadonlyArray<{ instanceId: string; driver: string }>;
  readonly invalid: ReadonlyArray<ProviderConfigValidationError>;
}

const driverSchemaMap: Record<string, Schema.Schema.All | undefined> = {
  codex: CodexSettings,
  claudeAgent: ClaudeSettings,
  cursor: CursorSettings,
  opencode: OpenCodeSettings,
};

function validateSingleConfig(
  instanceId: string,
  config: typeof ProviderInstanceConfig.Type,
): Effect.Effect<void, ProviderConfigValidationError> {
  const driverSchema = driverSchemaMap[config.driver];
  if (!driverSchema) {
    return Effect.void;
  }

  const configPayload = config.config ?? {};
  return Schema.decodeUnknown(driverSchema)(configPayload).pipe(
    Effect.mapError((parseErrors) => {
      const errors: Array<ProviderConfigFieldError> = [];
      for (const pe of parseErrors.errors) {
        const path = pe.path?.map((p) =>
          typeof p === "string" ? p : String(p),
        ).join(".") ?? "<root>";
        errors.push({ field: path, message: pe.message });
      }
      return new ProviderConfigValidationError({
        instanceId,
        driver: config.driver,
        errors,
      });
    }),
    Effect.as(void 0),
  );
}

export function validateProviderInstances(
  instances: Record<string, typeof ProviderInstanceConfig.Type>,
): Effect.Effect<ProviderConfigResult, never> {
  const entries = Object.entries(instances);
  if (entries.length === 0) {
    return Effect.succeed({ valid: [], invalid: [] });
  }

  return Effect.partition(entries, ([id, config]) =>
    validateSingleConfig(id, config)
  ).pipe(
    Effect.map(([errors, _]) => ({
      valid: entries
        .filter(([id, config]) =>
          !errors.some((e) => e.instanceId === id)
        )
        .map(([instanceId, config]) => ({ instanceId, driver: config.driver })),
      invalid: errors,
    })),
  );
}

export function validateProviderInstance(
  instanceId: string,
  config: typeof ProviderInstanceConfig.Type,
): Effect.Effect<void, ProviderConfigValidationError> {
  return validateSingleConfig(instanceId, config);
}

export function validateConfigOnLoad(
  instances: Record<string, typeof ProviderInstanceConfig.Type>,
): Effect.Effect<Record<string, typeof ProviderInstanceConfig.Type>, never> {
  return validateProviderInstances(instances).pipe(
    Effect.flatMap((result) => {
      if (result.invalid.length > 0) {
        for (const err of result.invalid) {
          for (const fieldErr of err.errors) {
            console.error(
              `[ProviderConfig] ${err.instanceId} (${err.driver}): ${fieldErr.field} - ${fieldErr.message}`,
            );
          }
        }
      }
      return Effect.succeed(instances);
    }),
  );
}
