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
const PROVIDER_API_KEY_MIN_CHARS = 10;
const PROVIDER_API_KEY_PATTERN = /^\S+$/;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?!-)(?:[a-zA-Z0-9-]{1,63}\.)+[a-zA-Z]{2,63}$/;

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

export const ProviderApiKey = TrimmedNonEmptyString.check(
  Schema.isMinLength(PROVIDER_API_KEY_MIN_CHARS, {
    message: `API keys must be at least ${PROVIDER_API_KEY_MIN_CHARS} characters long.`,
  }),
  Schema.isPattern(PROVIDER_API_KEY_PATTERN, {
    message: "API keys must not contain whitespace.",
  }),
);
export type ProviderApiKey = typeof ProviderApiKey.Type;

export const ProviderHttpsEndpointUrl = Schema.URLFromString;
export type ProviderHttpsEndpointUrl = typeof ProviderHttpsEndpointUrl.Type;

export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    fieldName: TrimmedNonEmptyString,
    invalidValue: Schema.String,
    expectedFormat: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return `${this.fieldName} must be ${this.expectedFormat}; received ${this.invalidValue}`;
  }
}

const decodeProviderApiKey = Schema.decodeUnknownSync(ProviderApiKey);
const decodeProviderHttpsEndpointUrl = Schema.decodeUnknownSync(ProviderHttpsEndpointUrl);

const formatInvalidValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const makeProviderConfigError = (
  fieldName: string,
  invalidValue: unknown,
  expectedFormat: string,
) =>
  new ProviderConfigError({
    fieldName,
    invalidValue: formatInvalidValue(invalidValue),
    expectedFormat,
  });

const normalizeProviderConfigFieldName = (fieldName: string): string =>
  fieldName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();

const isProviderApiKeyField = (fieldName: string): boolean => {
  const normalized = normalizeProviderConfigFieldName(fieldName);
  return (
    normalized === "API_KEY" ||
    normalized.endsWith("_API_KEY") ||
    normalized.endsWith("_ACCESS_TOKEN") ||
    normalized.endsWith("_AUTH_TOKEN") ||
    normalized.endsWith("_SECRET_KEY")
  );
};

const isProviderEndpointField = (fieldName: string): boolean => {
  const normalized = normalizeProviderConfigFieldName(fieldName);
  return (
    normalized === "URL" ||
    normalized === "ENDPOINT" ||
    normalized.endsWith("_URL") ||
    normalized.endsWith("_ENDPOINT") ||
    normalized.endsWith("_BASE_URL") ||
    normalized.endsWith("_ENDPOINT_URL") ||
    normalized.endsWith("_API_URL")
  );
};

const hasProviderEndpointHostname = (hostname: string): boolean => HOSTNAME_PATTERN.test(hostname);

const validateProviderApiKeyField = (fieldName: string, value: unknown): ProviderConfigError[] => {
  try {
    decodeProviderApiKey(value);
    return [];
  } catch {
    return [
      makeProviderConfigError(
        fieldName,
        value,
        `an API key string with at least ${PROVIDER_API_KEY_MIN_CHARS} non-whitespace characters`,
      ),
    ];
  }
};

const validateProviderEndpointField = (
  fieldName: string,
  value: unknown,
): ProviderConfigError[] => {
  if (typeof value !== "string") {
    return [makeProviderConfigError(fieldName, value, "a valid HTTPS URL string with a hostname")];
  }

  let url: URL;
  try {
    url = decodeProviderHttpsEndpointUrl(value);
  } catch {
    return [makeProviderConfigError(fieldName, value, "a valid HTTPS URL with a hostname")];
  }

  if (url.protocol !== "https:") {
    return [
      makeProviderConfigError(
        fieldName,
        value,
        "an HTTPS URL. Use https:// rather than http:// for provider endpoints",
      ),
    ];
  }

  if (!hasProviderEndpointHostname(url.hostname)) {
    return [
      makeProviderConfigError(
        fieldName,
        value,
        "an HTTPS URL with a fully qualified provider hostname",
      ),
    ];
  }

  return [];
};

const isRecordValue = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectProviderConfigValueErrors = (path: string, value: unknown): ProviderConfigError[] => {
  const fieldName = path.split(".").at(-1) ?? path;
  const errors: ProviderConfigError[] = [];

  if (isProviderApiKeyField(fieldName)) {
    errors.push(...validateProviderApiKeyField(path, value));
  }
  if (isProviderEndpointField(fieldName)) {
    errors.push(...validateProviderEndpointField(path, value));
  }

  if (isRecordValue(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      errors.push(...collectProviderConfigValueErrors(`${path}.${key}`, childValue));
    }
  }

  return errors;
};

export const collectProviderConfigErrors = (
  config: ProviderInstanceConfig,
): ReadonlyArray<ProviderConfigError> => {
  const errors: ProviderConfigError[] = [];

  for (const environmentVariable of config.environment ?? []) {
    const fieldName = `environment.${environmentVariable.name}`;
    if (isProviderApiKeyField(environmentVariable.name)) {
      errors.push(...validateProviderApiKeyField(fieldName, environmentVariable.value));
    }
    if (isProviderEndpointField(environmentVariable.name)) {
      errors.push(...validateProviderEndpointField(fieldName, environmentVariable.value));
    }
  }

  if (isRecordValue(config.config)) {
    for (const [fieldName, value] of Object.entries(config.config)) {
      errors.push(...collectProviderConfigValueErrors(`config.${fieldName}`, value));
    }
  }

  return errors;
};

export const validateProviderConfig = (
  config: ProviderInstanceConfig,
): Result.Result<ProviderInstanceConfig, ReadonlyArray<ProviderConfigError>> => {
  const errors = collectProviderConfigErrors(config);
  return errors.length === 0 ? Result.succeed(config) : Result.fail(errors);
};

export const validateProviderConfigEffect = (
  config: ProviderInstanceConfig,
): Effect.Effect<Result.Result<ProviderInstanceConfig, ReadonlyArray<ProviderConfigError>>> =>
  Effect.succeed(validateProviderConfig(config));

/**
 * Construct the canonical `ProviderInstanceId` used as a back-compat default
 * for a built-in driver. The legacy single-instance-per-driver world used
 * the driver kind itself as the instance id; preserving that mapping keeps
 * existing persisted threads, bindings, and cache files routable across the
 * migration without rewriting their stored selection payloads.
 */
export const defaultInstanceIdForDriver = (driver: ProviderDriverKind): ProviderInstanceId =>
  ProviderInstanceId.make(driver);
