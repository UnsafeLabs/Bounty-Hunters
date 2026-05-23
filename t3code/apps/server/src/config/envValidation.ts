export interface EnvVarSpec {
  readonly name: string;
  readonly required?: boolean;
  readonly type?: "string" | "number" | "boolean";
  readonly default?: string;
  readonly secret?: boolean;
  readonly pattern?: RegExp;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: string[];
  readonly values: Record<string, string>;
}

export function validateEnvVars(specs: EnvVarSpec[]): ValidationResult {
  const errors: string[] = [];
  const values: Record<string, string> = {};

  for (const spec of specs) {
    const raw = process.env[spec.name];

    if (raw === undefined || raw === "") {
      if (spec.required && spec.default === undefined) {
        errors.push(`Missing required env var: ${spec.name}`);
        continue;
      }
      if (spec.default !== undefined) {
        values[spec.name] = spec.default;
      }
      continue;
    }

    let value = raw;

    // Type validation
    if (spec.type === "number") {
      if (isNaN(Number(value))) {
        errors.push(`${spec.name} must be a valid number, got: ${value}`);
        continue;
      }
    } else if (spec.type === "boolean") {
      if (!["true", "false", "1", "0", "yes", "no"].includes(value.toLowerCase())) {
        errors.push(`${spec.name} must be a boolean, got: ${value}`);
        continue;
      }
    }

    // Pattern validation
    if (spec.pattern && !spec.pattern.test(value)) {
      errors.push(`${spec.name} does not match required pattern: ${spec.pattern}`);
      continue;
    }

    values[spec.name] = value;
  }

  return { valid: errors.length === 0, errors, values };
}

export function logEnvConfig(values: Record<string, string>, specs: EnvVarSpec[]) {
  const secretNames = new Set(specs.filter((s) => s.secret).map((s) => s.name));
  console.log("Environment configuration:");
  for (const [name, value] of Object.entries(values)) {
    const display = secretNames.has(name) ? "***REDACTED***" : value;
    console.log(`  ${name}=${display}`);
  }
}
