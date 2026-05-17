/**
 * Provider Configuration Runtime Validation
 *
 * Validates provider configuration values at runtime using Effect Schema
 * refinements. Checks API key format, endpoint URL validity, and returns
 * all validation errors at once via a typed Either.
 *
 * @module providerConfigValidation
 */
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { ProviderInstanceConfig, ProviderInstanceConfigMap } from "./providerInstance.ts";
import { ProviderInstanceId, ProviderDriverKind } from "./providerInstance.ts";

// ---------------------------------------------------------------------------
// ProviderConfigError — Tagged error type
// ---------------------------------------------------------------------------

export class ProviderConfigError extends Data.TaggedError("ProviderConfigError")<{
  readonly field: string;
  readonly value: unknown;
  readonly expected: string;
  readonly instanceId?: string;
}> {}

// ---------------------------------------------------------------------------
// Validation rule definitions
// ---------------------------------------------------------------------------

interface ValidationRule {
  readonly field: string;
  readonly validate: (value: unknown, instanceId?: string) => ProviderConfigError | null;
}

/**
 * API key must be at least 10 characters and non-empty.
 */
const validateApiKey: ValidationRule = {
  field: "apiKey",
  validate: (value, instanceId) => {
    if (value === undefined || value === null) return null; // Optional field
    if (typeof value !== "string") {
      return new ProviderConfigError({
        field: "apiKey",
        value,
        expected: "string",
        instanceId,
      });
    }
    if (value.trim().length === 0) {
      return new ProviderConfigError({
        field: "apiKey",
        value: "(empty string)",
        expected: "Non-empty API key (at least 10 characters)",
        instanceId,
      });
    }
    if (value.length < 10) {
      return new ProviderConfigError({
        field: "apiKey",
        value: `${value.substring(0, 3)}...`,
        expected: "API key must be at least 10 characters",
        instanceId,
      });
    }
    return null;
  },
};

/**
 * Endpoint URL must be a valid HTTPS URL with proper hostname.
 */
const validateEndpointUrl: ValidationRule = {
  field: "endpointUrl",
  validate: (value, instanceId) => {
    if (value === undefined || value === null) return null; // Optional field
    if (typeof value !== "string") {
      return new ProviderConfigError({
        field: "endpointUrl",
        value,
        expected: "string URL",
        instanceId,
      });
    }
    if (value.trim().length === 0) {
      return new ProviderConfigError({
        field: "endpointUrl",
        value: "(empty string)",
        expected: "Valid HTTPS URL with hostname",
        instanceId,
      });
    }

    // Check for HTTP (should be HTTPS)
    if (value.startsWith("http://")) {
      return new ProviderConfigError({
        field: "endpointUrl",
        value,
        expected: "HTTPS URL required — HTTP URLs are insecure. Use https:// instead",
        instanceId,
      });
    }

    // Must be HTTPS
    if (!value.startsWith("https://")) {
      return new ProviderConfigError({
        field: "endpointUrl",
        value,
        expected: "Valid HTTPS URL (e.g. https://api.example.com)",
        instanceId,
      });
    }

    // Validate URL structure
    try {
      const url = new URL(value);
      if (!url.hostname || url.hostname === "") {
        return new ProviderConfigError({
          field: "endpointUrl",
          value,
          expected: "HTTPS URL must have a valid hostname",
          instanceId,
        });
      }
      // Check for localhost in production-like configs
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        // Allow localhost but note it
        return null;
      }
    } catch {
      return new ProviderConfigError({
        field: "endpointUrl",
        value,
        expected: "Valid HTTPS URL format",
        instanceId,
      });
    }

    return null;
  },
};

/**
 * Validate that the driver field is present and valid.
 */
const validateDriver: ValidationRule = {
  field: "driver",
  validate: (value, instanceId) => {
    if (value === undefined || value === null || value === "") {
      return new ProviderConfigError({
        field: "driver",
        value,
        expected: "Non-empty driver kind (e.g. 'codex', 'claudeAgent')",
        instanceId,
      });
    }
    // Validate driver slug pattern
    const pattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
    if (typeof value !== "string" || !pattern.test(value)) {
      return new ProviderConfigError({
        field: "driver",
        value,
        expected: "Driver must start with a letter and contain only letters, digits, - and _",
        instanceId,
      });
    }
    return null;
  },
};

/**
 * Validate environment variables in the config.
 */
const validateEnvironment: ValidationRule = {
  field: "environment",
  validate: (value, instanceId) => {
    if (value === undefined || value === null) return null;
    if (!Array.isArray(value)) {
      return new ProviderConfigError({
        field: "environment",
        value,
        expected: "Array of environment variable objects",
        instanceId,
      });
    }
    // Check individual env vars for sensitive keys that look like API keys
    for (const envVar of value) {
      if (envVar && typeof envVar === "object" && "name" in envVar) {
        const name = (envVar as any).name;
        const val = (envVar as any).value;
        // If the name suggests it's an API key and the value looks too short
        if (
          typeof name === "string" &&
          /api[_-]?key|secret|token|password/i.test(name) &&
          typeof val === "string" &&
          val.length > 0 &&
          val.length < 10
        ) {
          return new ProviderConfigError({
            field: `environment.${name}`,
            value: `${val.substring(0, 3)}...`,
            expected: "API key / secret values must be at least 10 characters",
            instanceId,
          });
        }
      }
    }
    return null;
  },
};

