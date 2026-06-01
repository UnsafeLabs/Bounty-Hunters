/**
 * Runtime validation for provider configuration schemas.
 * Adds Effect Schema refinements for API keys, endpoints, and model configs.
 */

import { Schema } from "@effect/schema";

// API Key validation
export const ApiKeySchema = Schema.String.pipe(
  Schema.minLength(16, { message: () => "API key must be at least 16 characters" }),
  Schema.pattern(/^[a-zA-Z0-9_-]+$/, { message: () => "API key contains invalid characters" })
);

// URL validation
export const EndpointUrlSchema = Schema.String.pipe(
  Schema.pattern(/^https?:\/\/.+/, { message: () => "Must be a valid HTTP(S) URL" }),
  Schema.maxLength(2048, { message: () => "URL too long" })
);

// Model ID validation
export const ModelIdSchema = Schema.String.pipe(
  Schema.pattern(/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?$/, {
    message: () => "Model ID must be in format 'provider/model' or 'model'"
  })
);

// Provider config schema with refinements
export const ProviderConfigSchema = Schema.Struct({
  id: Schema.String.pipe(Schema.minLength(1)),
  name: Schema.String.pipe(Schema.minLength(1)),
  apiKey: ApiKeySchema,
  endpoint: EndpointUrlSchema,
  models: Schema.Array(ModelIdSchema),
  maxRetries: Schema.Number.pipe(Schema.int(), Schema.between(0, 10)),
  timeoutMs: Schema.Number.pipe(Schema.int(), Schema.between(1000, 300000)),
  rateLimitRpm: Schema.Number.pipe(Schema.int(), Schema.between(1, 100000)),
});

export type ProviderConfig = Schema.Schema.Type<typeof ProviderConfigSchema>;

/**
 * Validate provider config at runtime.
 */
export function validateProviderConfig(input: unknown): ProviderConfig {
  return Schema.decodeUnknownSync(ProviderConfigSchema)(input);
}

/**
 * Safe validation that returns Either.
 */
export function safeValidateProviderConfig(input: unknown) {
  return Schema.decodeUnknownEither(ProviderConfigSchema)(input);
}
