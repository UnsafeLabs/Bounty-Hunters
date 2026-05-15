/**
 * Provider-instance contracts.
 *
 * Splits the historical "provider kind" concept into two:
 *
 *   - `ProviderDriverKind` is the implementation kind selector (e.g. codex,
 *     claudeAgent, a fork's `ollama`, …). It picks which driver package
 *     handles the protocol, the probe, the adapter, and text generation.
 *
 *   - `ProviderInstanceId` is the routing key (a user-defined slug).
 *     Threads, sessions, runtime events, and persisted bindings reference
 *     instance ids — never driver kinds — so a user can configure multiple
 *     instances of the same driver (e.g. `codex_personal` + `codex_work`),
 *     each with independent driver-specific configuration.
 *
 * Forward/backward compatibility invariant
 * ----------------------------------------
 * `ProviderDriverKind` is intentionally an **open** branded slug, not a closed
 * literal union. The server hosts forks, ships in PRs that add drivers, and
 * users frequently roll between branches and forks. Any of those paths can
 * leave `ServerSettings`, persisted thread state, or session bindings
 * referencing a driver that the currently-running build does not know about.
 *
 * The rule: parsing any of those payloads must always succeed, and the
 * runtime is responsible for marking the unknown driver/instance as
 * "unavailable" rather than crashing. Built-in drivers shipped by the core
 * product happens to register in a given build is not part of the contract
 * layer. Driver availability is discovered through the runtime registry.
 *
 * Driver-specific configuration is similarly opaque at the contracts layer:
 * drivers live in (or will be extracted to) their own packages and own their
 * config schemas. The contracts package only knows the envelope.
 *
 * @module providerInstance
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const PROVIDER_SLUG_MAX_CHARS = 64;
/**
 * Slug pattern shared by driver kinds and instance ids — letters, digits,
 * dashes, underscores. The first character must be a letter so slugs remain
 * JS-identifier friendly when used as object keys, log fields, or telemetry
 * attributes. Mixed case is permitted so historical driver kinds (e.g.
 * `claudeAgent`) can be used verbatim during the migration and so external
 * fork authors retain reasonable freedom.
 */
const PROVIDER_SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ENVIRONMENT_VARIABLE_NAME_MAX_CHARS = 128;
const ENVIRONMENT_VARIABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const PROVIDER_API_KEY_PATTERN = /^[^\s]+$/;

const slugSchema = TrimmedNonEmptyString.check(
  Schema.isMaxLength(PROVIDER_SLUG_MAX_CHARS),
  Schema.isPattern(PROVIDER_SLUG_PATTERN),
);

/**
 * `ProviderDriverKind` — open branded slug naming a driver implementation.
 *
 * Constraints (validated at the schema layer):
 *   - starts with a letter
 *   - only letters, digits, `-`, `_` after the first char
 *   - 1..64 characters
 *
 * Notably **not** validated: that the driver is one we know how to load.
 * That check belongs to the runtime registry, which downgrades unknown
 * drivers gracefully (see module docs).
 */
export const ProviderDriverKind = slugSchema.pipe(Schema.brand("ProviderDriverKind"));
export type ProviderDriverKind = typeof ProviderDriverKind.Type;

const isProviderDriverKindValue = Schema.is(ProviderDriverKind);
export const isProviderDriverKind = (value: unknown): value is ProviderDriverKind =>
  isProviderDriverKindValue(value);

/**
 * `ProviderInstanceId` — user-defined routing key for a configured provider
 * instance. Same slug rules as `ProviderDriverKind`; branded separately so the
 * type system cannot confuse the two.
 */
export const ProviderInstanceId = slugSchema.pipe(Schema.brand("ProviderInstanceId"));
export type ProviderInstanceId = typeof ProviderInstanceId.Type;

/**
 * Lightweight reference identifying which driver implements an instance.
 * Carried alongside `ProviderInstanceId` on wire shapes so consumers can
 * branch on driver behavior (icons, capabilities, presentation) without
 * having to look up the instance in the registry.
 */
export const ProviderInstanceRef = Schema.Struct({
  instanceId: ProviderInstanceId,
  driver: ProviderDriverKind,
});
export type ProviderInstanceRef = typeof ProviderInstanceRef.Type;

