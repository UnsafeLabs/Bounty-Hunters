import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ProviderInstanceConfig } from "./providerInstance.ts";

const API_KEY_FIELD_PATTERN = /(?:api[_-]?key|apiKey|token|secret|credential)/i;
const ENDPOINT_FIELD_PATTERN = /(?:endpoint|url|base[_-]?url|api[_-]?url)/i;
const API_KEY_MIN_LENGTH = 10;

export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    field: Schema.String,
    invalidValue: Schema.Unknown,
    expected: Schema.String,
    message: Schema.String,
  },
) {}

export type ProviderConfigValidationResult = Result.Result<
  ProviderInstanceConfig,
  ReadonlyArray<ProviderConfigError>
>;

export const ProviderApiKeyValue = Schema.String.check(
  Schema.isMinLength(API_KEY_MIN_LENGTH),
);

export const ProviderHttpsEndpointUrl = Schema.String.check(
  Schema.isPattern(/^https:\/\/[^/\s]+(?:\/.*)?$/),
);

function makeError(input: {
  readonly field: string;
  readonly invalidValue: unknown;
  readonly expected: string;
  readonly message: string;
}): ProviderConfigError {
  return new ProviderConfigError(input);
}

function validateApiKey(field: string, value: unknown): ProviderConfigError | null {
  if (typeof value !== "string") {
    return makeError({
      field,
      invalidValue: value,
      expected: `string API key with at least ${API_KEY_MIN_LENGTH} characters`,
      message: "API key fields must be strings.",
    });
  }

  if (value.trim().length < API_KEY_MIN_LENGTH) {
    return makeError({
      field,
      invalidValue: value,
      expected: `non-empty API key with at least ${API_KEY_MIN_LENGTH} characters`,
      message: `API key must be at least ${API_KEY_MIN_LENGTH} characters long.`,
    });
  }

  return null;
}

function validateEndpoint(field: string, value: unknown): ProviderConfigError | null {
  if (typeof value !== "string") {
    return makeError({
      field,
      invalidValue: value,
      expected: "valid HTTPS URL with hostname",
      message: "Endpoint URL fields must be strings.",
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return makeError({
      field,
      invalidValue: value,
      expected: "valid HTTPS URL with hostname",
      message: "Endpoint URL is malformed.",
    });
  }

  if (parsed.protocol === "http:") {
    return makeError({
      field,
      invalidValue: value,
      expected: "HTTPS URL",
      message: "Endpoint URL must use HTTPS, not HTTP.",
    });
  }

  if (parsed.protocol !== "https:" || parsed.hostname.trim().length === 0) {
    return makeError({
      field,
      invalidValue: value,
      expected: "valid HTTPS URL with hostname",
      message: "Endpoint URL must be a valid HTTPS URL with a hostname.",
    });
  }

  return null;
}

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectConfigErrors(
  value: unknown,
  path: string,
  errors: Array<ProviderConfigError>,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectConfigErrors(entry, `${path}[${index}]`, errors));
    return;
  }

  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    const field = path.length > 0 ? `${path}.${key}` : key;
    if (API_KEY_FIELD_PATTERN.test(key)) {
      const error = validateApiKey(field, child);
      if (error) errors.push(error);
    }
    if (ENDPOINT_FIELD_PATTERN.test(key)) {
      const error = validateEndpoint(field, child);
      if (error) errors.push(error);
    }
    collectConfigErrors(child, field, errors);
  }
}

function validateDecodedProviderConfig(decoded: ProviderInstanceConfig): ProviderConfigValidationResult {
  const errors: Array<ProviderConfigError> = [];

  for (const environmentVariable of decoded.environment ?? []) {
    const field = `environment.${environmentVariable.name}`;
    if (API_KEY_FIELD_PATTERN.test(environmentVariable.name)) {
      const error = validateApiKey(field, environmentVariable.value);
      if (error) errors.push(error);
    }
    if (ENDPOINT_FIELD_PATTERN.test(environmentVariable.name)) {
      const error = validateEndpoint(field, environmentVariable.value);
      if (error) errors.push(error);
    }
  }

  collectConfigErrors(decoded.config, "config", errors);

  return errors.length > 0 ? Result.fail(errors) : Result.succeed(decoded);
}

export function validateProviderConfig(input: unknown): ProviderConfigValidationResult {
  try {
    return validateDecodedProviderConfig(Schema.decodeUnknownSync(ProviderInstanceConfig)(input));
  } catch (cause) {
    return Result.fail([
      makeError({
        field: "config",
        invalidValue: input,
        expected: "ProviderInstanceConfig schema",
        message: `Provider config failed schema validation: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      }),
    ]);
  }
}

export const validateProviderConfigUnknown = validateProviderConfig;
