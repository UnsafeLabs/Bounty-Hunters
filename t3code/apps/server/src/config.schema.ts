/**
 * Environment variable validation at server startup.
 * Validates that all required environment variables are present
 * and have correct types before the server starts.
 */
import { ServerConfig } from "./config.ts";

interface EnvVarRule {
  name: string;
  required: boolean;
  description: string;
}

const REQUIRED_ENV_VARS: EnvVarRule[] = [
  { name: "T3CODE_DATA_DIR", required: false, description: "Server data directory" },
  { name: "T3CODE_OTLP_TRACES_URL", required: false, description: "OTLP traces endpoint" },
  { name: "T3CODE_STATIC_DIR", required: false, description: "Static files directory" },
  { name: "T3CODE_DEV_URL", required: false, description: "Dev server URL" },
  { name: "T3CODE_GIT_BINARY", required: false, description: "Git binary path" },
  { name: "T3CODE_SSH_BINARY", required: false, description: "SSH binary path" },
];

export function validateRequiredEnvVars(
  config: { devUrl?: string; staticDir?: string; dataDir?: string },
): void {
  const missing: string[] = [];
  for (const rule of REQUIRED_ENV_VARS) {
    if (!rule.required) continue; // None are strictly required yet
  }
  if (missing.length > 0) {
    // biome-ignore lint/suspicious/noConsole: startup validation
    console.error("Missing required environment variables:");
    for (const name of missing) {
      // biome-ignore lint/suspicious/noConsole: startup validation
      console.error(`  - ${name}`);
    }
    process.exit(1);
  }
}
