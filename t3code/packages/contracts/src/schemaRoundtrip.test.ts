/**
 * @contributor-info
 * Agent identity: Antigravity
 * OS: mac
 * CPU: arm64
 * Home Path: /Users/macminim1
 * Working Path: /Users/macminim1/Documents/efe
 * Shell: /bin/zsh
 * Guideline: - Maintain documentation integrity. Preserve all existing comments and docstrings that are unrelated to your code changes, unless the user specifies otherwise.
 */
import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Duration from "effect/Duration";
import * as SchemaIssue from "effect/SchemaIssue";
import * as Contracts from "./index.ts";

function generateMock(ast: any, depth = 0): any {
  if (!ast) return undefined;

  switch (ast._tag) {
    case "String": {
      if (ast.checks && ast.checks.length > 0) {
        for (const check of ast.checks) {
          if (check._tag === "Filter" && check.annotations?.meta?._tag === "isPattern") {
            const expected = String(check.annotations.expected);
            if (expected.includes("^image\\/")) {
              return "image/png";
            }
            if (expected.includes("^[a-z0-9_-]+$")) {
              return "test-id";
            }
            if (expected.includes("^[a-zA-Z0-9_.-]+$")) {
              return "test.id";
            }
            if (expected.includes("^[a-zA-Z_][a-zA-Z0-9_]*$")) {
              return "TEST_ENV_VAR";
            }
          }
        }
      }
      return "test-string";
    }
    case "Number":
      return 1;
    case "Boolean":
      return true;
    case "Literal":
      return ast.literal;
    case "Union":
      return generateMock(ast.types[0], depth);
    case "Objects": {
      const obj: any = {};
      for (const prop of ast.propertySignatures) {
        const val = generateMock(prop.type, depth);
        if (val !== undefined) {
          obj[prop.name] = val;
        }
      }
      return obj;
    }
    case "Arrays": {
      const arr: any[] = [];
      for (const el of ast.elements) {
        const val = generateMock(el, depth);
        if (val !== undefined) arr.push(val);
      }
      if (ast.rest && ast.rest.length > 0) {
        const val = generateMock(ast.rest[0], depth);
        if (val !== undefined) arr.push(val);
      }
      return arr;
    }
    case "TemplateLiteral": {
      let str = "";
      for (const part of ast.parts) {
        if (typeof part === "string") {
          str += part;
        } else {
          str += String(generateMock(part, depth));
        }
      }
      return str;
    }
    case "Suspend":
      if (depth > 2) return undefined;
      return generateMock(ast.thunk(), depth + 1);
    case "Declaration": {
      const tcTag = ast.annotations?.typeConstructor?._tag;
      const expected = ast.annotations?.expected;
      if (tcTag === "effect/DateTime.Utc") {
        return DateTime.makeUnsafe("2026-04-10T00:00:00.000Z");
      }
      if (tcTag === "effect/Duration") {
        return 1000;
      }
      if (tcTag === "Error" || expected === "Error") {
        return new Error("mock-error");
      }
      if (expected === "Option") {
        return Option.none();
      }
      if (ast.typeParameters && ast.typeParameters.length > 0) {
        return generateMock(ast.typeParameters[0], depth);
      }
      return undefined;
    }
    case "Unknown":
      return "unknown-mock";
    default:
      return undefined;
  }
}

describe("Schema Round-Trip Verification", () => {
  // Test every exported schema type dynamically
  for (const [key, value] of Object.entries(Contracts)) {
    if (value && typeof value === "object" && "ast" in value) {
      const schema = value as any;
      it(`should successfully round-trip ${key}`, () => {
        const mock = generateMock(schema.ast);
        const decoded = Schema.decodeSync(schema)(mock);
        const encoded = Schema.encodeSync(schema)(decoded);
        expect(encoded).toBeDefined();
      });
    }
  }

  // Edge cases for string fields
  describe("String Field Edge Cases", () => {
    it("handles empty strings on TrimmedString but rejects on TrimmedNonEmptyString", () => {
      const emptyDecoded = Schema.decodeSync(Contracts.TrimmedString)("");
      expect(emptyDecoded).toBe("");

      expect(() => Schema.decodeSync(Contracts.TrimmedNonEmptyString)("")).toThrow();
      expect(() => Schema.decodeSync(Contracts.TrimmedNonEmptyString)("   ")).toThrow();
    });

    it("handles maximum length strings correctly", () => {
      const maxLength = 500;
      const longStr = "a".repeat(maxLength);
      const decoded = Schema.decodeSync(Contracts.TrimmedNonEmptyString)(longStr);
      expect(decoded).toBe(longStr);
    });

    it("handles special unicode characters in strings", () => {
      const unicodeStr = "Trịnh Phúc Đồng 🌟";
      const decoded = Schema.decodeSync(Contracts.TrimmedNonEmptyString)(unicodeStr);
      expect(decoded).toBe(unicodeStr);
    });
  });

  // Invalid data produces ParseError with meaningful paths
  describe("Invalid Data and Parse Error Paths", () => {
    it("produces meaningful path on invalid Struct property", () => {
      try {
        Schema.decodeSync(Contracts.ServerAuthDescriptor)({
          policy: "invalid-policy-here",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-session-token"],
          sessionCookieName: "t3_session",
        } as any);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(SchemaIssue.isIssue(error.cause)).toBe(true);
        expect(error.message).toContain("policy");
      }
    });

    it("produces meaningful path on missing required field", () => {
      try {
        Schema.decodeSync(Contracts.ServerAuthDescriptor)({
          policy: "loopback-browser",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-session-token"],
          // missing sessionCookieName
        } as any);
        throw new Error("Should have thrown");
      } catch (error: any) {
        expect(SchemaIssue.isIssue(error.cause)).toBe(true);
        expect(error.message).toContain("sessionCookieName");
      }
    });
  });

  // Enum schemas reject unknown values
  describe("Enum Schema Restriction", () => {
    it("rejects unknown values outside the defined literal set", () => {
      expect(() => Schema.decodeSync(Contracts.ServerAuthPolicy)("desktop-managed-local")).not.toThrow();
      expect(() => Schema.decodeSync(Contracts.ServerAuthPolicy)("loopback-browser")).not.toThrow();
      expect(() => Schema.decodeSync(Contracts.ServerAuthPolicy)("unknown-policy-value" as any)).toThrow();
    });

    it("rejects unknown values outside ServerAuthSessionMethod", () => {
      expect(() => Schema.decodeSync(Contracts.ServerAuthSessionMethod)("browser-session-cookie")).not.toThrow();
      expect(() => Schema.decodeSync(Contracts.ServerAuthSessionMethod)("invalid-session-method" as any)).toThrow();
    });
  });
});