export const ProviderInstanceEnvironmentVariableName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ENVIRONMENT_VARIABLE_NAME_MAX_CHARS),
  Schema.isPattern(ENVIRONMENT_VARIABLE_NAME_PATTERN),
);
export type ProviderInstanceEnvironmentVariableName =
  typeof ProviderInstanceEnvironmentVariableName.Type;

export const ProviderInstanceEnvironmentVariable = Schema.Struct({
  name: ProviderInstanceEnvironmentVariableName,
  value: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed(""))),
  sensitive: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  valueRedacted: Schema.optionalKey(Schema.Boolean),
});
export type ProviderInstanceEnvironmentVariable = typeof ProviderInstanceEnvironmentVariable.Type;

export const ProviderInstanceEnvironment = Schema.Array(ProviderInstanceEnvironmentVariable);
export type ProviderInstanceEnvironment = typeof ProviderInstanceEnvironment.Type;

export const ProviderApiKeyValue = TrimmedNonEmptyString.check(
  Schema.isMinLength(10),
  Schema.isPattern(PROVIDER_API_KEY_PATTERN),
);
export type ProviderApiKeyValue = typeof ProviderApiKeyValue.Type;

export const ProviderHttpsEndpointUrl = TrimmedNonEmptyString.check(
  Schema.isPattern(/^https:\/\/[^\s/?#]+[^\s]*$/i),
);
export type ProviderHttpsEndpointUrl = typeof ProviderHttpsEndpointUrl.Type;

export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    field: TrimmedNonEmptyString,
    invalidValue: Schema.String,
    expected: TrimmedNonEmptyString,
    reason: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect),
  },
) {
  override get message(): string {
    return `Invalid provider config field ${this.field}: expected ${this.expected}`;
  }
}

/**
 * Envelope shape for a provider instance configuration in `ServerSettings`.
 *
 * `driver` is intentionally accepted as any well-formed slug (see module
 * docs). The driver-specific config payload is left as `Schema.Unknown`;
 * each driver registers its own decoder with the runtime registry, and
 * envelopes for unknown drivers are preserved verbatim so they round-trip
 * across version changes without data loss.
 */
export const ProviderInstanceConfig = Schema.Struct({
  driver: ProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
  enabled: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Unknown),
});
export type ProviderInstanceConfig = typeof ProviderInstanceConfig.Type;

/**
 * Map shape for `ServerSettings.providerInstances`. Keyed by
 * `ProviderInstanceId`, values are envelopes the registry feeds to drivers.
 */
export const ProviderInstanceConfigMap = Schema.Record(ProviderInstanceId, ProviderInstanceConfig);
export type ProviderInstanceConfigMap = typeof ProviderInstanceConfigMap.Type;

const decodeProviderInstanceConfig = Schema.decodeUnknownSync(ProviderInstanceConfig);
const decodeProviderApiKeyValue = Schema.decodeUnknownSync(ProviderApiKeyValue);
const decodeProviderHttpsEndpointUrl = Schema.decodeUnknownSync(ProviderHttpsEndpointUrl);

const API_KEY_EXPECTED_FORMAT = "a non-empty API key of at least 10 characters with no whitespace";
const HTTPS_ENDPOINT_EXPECTED_FORMAT = "a valid HTTPS URL with a hostname";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeFieldName = (fieldName: string): string =>
  fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

const isApiKeyFieldName = (fieldName: string): boolean => {
  const normalized = normalizeFieldName(fieldName);
  return normalized.endsWith("apikey");
};

const isEndpointFieldName = (fieldName: string): boolean => {
  const normalized = normalizeFieldName(fieldName);
  return (
    normalized === "url" ||
    normalized.endsWith("url") ||
    normalized === "endpoint" ||
    normalized.endsWith("endpoint")
  );
};

const describeInvalidSchemaValue = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "[array]";
  }
  if (typeof value === "object") {
    return "[object]";
  }
  return String(value);
};

const createProviderConfigError = (
  field: string,
  invalidValue: string,
  expected: string,
  reason: string,
  cause?: unknown,
): ProviderConfigError =>
  new ProviderConfigError({
    field,
    invalidValue,
    expected,
    reason,
    cause,
  });

