/**
 * Runtime validation for provider configuration (issue #825).
 */

export class ProviderConfigError extends Error {
  readonly _tag = "ProviderConfigError" as const;
  field: string;
  invalidValue: unknown;
  expected: string;

  constructor(field: string, invalidValue: unknown, expected: string) {
    super(`Invalid ${field}: expected ${expected}`);
    this.name = "ProviderConfigError";
    this.field = field;
    this.invalidValue = invalidValue;
    this.expected = expected;
  }
}

export type Either<E, A> = { _tag: "Left"; left: E } | { _tag: "Right"; right: A };

export function left<E>(e: E): Either<E, never> {
  return { _tag: "Left", left: e };
}
export function right<A>(a: A): Either<never, A> {
  return { _tag: "Right", right: a };
}

export interface ProviderConfig {
  apiKey?: string;
  endpoint?: string;
  [key: string]: unknown;
}

const API_KEY_MIN = 10;

export function validateApiKey(apiKey: unknown): ProviderConfigError | null {
  if (typeof apiKey !== "string" || apiKey.trim() === "") {
    return new ProviderConfigError("apiKey", apiKey, "non-empty string length >= 10");
  }
  if (apiKey.length < API_KEY_MIN) {
    return new ProviderConfigError("apiKey", apiKey, "string length >= 10");
  }
  // basic format: printable non-space heavy
  if (!/^[A-Za-z0-9_\-./+=]+$/.test(apiKey)) {
    return new ProviderConfigError("apiKey", apiKey, "alphanumeric API key format");
  }
  return null;
}

export function validateEndpoint(endpoint: unknown): ProviderConfigError | null {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return new ProviderConfigError("endpoint", endpoint, "HTTPS URL with hostname");
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return new ProviderConfigError("endpoint", endpoint, "valid URL");
  }
  if (url.protocol === "http:") {
    return new ProviderConfigError(
      "endpoint",
      endpoint,
      "HTTPS URL (HTTP is not allowed; use https://)",
    );
  }
  if (url.protocol !== "https:") {
    return new ProviderConfigError("endpoint", endpoint, "HTTPS URL with hostname");
  }
  if (!url.hostname || url.hostname.length < 1) {
    return new ProviderConfigError("endpoint", endpoint, "HTTPS URL with hostname");
  }
  return null;
}

/**
 * Validate provider config; return all errors at once (not fail-fast).
 */
export function validateProviderConfig(
  config: ProviderConfig,
): Either<ProviderConfigError[], ProviderConfig> {
  const errors: ProviderConfigError[] = [];

  if ("apiKey" in config || config.apiKey !== undefined) {
    const e = validateApiKey(config.apiKey);
    if (e) errors.push(e);
  }
  if ("endpoint" in config || config.endpoint !== undefined) {
    const e = validateEndpoint(config.endpoint);
    if (e) errors.push(e);
  }

  // require at least apiKey when validating full config with both expected
  if (config.apiKey === undefined && config.endpoint === undefined) {
    errors.push(new ProviderConfigError("apiKey", undefined, "non-empty string length >= 10"));
  }

  if (errors.length > 0) return left(errors);
  return right(config);
}
