import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Encoding from "effect/Encoding";
import {
  KeyRotationService,
  KeyRotationServiceLive,
  KeyRotationError,
} from "./KeyRotationService.ts";
import { ElectronSafeStorage, layer as SafeStorageLayer } from "./ElectronSafeStorage.ts";

const testLayer = KeyRotationServiceLive.pipe(Layer.provide(SafeStorageLayer));

const runTest = <A>(
  effect: Effect.Effect<A, never, KeyRotationService | ElectronSafeStorage.ElectronSafeStorage>,
) => Effect.runPromise(effect.pipe(Effect.provide(testLayer)));

describe("KeyRotationService", () => {
  describe("generateKeyVersion", () => {
    it("should generate unique key versions", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* KeyRotationService;
          const v1 = yield* service.generateKeyVersion;
          const v2 = yield* service.generateKeyVersion;
          return { v1, v2 };
        }),
      );

      expect(result.v1).toMatch(/^kv_[a-f0-9]{16}$/);
      expect(result.v2).toMatch(/^kv_[a-f0-9]{16}$/);
      expect(result.v1).not.toBe(result.v2);
    });
  });

  describe("rotateKeys", () => {
    it("should return success with zero credentials", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* KeyRotationService;
          return yield* service.rotateKeys([]);
        }),
      );

      expect(result.success).toBe(true);
      expect(result.credentialsReEncrypted).toBe(0);
      expect(result.oldKeyVersion).toBe("none");
      expect(result.newKeyVersion).toMatch(/^kv_/);
    });

    it("should include rotation timestamp", async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* KeyRotationService;
          return yield* service.rotateKeys([]);
        }),
      );

      expect(result.rotatedAt).toBeDefined();
      expect(new Date(result.rotatedAt).toISOString()).toBe(result.rotatedAt);
    });
  });

  describe("KeyRotationError", () => {
    it("should track phase and affected credentials count", () => {
      const error = new KeyRotationError({
        message: "test error",
        phase: "decrypt",
        credentialsAffected: 3,
      });

      expect(error._tag).toBe("KeyRotationError");
      expect(error.phase).toBe("decrypt");
      expect(error.credentialsAffected).toBe(3);
      expect(error.message).toBe("test error");
    });

    it("should support cause chain", () => {
      const cause = new Error("root cause");
      const error = new KeyRotationError({
        message: "wrapped",
        cause,
        phase: "encrypt",
        credentialsAffected: 0,
      });

      expect(error.cause).toBe(cause);
    });
  });
});
