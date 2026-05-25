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
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
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

/**
 * Construct the canonical `ProviderInstanceId` used as a back-compat default
 * for a built-in driver. The legacy single-instance-per-driver world used
 * the driver kind itself as the instance id; preserving that mapping keeps
 * existing persisted threads, bindings, and cache files routable across the
 * migration without rewriting their stored selection payloads.
 */
export const defaultInstanceIdForDriver = (driver: ProviderDriverKind): ProviderInstanceId =>
  ProviderInstanceId.make(driver);

// ---------------------------------------------------------------------------
// Runtime validation for provider configuration schemas
// ---------------------------------------------------------------------------

/**
 * Tagged error carrying structured information about a single field-level
 * validation failure inside a provider instance configuration.
 */
export class ProviderConfigError extends Data.TaggedError("ProviderConfigError")<{
  readonly field: string;
  readonly invalidValue: string;
  readonly expectedFormat: string;
}> {}

/**
 * Schema refinement for API key fields.
 *
 * Rules:
 *  - must be a non-empty string (after trimming)
 *  - must be at least 10 characters long
 */
const ApiKeySchema = TrimmedNonEmptyString.check(
  Schema.isMinLength(10),
);

const HTTPS_HOSTNAME_PATTERN = /^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]+/;

/**
 * Schema refinement for endpoint URL fields.
 *
 * Rules:
 *  - must start with `https://`
 *  - must contain a valid hostname
 *  - `http://` is explicitly rejected with a message steering the user to HTTPS
 */
const HttpsUrlSchema = TrimmedNonEmptyString.check(
  Schema.isPattern(HTTPS_HOSTNAME_PATTERN),
);

/**
 * Input shape accepted by `validateProviderConfig`. Mirrors the fields of
 * `ProviderInstanceConfig` plus the driver-specific config keys we validate
 * (apiKey, endpointUrl).
 */
export const ProviderConfigValidationInput = Schema.Struct({
  driver: ProviderDriverKind,
  displayName: Schema.optional(TrimmedNonEmptyString),
  accentColor: Schema.optional(TrimmedNonEmptyString),
  environment: Schema.optionalKey(ProviderInstanceEnvironment),
  enabled: Schema.optionalKey(Schema.Boolean),
  config: Schema.optionalKey(Schema.Struct({
    apiKey: Schema.optional(Schema.String),
    endpointUrl: Schema.optional(Schema.String),
    homePath: Schema.optional(Schema.String),
    binaryPath: Schema.optional(Schema.String),
    model: Schema.optional(Schema.String),
  })),
});
export type ProviderConfigValidationInput = typeof ProviderConfigValidationInput.Type;

/**
 * Validates a provider-instance configuration envelope at runtime.
 *
 * Checks performed:
 *  - `config.apiKey`: if present, must be a non-empty string >= 10 characters
 *  - `config.endpointUrl`: if present, must be a valid HTTPS URL
 *
 * Returns **all** validation errors at once (never short-circuits on the
 * first failure). When the input is valid the right side carries the
 * original input cast to `ProviderConfigValidationInput`.
 */
export const validateProviderConfig = (
  input: unknown,
): Either.Either<ReadonlyArray<ProviderConfigError>, ProviderConfigValidationInput> => {
  const errors: ProviderConfigError[] = [];

  // First, decode the outer envelope so we can inspect inner fields.
  let decoded: ProviderConfigValidationInput;
  try {
    decoded = Schema.decodeUnknownSync(ProviderConfigValidationInput)(input as any);
  } catch {
    // The envelope itself is structurally invalid — return a single
    // top-level error so the caller still gets a useful message.
    return Either.left([
      new ProviderConfigError({
        field: "(root)",
        invalidValue: String(input),
        expectedFormat: "A valid provider instance configuration object",
      }),
    ]);
  }

  const config = decoded.config;

  if (config !== undefined) {
    // --- API key validation ---
    if (config.apiKey !== undefined) {
      try {
        Schema.decodeUnknownSync(ApiKeySchema)(config.apiKey);
      } catch {
        errors.push(
          new ProviderConfigError({
            field: "config.apiKey",
            invalidValue: String(config.apiKey),
            expectedFormat:
              "Non-empty string, at least 10 characters (after trimming whitespace)",
          }),
        );
      }
    }

    // --- Endpoint URL validation ---
    if (config.endpointUrl !== undefined) {
      try {
        Schema.decodeUnknownSync(HttpsUrlSchema)(config.endpointUrl);
      } catch {
        const raw = config.endpointUrl as string;
        let expectedFormat: string;

        if (/^http:\/\//.test(raw)) {
          expectedFormat =
            "HTTPS URL required — http:// is not allowed. Use https:// for secure connections.";
        } else if (!/^https:\/\//.test(raw)) {
          expectedFormat =
            "URL must start with https:// and include a valid hostname (e.g. https://api.example.com)";
        } else {
          expectedFormat =
            "HTTPS URL with a valid hostname (e.g. https://api.example.com)";
        }

        errors.push(
          new ProviderConfigError({
            field: "config.endpointUrl",
            invalidValue: raw,
            expectedFormat,
          }),
        );
      }
    }
  }

  if (errors.length > 0) {
    return Either.left(errors);
  }

  return Either.right(decoded);
};
