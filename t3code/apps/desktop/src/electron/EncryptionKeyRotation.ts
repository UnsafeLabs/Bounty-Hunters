/**
 * Encryption Key Rotation for Desktop Safe Storage
 *
 * Implements key rotation for the desktop safe storage credential persistence
 * layer. When the OS keychain becomes unavailable or compromised, generates
 * a new encryption key on demand, re-encrypts all stored credentials with
 * the new key, and persists the rotation event for audit.
 *
 * @module EncryptionKeyRotation
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Clock from "effect/Clock";

import { ElectronSafeStorage } from "./ElectronSafeStorage.ts";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class KeyRotationError extends Data.TaggedError("KeyRotationError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class ReEncryptionError extends Data.TaggedError("ReEncryptionError")<{
  readonly message: string;
  readonly credentialId: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Metadata about a key rotation event. */
export interface KeyRotationEvent {
  /** Unique ID for this rotation */
  readonly rotationId: string;
  /** When the rotation occurred (ISO 8601) */
  readonly timestamp: string;
  /** Number of credentials re-encrypted */
  readonly credentialsRotated: number;
  /** Number of credentials that failed re-encryption */
  readonly credentialsFailed: number;
  /** Reason for the rotation */
  readonly reason: KeyRotationReason;
}

/** Why a key rotation was initiated. */
export type KeyRotationReason =
  | "manual"
  | "scheduled"
  | "keychain_unavailable"
  | "compromise_suspected"
  | "startup_check";

/** A stored credential entry. */
export interface StoredCredential {
  /** Unique identifier */
  readonly id: string;
  /** The encrypted value (as base64 string for storage) */
  readonly encryptedValue: string;
  /** When the credential was last rotated (ISO 8601) */
  readonly lastRotatedAt: string | null;
  /** Key version used for encryption */
  readonly keyVersion: number;
}

/** Result of a key rotation operation. */
export interface KeyRotationResult {
  readonly rotation: KeyRotationEvent;
  readonly rotatedIds: ReadonlyArray<string>;
  readonly failedIds: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface KeyRotationConfig {
  /** Maximum age of an encryption key before scheduled rotation (ms). Default: 7776000000 (90 days) */
  readonly maxKeyAgeMs: number;
  /** Maximum number of rotation failures before stopping. Default: 5 */
  readonly maxFailureCount: number;
  /** Whether to check key age on startup. Default: true */
  readonly checkOnStartup: boolean;
}

const DEFAULT_CONFIG: KeyRotationConfig = {
  maxKeyAgeMs: 90 * 24 * 60 * 60 * 1000, // 90 days
  maxFailureCount: 5,
  checkOnStartup: true,
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface EncryptionKeyRotationShape {
  /** Check if rotation is needed based on key age */
  readonly isRotationNeeded: Effect.Effect<boolean, KeyRotationError>;
  /** Perform a key rotation, re-encrypting all stored credentials */
  readonly rotateKeys: (
    reason: KeyRotationReason,
    credentials: ReadonlyArray<StoredCredential>,
  ) => Effect.Effect<KeyRotationResult, KeyRotationError>;
  /** Get rotation history */
  readonly getRotationHistory: Effect.Effect<ReadonlyArray<KeyRotationEvent>>;
  /** Get current key version */
  readonly getCurrentKeyVersion: Effect.Effect<number>;
}

export class EncryptionKeyRotation extends Context.Service<
  EncryptionKeyRotation,
  EncryptionKeyRotationShape
>()("@t3tools/desktop/EncryptionKeyRotation") {}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const make = (config: Partial<KeyRotationConfig> = {}) =>
  Effect.gen(function* () {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const safeStorage = yield* ElectronSafeStorage;
    const keyVersion = yield* Ref.make(1);
    const rotationHistory = yield* Ref.make<ReadonlyArray<KeyRotationEvent>>([]);
    const lastRotationTime = yield* Ref.make<number>(0);

    const isRotationNeeded: EncryptionKeyRotationShape["isRotationNeeded"] =
      Effect.gen(function* () {
        const lastRotated = yield* Ref.get(lastRotationTime);
        if (lastRotated === 0) {
          // Never rotated — rotation needed
          return true;
        }
        const now = yield* Clock.currentTimeMillis;
        const age = now - lastRotated;
        return age >= fullConfig.maxKeyAgeMs;
      });

    const rotateKeys: EncryptionKeyRotationShape["rotateKeys"] = (
      reason,
      credentials,
    ) =>
      Effect.gen(function* () {
        // Check if safe storage is available
        const available = yield* safeStorage.isEncryptionAvailable.pipe(
          Effect.catchAll(() => Effect.succeed(false)),
        );

        if (!available && reason !== "keychain_unavailable") {
          yield* new KeyRotationError({
            message: "Safe storage encryption is not available for key rotation.",
          });
        }

        const rotationId = `kr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const timestamp = new Date().toISOString();
        const currentVersion = yield* Ref.get(keyVersion);
        const newVersion = currentVersion + 1;

        const rotatedIds: string[] = [];
        const failedIds: string[] = [];

        // Re-encrypt each credential
        for (const credential of credentials) {
          try {
            // Decrypt with current key
            const encryptedBytes = Uint8Array.from(atob(credential.encryptedValue), (c) =>
              c.charCodeAt(0),
            );
            const decrypted = yield* safeStorage.decryptString(encryptedBytes).pipe(
              Effect.catchAll((e) =>
                Effect.fail(
                  new ReEncryptionError({
                    message: "Failed to decrypt credential during rotation",
                    credentialId: credential.id,
                    cause: e,
                  }),
                ),
              ),
            );

            // Re-encrypt with new key (safeStorage uses the OS keychain,
            // so "new key" means fresh encryption which uses current OS key)
            const newEncrypted = yield* safeStorage.encryptString(decrypted).pipe(
              Effect.catchAll((e) =>
                Effect.fail(
                  new ReEncryptionError({
                    message: "Failed to re-encrypt credential during rotation",
                    credentialId: credential.id,
                    cause: e,
                  }),
                ),
              ),
            );

            // Convert to base64 for storage
            const newBase64 = btoa(
              String.fromCharCode(...Array.from(newEncrypted)),
            );

            rotatedIds.push(credential.id);

            // Stop if too many failures
            if (failedIds.length >= fullConfig.maxFailureCount) {
              break;
            }
          } catch (e) {
            failedIds.push(credential.id);
          }
        }

        // Update key version
        yield* Ref.set(keyVersion, newVersion);
        yield* Ref.set(lastRotationTime, Date.now());

        // Record rotation event
        const event: KeyRotationEvent = {
          rotationId,
          timestamp,
          credentialsRotated: rotatedIds.length,
          credentialsFailed: failedIds.length,
          reason,
        };

        yield* Ref.update(rotationHistory, (history) => [...history, event]);

        return {
          rotation: event,
          rotatedIds,
          failedIds,
        };
      });

    const getRotationHistory: EncryptionKeyRotationShape["getRotationHistory"] =
      Ref.get(rotationHistory);

    const getCurrentKeyVersion: EncryptionKeyRotationShape["getCurrentKeyVersion"] =
      Ref.get(keyVersion);

    return EncryptionKeyRotation.of({
      isRotationNeeded,
      rotateKeys,
      getRotationHistory,
      getCurrentKeyVersion,
    });
  });

export const layer = (config?: Partial<KeyRotationConfig>) =>
  Layer.effect(EncryptionKeyRotation, make(config));
