import { describe, it, expect } from "vitest";
import {
  validateEnvironment,
  formatValidationTable,
  getEnvVarSpecs,
} from "./envValidation.ts";

describe("envValidation", () => {
  describe("validateEnvironment", () => {
    it("should pass with all optional vars absent", () => {
      const result = validateEnvironment({});
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("should fail when T3_BASE_DIR is missing (required)", () => {
      const result = validateEnvironment({});
      const baseDirError = result.errors.find((e) => e.name === "T3_BASE_DIR");
      expect(baseDirError).toBeDefined();
      expect(baseDirError!.issue).toBe("missing");
    });

    it("should pass when T3_BASE_DIR is provided", () => {
      const result = validateEnvironment({ T3_BASE_DIR: "/tmp/t3" });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid port number", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_SERVER_PORT: "not-a-number",
      });
      const portError = result.errors.find((e) => e.name === "T3_SERVER_PORT");
      expect(portError).toBeDefined();
      expect(portError!.issue).toBe("invalid_type");
    });

    it("should accept valid port number", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_SERVER_PORT: "8080",
      });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid log level", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_LOG_LEVEL: "verbose",
      });
      const logError = result.errors.find((e) => e.name === "T3_LOG_LEVEL");
      expect(logError).toBeDefined();
      expect(logError!.issue).toBe("invalid_value");
    });

    it("should accept valid log levels", () => {
      for (const level of ["trace", "debug", "info", "warning", "error"]) {
        const result = validateEnvironment({
          T3_BASE_DIR: "/tmp/t3",
          T3_LOG_LEVEL: level,
        });
        expect(result.valid).toBe(true);
      }
    });

    it("should reject invalid URL", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_OTLP_TRACES_URL: "not-a-url",
      });
      const urlError = result.errors.find((e) => e.name === "T3_OTLP_TRACES_URL");
      expect(urlError).toBeDefined();
      expect(urlError!.issue).toBe("invalid_type");
    });

    it("should accept valid URL", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_OTLP_TRACES_URL: "https://otlp.example.com/v1/traces",
      });
      expect(result.valid).toBe(true);
    });

    it("should reject invalid mode", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_MODE: "server",
      });
      const modeError = result.errors.find((e) => e.name === "T3_MODE");
      expect(modeError).toBeDefined();
      expect(modeError!.issue).toBe("invalid_value");
    });

    it("should reject invalid boolean", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        T3_NO_BROWSER: "maybe",
      });
      const boolError = result.errors.find((e) => e.name === "T3_NO_BROWSER");
      expect(boolError).toBeDefined();
      expect(boolError!.issue).toBe("invalid_type");
    });

    it("should accept valid boolean values", () => {
      for (const val of ["true", "false", "0", "1", "yes", "no"]) {
        const result = validateEnvironment({
          T3_BASE_DIR: "/tmp/t3",
          T3_NO_BROWSER: val,
        });
        expect(result.valid).toBe(true);
      }
    });

    it("should reject gzip level out of range", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        COMPRESSION_GZIP_LEVEL: "15",
      });
      const gzipError = result.errors.find((e) => e.name === "COMPRESSION_GZIP_LEVEL");
      expect(gzipError).toBeDefined();
      expect(gzipError!.issue).toBe("invalid_value");
    });

    it("should reject brotli quality out of range", () => {
      const result = validateEnvironment({
        T3_BASE_DIR: "/tmp/t3",
        COMPRESSION_BROTLI_QUALITY: "20",
      });
      const brotliError = result.errors.find((e) => e.name === "COMPRESSION_BROTLI_QUALITY");
      expect(brotliError).toBeDefined();
      expect(brotliError!.issue).toBe("invalid_value");
    });

    it("should report multiple errors at once", () => {
      const result = validateEnvironment({
        T3_SERVER_PORT: "abc",
        T3_LOG_LEVEL: "verbose",
        T3_MODE: "server",
      });
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("formatValidationTable", () => {
    it("should show success message when valid", () => {
      const result = validateEnvironment({ T3_BASE_DIR: "/tmp/t3" });
      const table = formatValidationTable(result);
      expect(table).toContain("validated successfully");
    });

    it("should show error table when invalid", () => {
      const result = validateEnvironment({});
      const table = formatValidationTable(result);
      expect(table).toContain("validation failed");
      expect(table).toContain("T3_BASE_DIR");
    });
  });

  describe("getEnvVarSpecs", () => {
    it("should return all env var specifications", () => {
      const specs = getEnvVarSpecs();
      expect(specs.length).toBeGreaterThan(0);
      expect(specs.some((s) => s.name === "T3_BASE_DIR")).toBe(true);
      expect(specs.some((s) => s.name === "T3_SERVER_PORT")).toBe(true);
    });

    it("should mark T3_BASE_DIR as required", () => {
      const specs = getEnvVarSpecs();
      const baseDir = specs.find((s) => s.name === "T3_BASE_DIR");
      expect(baseDir?.required).toBe(true);
    });

    it("should include descriptions for all specs", () => {
      const specs = getEnvVarSpecs();
      for (const spec of specs) {
        expect(spec.description.length).toBeGreaterThan(0);
      }
    });
  });
});