// All validation rules
const VALIDATION_RULES: ReadonlyArray<ValidationRule> = [
  validateDriver,
  validateApiKey,
  validateEndpointUrl,
  validateEnvironment,
];

// ---------------------------------------------------------------------------
// validateProviderConfig — Main validation function
// ---------------------------------------------------------------------------

export interface ProviderConfigInput {
  readonly driver?: unknown;
  readonly displayName?: unknown;
  readonly apiKey?: unknown;
  readonly endpointUrl?: unknown;
  readonly environment?: unknown;
  readonly enabled?: unknown;
  readonly config?: unknown;
  readonly instanceId?: string;
}

/**
 * Validates a single provider configuration.
 * Returns Either with all validation errors (not just the first).
 */
export const validateProviderConfig = (
  providerConfig: ProviderConfigInput,
): Either.Either<ReadonlyArray<ProviderConfigError>, ProviderConfigInput> => {
  const errors: Array<ProviderConfigError> = [];

  // Extract config fields (some might be in the `config` unknown envelope)
  const configObj =
    providerConfig.config && typeof providerConfig.config === "object"
      ? (providerConfig.config as Record<string, unknown>)
      : {};

  // Build the full set of values to validate
  const valuesToValidate = {
    driver: providerConfig.driver ?? configObj.driver,
    apiKey: providerConfig.apiKey ?? configObj.apiKey ?? configObj.api_key,
    endpointUrl:
      providerConfig.endpointUrl ?? configObj.endpointUrl ?? configObj.endpoint_url ?? configObj.baseURL,
    environment: providerConfig.environment ?? configObj.environment,
    enabled: providerConfig.enabled ?? configObj.enabled,
  };

  for (const rule of VALIDATION_RULES) {
    const value = (valuesToValidate as any)[rule.field];
    // Only validate if the field is present
    if (value !== undefined) {
      const error = rule.validate(value, providerConfig.instanceId);
      if (error !== null) {
        errors.push(error);
      }
    }
  }

  // Also validate driver is present (it's required)
  if (valuesToValidate.driver === undefined) {
    errors.push(
      new ProviderConfigError({
        field: "driver",
        value: undefined,
        expected: "Required field — must specify a driver kind",
        instanceId: providerConfig.instanceId,
      }),
    );
  }

  if (errors.length > 0) {
    return Either.left(errors);
  }

  return Either.right(providerConfig);
};

/**
 * Validates all provider instances in a config map.
 * Returns Either with all errors across all instances.
 */
export const validateAllProviderConfigs = (
  configMap: Record<string, ProviderConfigInput>,
): Either.Either<ReadonlyArray<ProviderConfigError>, Record<string, ProviderConfigInput>> => {
  const allErrors: Array<ProviderConfigError> = [];

  for (const [instanceId, config] of Object.entries(configMap)) {
    const result = validateProviderConfig({ ...config, instanceId });
    if (Either.isLeft(result)) {
      allErrors.push(...result.left);
    }
  }

  if (allErrors.length > 0) {
    return Either.left(allErrors);
  }

  return Either.right(configMap);
};

// ---------------------------------------------------------------------------
// Effect Schema refinements
// ---------------------------------------------------------------------------

/**
 * Refined API key schema: non-empty, at least 10 characters.
 */
export const ApiKeySchema = Schema.String.pipe(
  Schema.minLength(10, { message: () => "API key must be at least 10 characters" }),
  Schema.nonEmptyString({ message: () => "API key cannot be empty" }),
);

/**
 * Refined HTTPS URL schema.
 */
export const HttpsUrlSchema = Schema.String.pipe(
  Schema.pattern(/^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*(:[0-9]+)?(\/.*)?$/, {
    message: () => "Must be a valid HTTPS URL with hostname (e.g. https://api.example.com)",
  }),
);

/**
 * Schema for a validated provider configuration with API key and endpoint.
 */
export const ValidatedProviderConfigSchema = Schema.Struct({
  driver: Schema.String.pipe(
    Schema.pattern(/^[a-zA-Z][a-zA-Z0-9_-]*$/, {
      message: () => "Driver must start with a letter and contain only letters, digits, - and _",
    }),
  ),
  apiKey: Schema.optional(ApiKeySchema),
  endpointUrl: Schema.optional(HttpsUrlSchema),
  displayName: Schema.optional(Schema.String),
  enabled: Schema.optional(Schema.Boolean),
  environment: Schema.optional(Schema.Array(Schema.Unknown)),
  config: Schema.optional(Schema.Unknown),
});
