import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { NonNegativeInt, TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

describe("TrimmedString", () => {
  it("round-trips a normal string", () => {
    const roundtrip = Schema.decodeUnknownSync(TrimmedString)(Schema.encodeSync(TrimmedString)("  hello  "));
    expect(roundtrip).toBe("hello");
  });
  it("trims whitespace", () => {
    const decoded = Schema.decodeUnknownSync(TrimmedString)("  spaced  ");
    expect(decoded).toBe("spaced");
  });
  it("rejects non-strings", () => {
    expect(() => Schema.decodeUnknownSync(TrimmedString)(42)).toThrow();
  });
});

describe("TrimmedNonEmptyString", () => {
  it("round-trips a non-empty trimmed string", () => {
    const val = Schema.encodeSync(TrimmedNonEmptyString)("test");
    expect(Schema.decodeUnknownSync(TrimmedNonEmptyString)(val)).toBe("test");
  });
  it("rejects empty after trim", () => {
    expect(() => Schema.decodeUnknownSync(TrimmedNonEmptyString)("   ")).toThrow();
  });
});

describe("NonNegativeInt", () => {
  it("round-trips zero", () => {
    expect(Schema.decodeUnknownSync(NonNegativeInt)(0)).toBe(0);
  });
  it("round-trips positive int", () => {
    expect(Schema.decodeUnknownSync(NonNegativeInt)(42)).toBe(42);
  });
  it("rejects negative", () => {
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(-1)).toThrow();
  });
  it("rejects float", () => {
    expect(() => Schema.decodeUnknownSync(NonNegativeInt)(1.5)).toThrow();
  });
});
