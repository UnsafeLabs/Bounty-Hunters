import { Effect, Schema } from "effect";

export const ProviderConfig = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  apiEndpoint: Schema.String.pipe(Schema.pattern(/^https?:\/\/.+/)),
  apiKey: Schema.String.pipe(Schema.minLength(1)),
  model: Schema.String,
  maxTokens: Schema.Number.pipe(Schema.positive()),
  temperature: Schema.Number.pipe(Schema.between(0, 2)),
  enabled: Schema.Boolean,
  priority: Schema.Number.pipe(Schema.nonNegative()),
});

export type ProviderConfigType = Schema.Schema.Type<typeof ProviderConfig>;

export const ValidationResult = Schema.Struct({
  valid: Schema.Boolean,
  errors: Schema.Array(Schema.String),
  warnings: Schema.Array(Schema.String),
});

export type ValidationResultType = Schema.Schema.Type<typeof ValidationResult>;

export const validateProviderConfig = (config: unknown): Effect.Effect<ValidationResultType, never> =>
  Effect.gen(function* (_) {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Schema validation
    const result = Schema.decodeUnknownEither(ProviderConfig)(config);

    if (result._tag === "Left") {
      errors.push(`Schema validation failed: ${result.left.message}`);
      return { valid: false, errors, warnings };
    }

    const validated = result.right;

    // Runtime checks
    if (validated.maxTokens > 100000) {
      warnings.push("maxTokens exceeds 100000 — most providers limit this");
    }

    if (validated.temperature > 1.5) {
      warnings.push("temperature > 1.5 may produce inconsistent results");
    }

    if (validated.apiKey.length < 20) {
      warnings.push("apiKey seems unusually short — verify it is correct");
    }

    if (validated.priority > 100) {
      warnings.push("priority > 100 is very high — ensure this is intentional");
    }

    // Check for duplicate names
    // (Would need access to other configs — this is a self-validation)

    return { valid: true, errors, warnings };
  });

export const validateConfigFile = (configs: unknown[]): Effect.Effect<ValidationResultType[], never> =>
  Effect.gen(function* (_) {
    const results: ValidationResultType[] = [];
    const names = new Set<string>();
    const ids = new Set<string>();

    for (const config of configs) {
      const result = yield* _(validateProviderConfig(config));

      // Check for duplicate names/ids across the config set
      if (typeof config === "object" && config !== null) {
        const c = config as Record<string, unknown>;
        if (typeof c.name === "string" && names.has(c.name)) {
          result.errors.push(`Duplicate provider name: ${c.name}`);
          result.valid = false;
        }
        if (typeof c.id === "string" && ids.has(c.id)) {
          result.errors.push(`Duplicate provider id: ${c.id}`);
          result.valid = false;
        }
        if (typeof c.name === "string") names.add(c.name);
        if (typeof c.id === "string") ids.add(c.id);
      }

      results.push(result);
    }

    return results;
  });

export const createDefaultConfig = (id: string, name: string, apiKey: string, apiEndpoint: string): ProviderConfigType => ({
  id,
  name,
  apiEndpoint,
  apiKey,
  model: "default",
  maxTokens: 4096,
  temperature: 0.7,
  enabled: true,
  priority: 0,
});
