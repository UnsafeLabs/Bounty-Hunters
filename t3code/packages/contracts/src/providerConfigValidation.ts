import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import type { ProviderInstanceConfig } from "./providerInstance.ts";

const API_KEY_PATTERN = /^\S{10,}$/;
const API_KEY_FIELD_PATTERN = /(?:api[_-]?key|apikey|_key$)/i;
const ENDPOINT_FIELD_PATTERN = /(?:endpoint|url|baseUrl|base_url)$/i;

export const ProviderApiKeyValue = TrimmedNonEmptyString.check(
  Schema.isMinLength(10),
  Schema.isPattern(API_KEY_PATTERN),
);
export type ProviderApiKeyValue = typeof ProviderApiKeyValue.Type;

export const ProviderHttpsEndpointUrl = TrimmedNonEmptyString.check(
  Schema.isPattern(/^https:\/\/[^\s/$.?#].[^\s]*$/i),
);
export type ProviderHttpsEndpointUrl = typeof ProviderHttpsEndpointUrl.Type;

export class ProviderConfigError extends Schema.TaggedErrorClass<ProviderConfigError>()(
  "ProviderConfigError",
  {
    field: TrimmedNonEmptyString,
    invalidValue: Schema.String,
    expected: TrimmedNonEmptyString,
  },
) {}

type CandidateField = {
  readonly field: string;
  readonly value: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const addError = (
  errors: Array<ProviderConfigError>,
  field: string,
  invalidValue: string,
  expected: string,
) => {
  errors.push(new ProviderConfigError({ field, invalidValue, expected }));
};

const collectConfigFields = (value: unknown, prefix: string, candidates: Array<CandidateField>) => {
  if (typeof value === "string") {
    candidates.push({ field: prefix, value });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectConfigFields(item, `${prefix}[${index}]`, candidates));
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    collectConfigFields(nestedValue, `${prefix}.${key}`, candidates);
  }
};

const collectProviderFields = (config: ProviderInstanceConfig): Array<CandidateField> => {
  const candidates: Array<CandidateField> = [];

  for (const variable of config.environment ?? []) {
    if (variable.valueRedacted === true) {
      continue;
    }

    candidates.push({
      field: `environment.${variable.name}`,
      value: variable.value,
    });
  }

  if (config.config !== undefined) {
    collectConfigFields(config.config, "config", candidates);
  }

  return candidates;
};

const validateApiKey = (field: CandidateField, errors: Array<ProviderConfigError>) => {
  if (!API_KEY_FIELD_PATTERN.test(field.field)) {
    return;
  }

  const result = Schema.decodeUnknownResult(ProviderApiKeyValue)(field.value);
  if (Result.isFailure(result)) {
    addError(
      errors,
      field.field,
      field.value,
      "non-empty API key with at least 10 non-whitespace characters",
    );
  }
};

const validateEndpoint = (field: CandidateField, errors: Array<ProviderConfigError>) => {
  if (!ENDPOINT_FIELD_PATTERN.test(field.field)) {
    return;
  }

  const result = Schema.decodeUnknownResult(ProviderHttpsEndpointUrl)(field.value);
  if (Result.isFailure(result)) {
    const expected = field.value.trim().toLowerCase().startsWith("http://")
      ? "HTTPS URL; replace http:// with https://"
      : "valid HTTPS URL with a hostname";
    addError(errors, field.field, field.value, expected);
    return;
  }

  try {
    const url = new URL(field.value);
    if (url.protocol !== "https:" || url.hostname.trim() === "") {
      addError(errors, field.field, field.value, "valid HTTPS URL with a hostname");
    }
  } catch {
    addError(errors, field.field, field.value, "valid HTTPS URL with a hostname");
  }
};

export const validateProviderConfig = (
  config: ProviderInstanceConfig,
): Result.Result<ProviderInstanceConfig, ReadonlyArray<ProviderConfigError>> => {
  const errors: Array<ProviderConfigError> = [];

  for (const field of collectProviderFields(config)) {
    validateApiKey(field, errors);
    validateEndpoint(field, errors);
  }

  return errors.length === 0 ? Result.succeed(config) : Result.fail(errors);
};
