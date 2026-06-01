/**
 * Environment variable validation at server startup.
 * Validates required and optional environment variables with type checking.
 */

import { z } from "zod";

/**
 * Define environment schema with validation rules.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().optional(),
  REDIS_URL: z.string().url().optional(),
  API_KEY: z.string().min(16).optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CORS_ORIGIN: z.string().optional(),
  MAX_CONNECTIONS: z.coerce.number().int().min(1).max(1000).default(100),
  SESSION_SECRET: z.string().min(32).optional(),
  ENABLE_METRICS: z.coerce.boolean().default(false),
});

type EnvConfig = z.infer<typeof envSchema>;

/**
 * Validate environment variables at startup.
 * Throws descriptive error if validation fails.
 */
export function validateEnv(): EnvConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors.map((err) => {
      return `  ${err.path.join(".")}: ${err.message}`;
    });

    console.error("Environment validation failed:");
    console.error(errors.join("\n"));
    console.error("\nCheck your .env file or environment variables.");

    // Don't crash in development, just warn
    if (process.env.NODE_ENV === "development") {
      console.warn("Running with invalid environment (development mode)");
      return envSchema.parse({}); // Return defaults
    }

    process.exit(1);
  }

  console.log("Environment validated successfully");
  return result.data;
}

/**
 * Get validated environment config.
 * Call once at startup, use the returned config throughout the app.
 */
let _env: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (!_env) {
    _env = validateEnv();
  }
  return _env;
}

/**
 * Check if a specific feature is enabled based on env vars.
 */
export function isFeatureEnabled(feature: string): boolean {
  const env = getEnv();
  const key = `ENABLE_${feature.toUpperCase()}`;
  return Boolean(process.env[key]);
}
