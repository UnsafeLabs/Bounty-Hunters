import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { ProviderInstanceConfig } from "./providerInstance.ts";

const API_KEY_EXPECTED_FORMAT = "non-empty API key string with at least 10 characters";
const HTTPS_URL_EXPECTED_FORMAT = "valid HTTPS URL with a hostname";

const decodeProviderInstanceConfig = Schema.decodeUnknownResult(ProviderInstanceConfig);

export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    fieldName: Schema.String,
    invalidValue: Schema.Unknown,
    expectedFormat: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid provider config field ${this.fieldName}: expected ${this.expectedFormat}`;
  }
}

export function validateProviderConfig(
  input: unknown,
): Result.Result<ProviderInstanceConfig, ReadonlyArray<ProviderConfigError>> {
  const decoded = decodeProviderInstanceConfig(input);
  if (Result.isFailure(decoded)) {
    return Result.fail([
      new ProviderConfigError({
        fieldName: "ProviderInstanceConfig",
        invalidValue: input,
        expectedFormat: "ProviderInstanceConfig envelope",
        detail: String(decoded.failure),
      }),
    ]);
  }

  const errors: Array<ProviderConfigError> = [];
  collectEnvironmentErrors(decoded.success.environment, errors);
  collectConfigPayloadErrors(decoded.success.config, "config", errors, new WeakSet<object>());

  return errors.length === 0 ? Result.succeed(decoded.success) : Result.fail(errors);
}

function collectEnvironmentErrors(
  environment: ProviderInstanceConfig["environment"],
  errors: Array<ProviderConfigError>,
): void {
  for (const variable of environment ?? []) {
    if (variable.valueRedacted === true && variable.value === "") {
      continue;
    }

    collectCandidateFieldErrors(
      variable.name,
      `environment.${variable.name}`,
      variable.value,
      errors,
    );
  }
}

function collectConfigPayloadErrors(
  value: unknown,
  path: string,
  errors: Array<ProviderConfigError>,
  seen: WeakSet<object>,
): void {
  if (Array.isArray(value)) {
    if (seen.has(value)) return;
    seen.add(value);

    value.forEach((item, index) => {
      collectConfigPayloadErrors(item, `${path}[${index}]`, errors, seen);
    });
    return;
  }

  if (!isRecord(value)) return;
  if (seen.has(value)) return;
  seen.add(value);

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const fieldPath = `${path}.${fieldName}`;
    collectCandidateFieldErrors(fieldName, fieldPath, fieldValue, errors);
    collectConfigPayloadErrors(fieldValue, fieldPath, errors, seen);
  }
}

function collectCandidateFieldErrors(
  fieldName: string,
  fieldPath: string,
  value: unknown,
  errors: Array<ProviderConfigError>,
): void {
  if (isApiKeyField(fieldName)) {
    validateApiKey(fieldPath, value, errors);
    return;
  }

  if (isEndpointUrlField(fieldName)) {
    validateHttpsUrl(fieldPath, value, errors);
  }
}

function validateApiKey(
  fieldName: string,
  value: unknown,
  errors: Array<ProviderConfigError>,
): void {
  if (typeof value !== "string") {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: API_KEY_EXPECTED_FORMAT,
        detail: "API key fields must be strings.",
      }),
    );
    return;
  }

  if (value.trim().length < 10) {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: API_KEY_EXPECTED_FORMAT,
        detail: "API key fields cannot be empty or shorter than 10 characters.",
      }),
    );
  }
}

function validateHttpsUrl(
  fieldName: string,
  value: unknown,
  errors: Array<ProviderConfigError>,
): void {
  if (typeof value !== "string") {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: HTTPS_URL_EXPECTED_FORMAT,
        detail: "Endpoint URL fields must be strings.",
      }),
    );
    return;
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(value);
  } catch {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: HTTPS_URL_EXPECTED_FORMAT,
        detail: "Endpoint URL fields must contain a parseable absolute URL.",
      }),
    );
    return;
  }

  if (parsedUrl.protocol === "http:") {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: `${HTTPS_URL_EXPECTED_FORMAT}; use https:// instead of http://`,
        detail: "HTTP endpoint URLs are not allowed. Use HTTPS.",
      }),
    );
    return;
  }

  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname.trim() === "") {
    errors.push(
      new ProviderConfigError({
        fieldName,
        invalidValue: value,
        expectedFormat: HTTPS_URL_EXPECTED_FORMAT,
        detail: "Endpoint URL fields must use https:// and include a hostname.",
      }),
    );
  }
}

function isApiKeyField(fieldName: string): boolean {
  const normalized = normalizeFieldName(fieldName);
  return (
    normalized.endsWith("apikey") ||
    normalized.endsWith("accesstoken") ||
    normalized.endsWith("authtoken") ||
    normalized.endsWith("bearertoken") ||
    normalized.endsWith("refreshtoken") ||
    normalized.endsWith("secret")
  );
}

function isEndpointUrlField(fieldName: string): boolean {
  const normalized = normalizeFieldName(fieldName);
  return (
    normalized.endsWith("endpoint") || normalized.endsWith("baseurl") || normalized.endsWith("url")
  );
}

function normalizeFieldName(fieldName: string): string {
  return fieldName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
