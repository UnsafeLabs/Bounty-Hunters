import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { it as itEff } from "@effect/vitest";

import {
  ThreadId,
  ProjectId,
  CommandId,
  TrimmedNonEmptyString,
  NonNegativeInt,
  PositiveInt,
  IsoDateTime,
} from "./baseSchemas.ts";
import { ServerProvider, ServerProviderAuth, ServerProviderModel, ServerProviderState } from "./server.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

// ── Helper: round-trip decode → encode → redecode → equals original ────

function roundtripEffect<S extends Schema.Schema.Any>(
  schema: S,
  input: Schema.Schema.Encoded<S>,
) {
  return Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(schema)(input);
    const encoded = yield* Schema.encode(schema)(decoded);
    const redecoded = yield* Schema.decodeUnknown(schema)(encoded);
    // Compare structurally — re-encoded shape may differ from raw input
    // but redecoding should produce equivalent decoded values
    return { decoded, encoded, redecoded };
  });
}

// ── Base Schemas: edge cases ──────────────────────────────────────────

describe("TrimmedNonEmptyString round-trip", () => {
  itEff.effect("round-trips plain strings", () =>
    Effect.gen(function* () {
      const { decoded, redecoded } = yield* roundtripEffect(
        TrimmedNonEmptyString,
        "hello",
      );
      expect(decoded).toBe("hello");
      expect(redecoded).toBe("hello");
    }),
  );

  itEff.effect("trims whitespace on decode", () =>
    Effect.gen(function* () {
      const result = yield* Schema.decodeUnknown(TrimmedNonEmptyString)("  hello  ");
      expect(result).toBe("hello");
    }),
  );

  itEff.effect("rejects empty string", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(TrimmedNonEmptyString)(""),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const msg = result.cause.toString();
        expect(msg).toContain("non-empty");
      }
    }),
  );

  itEff.effect("rejects whitespace-only string", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(TrimmedNonEmptyString)("   "),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("handles unicode characters", () =>
    Effect.gen(function* () {
      const { decoded, redecoded } = yield* roundtripEffect(
        TrimmedNonEmptyString,
        "héllo wörld — 你好 🚀",
      );
      expect(decoded).toBe("héllo wörld — 你好 🚀");
      expect(redecoded).toBe("héllo wörld — 你好 🚀");
    }),
  );

  itEff.effect("handles maximum-length-like strings", () =>
    Effect.gen(function* () {
      const long = "a".repeat(10000);
      const { decoded, redecoded } = yield* roundtripEffect(
        TrimmedNonEmptyString,
        long,
      );
      expect(decoded).toBe(long);
      expect(redecoded).toBe(long);
    }),
  );
});

describe("NonNegativeInt round-trip", () => {
  itEff.effect("accepts zero", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(NonNegativeInt, 0);
      expect(decoded).toBe(0);
    }),
  );

  itEff.effect("accepts positive integers", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(NonNegativeInt, 42);
      expect(decoded).toBe(42);
    }),
  );

  itEff.effect("rejects negative integers", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(NonNegativeInt)(-1),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("rejects floats", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(NonNegativeInt)(3.14),
      );
      expect(result._tag).toBe("Failure");
    }),
  );
});

describe("PositiveInt round-trip", () => {
  itEff.effect("rejects zero", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(PositiveInt)(0),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("accepts positive integers", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(PositiveInt, 1);
      expect(decoded).toBe(1);
      const { decoded: d2 } = yield* roundtripEffect(PositiveInt, 999999);
      expect(d2).toBe(999999);
    }),
  );
});

// ── Branded IDs: edge cases ───────────────────────────────────────────

describe("Branded ID round-trips", () => {
  const testId = <Brand extends string>(
    schema: Schema.Schema<string, string, never>,
    brand: Brand,
    valid: string,
  ) =>
    itEff.effect(`round-trips ${brand}: "${valid}"`, () =>
      Effect.gen(function* () {
        const { decoded, redecoded } = yield* roundtripEffect(schema, valid);
        expect(decoded).toBe(valid);
        expect(redecoded).toBe(valid);
      }),
    );

  testId(ThreadId, "ThreadId", "thread-1");
  testId(ProjectId, "ProjectId", "my-project");
  testId(CommandId, "CommandId", "cmd-abc123");

  itEff.effect("rejects empty branded id", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ThreadId)(""),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("rejects whitespace-only branded id", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ProjectId)("   "),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("trims whitespace from branded ids", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(ThreadId)("  thread-1  ");
      expect(decoded).toBe("thread-1");
    }),
  );

  itEff.effect("handles unicode in branded ids", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(
        ThreadId,
        "thread-ñ-こんにちは",
      );
      expect(decoded).toBe("thread-ñ-こんにちは");
    }),
  );
});

