import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as Option from "effect/Option";
import * as Effect from "effect/Effect";
import { validateEnvironment, runConfigValidationOrExit } from "./envValidation.ts";

describe("envValidation", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear relevant environment variables to have a clean state
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("T3CODE_") || key === "VITE_DEV_SERVER_URL") {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("succeeds when required variables are present and valid", () => {
    process.env.T3CODE_MODE = "web";
    process.env.T3CODE_HOME = "/tmp/t3-home";

    const results = validateEnvironment(process.env);
    const modeResult = results.find((r) => r.def.name === "T3CODE_MODE");
    const homeResult = results.find((r) => r.def.name === "T3CODE_HOME");

    expect(modeResult?.status).toBe("valid");
    expect(homeResult?.status).toBe("valid");
    expect(results.some((r) => r.status === "missing" || r.status === "invalid")).toBe(false);
  });

  it("fails when a required variable is missing", () => {
    process.env.T3CODE_MODE = "web";
    // T3CODE_HOME is missing

    const results = validateEnvironment(process.env);
    const homeResult = results.find((r) => r.def.name === "T3CODE_HOME");

    expect(homeResult?.status).toBe("missing");
    expect(results.some((r) => r.status === "missing" || r.status === "invalid")).toBe(true);
  });

  it("fails when a variable has an invalid type", () => {
    process.env.T3CODE_MODE = "invalid-mode";
    process.env.T3CODE_HOME = "/tmp/t3-home";
    process.env.T3CODE_PORT = "not-a-number";

    const results = validateEnvironment(process.env);
    const modeResult = results.find((r) => r.def.name === "T3CODE_MODE");
    const portResult = results.find((r) => r.def.name === "T3CODE_PORT");

    expect(modeResult?.status).toBe("invalid");
    expect(portResult?.status).toBe("invalid");
    expect(results.some((r) => r.status === "missing" || r.status === "invalid")).toBe(true);
  });

  it("fails when port is out of range", () => {
    process.env.T3CODE_MODE = "web";
    process.env.T3CODE_HOME = "/tmp/t3-home";
    process.env.T3CODE_PORT = "70000";

    const results = validateEnvironment(process.env);
    const portResult = results.find((r) => r.def.name === "T3CODE_PORT");

    expect(portResult?.status).toBe("invalid");
  });

  it("throws validation error inside runConfigValidationOrExit when invalid", async () => {
    process.env.T3CODE_MODE = "web";
    // T3CODE_HOME is missing

    const effect = runConfigValidationOrExit({
      validateConfig: Option.some(false),
    });

    await expect(Effect.runPromise(effect)).rejects.toThrow("Environment validation failed");
  });

  it("does not throw validation error inside runConfigValidationOrExit when valid", async () => {
    process.env.T3CODE_MODE = "web";
    process.env.T3CODE_HOME = "/tmp/t3-home";

    const effect = runConfigValidationOrExit({
      validateConfig: Option.some(false),
    });

    await expect(Effect.runPromise(effect)).resolves.toBeUndefined();
  });
});
