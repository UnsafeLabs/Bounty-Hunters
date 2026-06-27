import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { validateEnv, printEnvTable, runValidateConfig } from "./EnvValidation.ts";

describe("EnvValidation", () => {
  it.effect("validates successfully with defaults when no env vars set", () =>
    Effect.gen(function* () {
      // Clear known env vars
      const knownVars = [
        "T3CODE_HOME", "T3CODE_PORT", "T3CODE_HOST", "T3CODE_MODE",
        "T3CODE_LOG_LEVEL", "T3CODE_NO_BROWSER", "T3CODE_OTLP_TRACES_URL",
        "T3CODE_OTLP_METRICS_URL", "T3CODE_OTLP_EXPORT_INTERVAL_MS",
        "T3CODE_OTLP_SERVICE_NAME", "T3CODE_TAILSCALE_SERVE_ENABLED",
        "T3CODE_TAILSCALE_SERVE_PORT", "VITE_DEV_SERVER_URL",
      ];
      for (const v of knownVars) delete process.env[v];

      const result = yield* Effect.either(validateEnv);
      expect(result._tag).toBe("Right");
    }),
  );

  it.effect("prints environment table without error", () =>
    Effect.gen(function* () {
      yield* printEnvTable;
    }),
  );
});