// ── Enum/Literal schemas: reject unknown values ────────────────────────

describe("Enum schema rejection", () => {
  itEff.effect("ServerProviderState rejects unknown values", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ServerProviderState)("bogus"),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const msg = result.cause.toString();
        expect(msg).toMatch(/ready|warning|error|disabled/);
      }
    }),
  );

  itEff.effect("ServerProviderState accepts valid values", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(ServerProviderState, "ready");
      expect(decoded).toBe("ready");
    }),
  );
});

// ── ServerProvider round-trip ──────────────────────────────────────────

describe("ServerProvider round-trip", () => {
  const validProvider = {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready" as const,
    auth: { status: "authenticated" as const },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [{ slug: "gpt-5", name: "GPT-5", isCustom: false, capabilities: null }],
  };

  itEff.effect("round-trips a complete ServerProvider", () =>
    Effect.gen(function* () {
      const { decoded, encoded, redecoded } = yield* roundtripEffect(
        ServerProvider,
        validProvider,
      );
      expect(decoded.instanceId).toBe("codex");
      expect(decoded.driver).toBe("codex");
      expect(decoded.status).toBe("ready");
      expect(decoded.slashCommands).toEqual([]);
      expect(decoded.skills).toEqual([]);
      expect(encoded.instanceId).toBe("codex");
      expect(redecoded.instanceId).toBe("codex");
    }),
  );

  itEff.effect("rejects ServerProvider with missing required fields", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ServerProvider)({}),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("ServerProviderAuth round-trips", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(ServerProviderAuth, {
        status: "authenticated",
        email: "user@example.com",
      });
      expect(decoded.status).toBe("authenticated");
      expect(decoded.email).toBe("user@example.com");
    }),
  );

  itEff.effect("ServerProviderAuth rejects invalid status", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ServerProviderAuth)({
          status: "pending_review",
        }),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("ServerProviderModel round-trips", () =>
    Effect.gen(function* () {
      const { decoded } = yield* roundtripEffect(ServerProviderModel, {
        slug: "gpt-5.3-codex",
        name: "GPT-5.3 Codex",
        shortName: "5.3 Codex",
        isCustom: false,
        capabilities: null,
      });
      expect(decoded.slug).toBe("gpt-5.3-codex");
      expect(decoded.shortName).toBe("5.3 Codex");
    }),
  );
});

// ── ProviderInstanceId round-trip ─────────────────────────────────────

describe("ProviderInstanceId round-trip", () => {
  itEff.effect("round-trips a valid instance id", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(ProviderInstanceId)("codex_personal");
      const encoded = yield* Schema.encode(ProviderInstanceId)(decoded);
      expect(encoded).toBe("codex_personal");
    }),
  );

  itEff.effect("rejects instance ids starting with digit", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ProviderInstanceId)("1invalid"),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("rejects empty instance id", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ProviderInstanceId)(""),
      );
      expect(result._tag).toBe("Failure");
    }),
  );

  itEff.effect("accepts instance ids with hyphens and underscores", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeUnknown(ProviderInstanceId)(
        "codex-work_home-2",
      );
      expect(decoded).toBe("codex-work_home-2");
    }),
  );
});

// ── Negative tests: invalid data → Schema.ParseError with paths ────────

describe("ParseError messages contain meaningful paths", () => {
  itEff.effect("missing required field in nested struct shows path", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ServerProvider)({
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-01-01T00:00:00.000Z",
          // models is missing
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const msg = result.cause.toString();
        expect(msg).toContain("models");
      }
    }),
  );

  itEff.effect("wrong type in nested field shows path", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        Schema.decodeUnknown(ServerProvider)({
          instanceId: "codex",
          driver: "codex",
          enabled: "yes", // should be boolean
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "authenticated" },
          checkedAt: "2026-01-01T00:00:00.000Z",
          models: [],
        }),
      );
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        const msg = result.cause.toString();
        expect(msg).toContain("enabled");
      }
    }),
  );
});
