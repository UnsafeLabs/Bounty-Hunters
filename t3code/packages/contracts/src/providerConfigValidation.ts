/**
 * Runtime validation for provider configuration values.
 *
 * The provider contracts (`provider.ts`, `providerInstance.ts`) intentionally
 * keep driver-specific configuration opaque at the schema layer — envelopes for
 * unknown drivers must round-trip without loss, so `ProviderInstanceConfig`
 * cannot tighten constraints on individual config values without breaking that
 * invariant.
 *
 * This module adds an **opt-in** validation layer on top of those contracts:
 * reusable Effect Schema refinements for the two value shapes drivers care
 * about most (API keys and HTTPS endpoint URLs), plus `validateProviderConfig`,
 * which runs every refinement, collects *all* failures, and maps Effect Schema
 * decode errors into a tagged `ProviderConfigError` carrying the field name, the
 * offending value, and the expected format.
 *
 * Because validation is opt-in and never wired into `ProviderInstanceConfig`'s
 * decoder, existing persisted configurations continue to decode unchanged.
 *
 * @module providerConfigValidation
 */
import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { TrimmedString } from "./baseSchemas.ts";

/** Minimum number of (trimmed) characters an API key must contain. */
const API_KEY_MIN_LENGTH = 10;
/**
 * API keys must be a single run of printable, non-whitespace ASCII. This
 * rejects blank, whitespace-only, control-character and multi-token values
 * while staying permissive enough for every real provider key format
 * (`sk-...`, `sk-or-...`, hex, base64url, …).
 */
const API_KEY_PATTERN = /^[\x21-\x7e]+$/;

export const API_KEY_EXPECTED_FORMAT = "a non-empty key of at least 10 characters";
export const ENDPOINT_URL_EXPECTED_FORMAT = "a valid https:// URL with a hostname";

/**
 * Refinement schema for a provider API key. Trims, then requires the key to be
 * non-empty, at least {@link API_KEY_MIN_LENGTH} characters, and match
 * {@link API_KEY_PATTERN}. Drivers may compose this into their own config
 * schemas; `validateProviderConfig` uses it for ad-hoc validation.
 */
export const ProviderApiKey = TrimmedString.check(
  Schema.isMinLength(API_KEY_MIN_LENGTH),
  Schema.isPattern(API_KEY_PATTERN),
).annotate({ identifier: "ProviderApiKey" });
export type ProviderApiKey = typeof ProviderApiKey.Type;

/**
 * Refinement schema for a provider endpoint URL. Trims, then requires a
 * well-formed URL that uses the `https:` scheme and carries a hostname. HTTP
 * URLs are rejected with a message that points at HTTPS; other schemes and
 * malformed URLs get their own messages.
 */
export const ProviderEndpointUrl = TrimmedString.check(
  Schema.makeFilter(
    (value) => {
      if (value.length === 0) {
        return new SchemaIssue.InvalidValue(Option.some(value), {
          message: "endpoint URL must not be empty",
        });
      }

      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        return new SchemaIssue.InvalidValue(Option.some(value), {
          message: `"${value}" is not a valid URL`,
        });
      }

      if (parsed.protocol === "http:") {
        return new SchemaIssue.InvalidValue(Option.some(value), {
          message: "endpoint URL must use HTTPS; replace http:// with https://",
        });
      }
      if (parsed.protocol !== "https:") {
        return new SchemaIssue.InvalidValue(Option.some(value), {
          message: `endpoint URL must use the https:// scheme (received ${parsed.protocol}//)`,
        });
      }
      if (parsed.hostname.length === 0) {
        return new SchemaIssue.InvalidValue(Option.some(value), {
          message: "endpoint URL must include a hostname",
        });
      }

      return true;
    },
    { identifier: "ProviderEndpointUrl" },
  ),
).annotate({ identifier: "ProviderEndpointUrl" });
export type ProviderEndpointUrl = typeof ProviderEndpointUrl.Type;

/**
 * Tagged error describing a single invalid provider configuration value.
 *
 * Carries the offending `field`, its `value`, the human-readable
 * `expectedFormat`, and the underlying schema `detail` so callers can render a
 * precise message or branch on the field.
 */
export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    field: Schema.String,
    value: Schema.String,
    expectedFormat: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid provider configuration for "${this.field}": ${this.detail} (expected ${this.expectedFormat})`;
  }
}

/**
 * Provider configuration values to validate. Fields are optional; an `undefined`
 * field is treated as "not provided" and skipped, while an empty string is
 * treated as a provided-but-invalid value.
 */
export interface ProviderConfigInput {
  readonly apiKey?: string | undefined;
  readonly endpointUrl?: string | undefined;
}

const decodeApiKeyExit = Schema.decodeUnknownExit(ProviderApiKey);
const decodeEndpointUrlExit = Schema.decodeUnknownExit(ProviderEndpointUrl);
const formatSchemaIssue = SchemaIssue.makeFormatterDefault();

/** Map a failed decode's cause to a readable, schema-derived message. */
const causeDetail = (cause: Cause.Cause<Schema.SchemaError>): string => {
  const squashed = Cause.squash(cause);
  return Schema.isSchemaError(squashed) ? formatSchemaIssue(squashed.issue) : Cause.pretty(cause);
};

const validateField = (
  field: string,
  value: string,
  expectedFormat: string,
  decode: (input: string) => Exit.Exit<string, Schema.SchemaError>,
): ProviderConfigError | undefined => {
  const result = decode(value);
  if (Exit.isFailure(result)) {
    return new ProviderConfigError({
      field,
      value,
      expectedFormat,
      detail: causeDetail(result.cause),
    });
  }
  return undefined;
};

/**
 * Validate a provider configuration's API key and endpoint URL.
 *
 * Runs every applicable refinement and accumulates **all** failures rather than
 * stopping at the first, so a caller sees every problem in one pass. Returns an
 * Effect `Result` (the Effect 4 successor to `Either`): a success carrying the
 * original input when valid, or a failure carrying the full list of
 * {@link ProviderConfigError}s.
 */
export const validateProviderConfig = (
  input: ProviderConfigInput,
): Result.Result<ProviderConfigInput, ReadonlyArray<ProviderConfigError>> => {
  const errors: ProviderConfigError[] = [];

  if (input.apiKey !== undefined) {
    const error = validateField("apiKey", input.apiKey, API_KEY_EXPECTED_FORMAT, decodeApiKeyExit);
    if (error !== undefined) {
      errors.push(error);
    }
  }

  if (input.endpointUrl !== undefined) {
    const error = validateField(
      "endpointUrl",
      input.endpointUrl,
      ENDPOINT_URL_EXPECTED_FORMAT,
      decodeEndpointUrlExit,
    );
    if (error !== undefined) {
      errors.push(error);
    }
  }

  return errors.length === 0 ? Result.succeed(input) : Result.fail(errors);
};
