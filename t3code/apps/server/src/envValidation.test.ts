import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Console from "effect/Console";
import * as TestConsole from "effect/testing/TestConsole";
import * as Layer from "effect/Layer";
import { validateConfig } from "./envValidation.ts";

const runWithTestConsole = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(Layer.mergeAll(TestConsole.layer)));

it("validateConfig should report ok for default environment", () =>
  Effect.gen(function* () {
    const result = yield* runWithTestConsole(validateConfig);
    assert.equal(result.okCount, 12);
    assert.equal(result.missingCount, 0);
    assert.equal(result.invalidCount, 0);
  }));

it("validateConfig should report missing when vars are unset", () =>
  Effect.gen(function* () {
    const currentEnv = { ...process.env };
    const keysToRemove = ["T3CODE_LOG_LEVEL", "T3CODE_HOST", "T3CODE_HOME"];
    for (const key of keysToRemove) {
      delete process.env[key];
    }
    try {
      const result = yield* runWithTestConsole(validateConfig);
      assert.equal(result.missingCount, keysToRemove.length);
    } finally {
      Object.assign(process.env, currentEnv);
    }
  }));

it("validateConfig should produce console output", () =>
  Effect.gen(function* () {
    yield* runWithTestConsole(validateConfig);
    const output = yield* TestConsole.logLines;
    assert.isTrue(output.length > 0);
    const combined = output.join(" ");
    assert.isTrue(combined.includes("Environment Configuration Validation"));
  }));
