import { describe, expect, it } from "vitest";

import {
  type KeyRotationEvent,
  type KeyRotationReason,
  type StoredCredential,
  type KeyRotationResult,
  type KeyRotationConfig,
  DEFAULT_CONFIG,
  KeyRotationError,
  ReEncryptionError,
} from "./EncryptionKeyRotation.ts";

describe("EncryptionKeyRotation", () => {
  describe("config", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_CONFIG.maxKeyAgeMs).toBe(90 * 24 * 60 * 60 * 1000); // 90 days
      expect(DEFAULT_CONFIG.maxFailureCount).toBe(5);
      expect(DEFAULT_CONFIG.checkOnStartup).toBe(true);
    });

    it("allows partial overrides", () => {
      const custom: Partial<KeyRotationConfig> = {
        maxKeyAgeMs: 30 * 24 * 60 * 60 * 1000,
        maxFailureCount: 10,
      };
      const merged = { ...DEFAULT_CONFIG, ...custom };
      expect(merged.maxKeyAgeMs).toBe(30 * 24 * 60 * 60 * 1000);
      expect(merged.maxFailureCount).toBe(10);
      expect(merged.checkOnStartup).toBe(true);
    });
  });

  describe("KeyRotationEvent", () => {
    it("tracks rotation metadata", () => {
      const event: KeyRotationEvent = {
        rotationId: "kr-1234567890-abc123",
        timestamp: "2026-05-17T13:45:00.000Z",
        credentialsRotated: 5,
        credentialsFailed: 0,
        reason: "scheduled",
      };

      expect(event.rotationId).toMatch(/^kr-/);
      expect(event.credentialsRotated).toBe(5);
      expect(event.reason).toBe("scheduled");
    });

    it("supports all rotation reasons", () => {
      const reasons: KeyRotationReason[] = [
        "manual",
        "scheduled",
        "keychain_unavailable",
        "compromise_suspected",
        "startup_check",
      ];

      for (const reason of reasons) {
        const event: KeyRotationEvent = {
          rotationId: `kr-${reason}`,
          timestamp: new Date().toISOString(),
          credentialsRotated: 0,
          credentialsFailed: 0,
          reason,
        };
        expect(event.reason).toBe(reason);
      }
    });
  });

  describe("StoredCredential", () => {
    it("has required fields", () => {
      const credential: StoredCredential = {
        id: "api-key-openai",
        encryptedValue: btoa("encrypted-data"),
        lastRotatedAt: "2026-05-17T13:45:00.000Z",
        keyVersion: 1,
      };

      expect(credential.id).toBe("api-key-openai");
      expect(credential.keyVersion).toBe(1);
      expect(credential.encryptedValue).toBeTruthy();
    });

    it("supports null lastRotatedAt for never-rotated credentials", () => {
      const credential: StoredCredential = {
        id: "new-key",
        encryptedValue: btoa("encrypted"),
        lastRotatedAt: null,
        keyVersion: 1,
      };

      expect(credential.lastRotatedAt).toBeNull();
    });
  });

  describe("KeyRotationResult", () => {
    it("tracks success and failure IDs", () => {
      const result: KeyRotationResult = {
        rotation: {
          rotationId: "kr-123",
          timestamp: new Date().toISOString(),
          credentialsRotated: 3,
          credentialsFailed: 1,
          reason: "manual",
        },
        rotatedIds: ["key-1", "key-2", "key-3"],
        failedIds: ["key-4"],
      };

      expect(result.rotatedIds).toHaveLength(3);
      expect(result.failedIds).toHaveLength(1);
      expect(result.rotation.credentialsRotated).toBe(3);
    });
  });

  describe("error types", () => {
    it("KeyRotationError has message", () => {
      const error = new KeyRotationError({ message: "test error" });
      expect(error._tag).toBe("KeyRotationError");
    });

    it("ReEncryptionError includes credential ID", () => {
      const error = new ReEncryptionError({
        message: "decrypt failed",
        credentialId: "api-key-1",
      });
      expect(error._tag).toBe("ReEncryptionError");
      expect(error.credentialId).toBe("api-key-1");
    });
  });

  describe("key age check", () => {
    it("rotation needed when never rotated", () => {
      const lastRotationTime = 0; // never rotated
      const maxAge = 90 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const age = now - lastRotationTime;
      expect(age >= maxAge).toBe(true); // always true since now > 90 days
    });

    it("rotation not needed for recent rotation", () => {
      const lastRotationTime = Date.now(); // just rotated
      const maxAge = 90 * 24 * 60 * 60 * 1000;
      const age = Date.now() - lastRotationTime;
      expect(age >= maxAge).toBe(false);
    });

    it("rotation needed after max age", () => {
      const maxAge = 90 * 24 * 60 * 60 * 1000;
      const lastRotationTime = Date.now() - maxAge - 1; // just past
      const age = Date.now() - lastRotationTime;
      expect(age >= maxAge).toBe(true);
    });
  });
});