const validateApiKeyField = (
  field: string,
  value: string,
  errors: Array<ProviderConfigError>,
): void => {
  try {
    decodeProviderApiKeyValue(value);
  } catch (cause) {
    errors.push(
      createProviderConfigError(
        field,
        value,
        API_KEY_EXPECTED_FORMAT,
        "API key must be at least 10 characters and cannot contain whitespace",
        cause,
      ),
    );
  }
};

const validateEndpointField = (
  field: string,
  value: string,
  errors: Array<ProviderConfigError>,
): void => {
  try {
    decodeProviderHttpsEndpointUrl(value);
  } catch (cause) {
    errors.push(
      createProviderConfigError(
        field,
        value,
        HTTPS_ENDPOINT_EXPECTED_FORMAT,
        value.trim().toLowerCase().startsWith("http://")
          ? "Endpoint URLs must use HTTPS, not HTTP"
          : "Endpoint URL must be a valid HTTPS URL",
        cause,
      ),
    );
    return;
  }

  try {
    const parsedUrl = new URL(value.trim());
    if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.trim().length === 0) {
      errors.push(
        createProviderConfigError(
          field,
          value,
          HTTPS_ENDPOINT_EXPECTED_FORMAT,
          parsedUrl.protocol === "http:"
            ? "Endpoint URLs must use HTTPS, not HTTP"
            : "Endpoint URL must include a hostname",
        ),
      );
    }
  } catch (cause) {
    errors.push(
      createProviderConfigError(
        field,
        value,
        HTTPS_ENDPOINT_EXPECTED_FORMAT,
        "Endpoint URL is malformed",
        cause,
      ),
    );
  }
};

const validateConfigStringFields = (
  value: unknown,
  path: string,
  errors: Array<ProviderConfigError>,
  seen: WeakSet<object>,
): void => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      validateConfigStringFields(item, `${path}[${index}]`, errors, seen);
    });
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  for (const [key, nestedValue] of Object.entries(value)) {
    const field = `${path}.${key}`;
    if (typeof nestedValue === "string") {
      if (isApiKeyFieldName(key)) {
        validateApiKeyField(field, nestedValue, errors);
      }
      if (isEndpointFieldName(key)) {
        validateEndpointField(field, nestedValue, errors);
      }
      continue;
    }

    validateConfigStringFields(nestedValue, field, errors, seen);
  }
};

/**
 * Runtime validation for provider instance configuration values that the
 * envelope schema intentionally preserves opaquely.
 */
export const validateProviderConfig = (input: unknown) => {
  let providerConfig: ProviderInstanceConfig;
  try {
    providerConfig = decodeProviderInstanceConfig(input);
  } catch (cause) {
    return Result.fail([
      createProviderConfigError(
        "providerConfig",
        describeInvalidSchemaValue(input),
        "a valid provider instance config envelope",
        "Provider config does not match the ProviderInstanceConfig schema",
        cause,
      ),
    ]);
  }

  const errors: Array<ProviderConfigError> = [];

  providerConfig.environment?.forEach((environmentVariable) => {
    const field = `environment.${environmentVariable.name}`;
    if (isApiKeyFieldName(environmentVariable.name)) {
      validateApiKeyField(field, environmentVariable.value, errors);
    }
    if (isEndpointFieldName(environmentVariable.name)) {
      validateEndpointField(field, environmentVariable.value, errors);
    }
  });

  validateConfigStringFields(providerConfig.config, "config", errors, new WeakSet());

  return errors.length > 0 ? Result.fail(errors) : Result.succeed(providerConfig);
};

/**
 * Construct the canonical `ProviderInstanceId` used as a back-compat default
 * for a built-in driver. The legacy single-instance-per-driver world used
 * the driver kind itself as the instance id; preserving that mapping keeps
 * existing persisted threads, bindings, and cache files routable across the
 * migration without rewriting their stored selection payloads.
 */
export const defaultInstanceIdForDriver = (driver: ProviderDriverKind): ProviderInstanceId =>
  ProviderInstanceId.make(driver);
