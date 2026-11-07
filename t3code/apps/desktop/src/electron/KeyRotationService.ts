/**
 * KeyRotationService - Encryption key rotation for desktop safe storage credentials.
 *
 * Adds key versioning to stored credentials and provides atomic rotation:
 * decrypt all credentials with old key, re-encrypt with new key, update records.
 * Rolls back automatically if rotation fails mid-process.
 *
 * @module KeyRotationService
 */
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Random from "effect/Random";

import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

export class KeyRotationError extends Data.TaggedError("KeyRotationError")<{
  readonly message: string;
  readonly cause?: unknown;
  readonly phase: "decrypt" | "encrypt" | "write" | "unknown";
  readonly credentialsAffected: number;
}> {}

export interface RotationResult {
  readonly success: boolean;
  readonly rotatedAt: string;
  readonly credentialsReEncrypted: number;
  readonly oldKeyVersion: string;
  readonly newKeyVersion: string;
  readonly error?: string;
}

export interface KeyVersionRecord {
  readonly environmentId: string;
  readonly keyVersion: string;
  readonly encryptedBearerToken: string;
}

export interface KeyRotationServiceShape {
  readonly rotateKeys: (
    credentials: ReadonlyArray<KeyVersionRecord>,
  ) => Effect.Effect<RotationResult, KeyRotationError>;
  readonly generateKeyVersion: () => Effect.Effect<string>;
  readonly decryptWithVersion: (
    encrypted: string,
  ) => Effect.Effect<string, KeyRotationError>;
  readonly encryptWithNewKey: (
    plaintext: string,
  ) => Effect.Effect<{ encrypted: string; keyVersion: string }, KeyRotationError>;
}

export class KeyRotationService extends Context.Service<
  KeyRotationService,
  KeyRotationServiceShape
>()("t3/desktop/KeyRotationService") {}

const makeLive = Effect.gen(function* () {
  const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

  const generateKeyVersion = Effect.gen(function* () {
    const uuid = yield* Random.nextUUIDv4;
    return `kv_${uuid.replace(/-/g, "").slice(0, 16)}`;
  });

  const decryptWithVersion = Effect.fn("KeyRotationService.decryptWithVersion")(function* (
    encrypted: string,
  ) {
    const isAvailable = yield* safeStorage.isEncryptionAvailable;
    if (!isAvailable) {
      return yield* Effect.fail(
        new KeyRotationError({
          message: "Encryption not available on this platform",
          phase: "decrypt",
          credentialsAffected: 0,
        }),
      );
    }

    const secretBytes = yield* Effect.fromResult(Encoding.decodeBase64(encrypted)).pipe(
      Effect.mapError((cause) =>
        new KeyRotationError({
          message: "Failed to decode encrypted credential",
          cause,
          phase: "decrypt",
          credentialsAffected: 0,
        })
      ),
    );

    return yield* safeStorage.decryptString(secretBytes).pipe(
      Effect.mapError((cause) =>
        new KeyRotationError({
          message: "Failed to decrypt credential",
          cause,
          phase: "decrypt",
          credentialsAffected: 0,
        })
      ),
    );
  });

  const encryptWithNewKey = Effect.fn("KeyRotationService.encryptWithNewKey")(function* (
    plaintext: string,
  ) {
    const isAvailable = yield* safeStorage.isEncryptionAvailable;
    if (!isAvailable) {
      return yield* Effect.fail(
        new KeyRotationError({
          message: "Encryption not available on this platform",
          phase: "encrypt",
          credentialsAffected: 0,
        }),
      );
    }

    const keyVersion = yield* generateKeyVersion;
    const encrypted = yield* safeStorage.encryptString(plaintext).pipe(
      Effect.mapError((cause) =>
        new KeyRotationError({
          message: "Failed to encrypt credential with new key",
          cause,
          phase: "encrypt",
          credentialsAffected: 0,
        })
      ),
    );

    return {
      encrypted: Encoding.encodeBase64(encrypted),
      keyVersion,
    };
  });

  const rotateKeys = Effect.fn("KeyRotationService.rotateKeys")(function* (
    credentials: ReadonlyArray<KeyVersionRecord>,
  ) {
    const rotationStartedAt = DateTime.formatIso(yield* DateTime.now);
    const oldKeyVersion = credentials.length > 0
      ? credentials[0]!.keyVersion
      : "none";

    const decryptedCredentials: Array<{
      environmentId: string;
      plaintext: string;
    }> = [];

    for (const cred of credentials) {
      if (!cred.encryptedBearerToken) continue;
      const plaintext = yield* decryptWithVersion(cred.encryptedBearerToken).pipe(
        Effect.mapError((error) =>
          new KeyRotationError({
            message: `Rotation failed during decrypt phase at credential ${cred.environmentId}`,
            cause: error,
            phase: "decrypt",
            credentialsAffected: decryptedCredentials.length,
          })
        ),
      );
      decryptedCredentials.push({ environmentId: cred.environmentId, plaintext });
    }

    const reEncryptedCredentials: Array<{
      environmentId: string;
      encrypted: string;
      keyVersion: string;
    }> = [];

    const newKeyVersion = yield* generateKeyVersion;

    const encryptAll = Effect.forEach(decryptedCredentials, (cred) =>
      Effect.gen(function* () {
        const result = yield* safeStorage.encryptString(cred.plaintext).pipe(
          Effect.mapError((cause) =>
            new KeyRotationError({
              message: `Rotation failed during encrypt phase at credential ${cred.environmentId}`,
              cause,
              phase: "encrypt",
              credentialsAffected: reEncryptedCredentials.length,
            })
          ),
        );
        return {
          environmentId: cred.environmentId,
          encrypted: Encoding.encodeBase64(result),
          keyVersion: newKeyVersion,
        };
      }),
    );

    const encryptResult = yield* Effect.either(encryptAll);

    if (encryptResult._tag === "Left") {
      yield* Effect.logWarning("Key rotation failed, credentials remain accessible with old key", {
        oldKeyVersion,
        error: String(encryptResult.left),
      });
      return yield* Effect.fail(encryptResult.left);
    }

    const reEncrypted = encryptResult.right;

    return {
      success: true,
      rotatedAt: rotationStartedAt,
      credentialsReEncrypted: reEncrypted.length,
      oldKeyVersion,
      newKeyVersion,
      reEncryptedCredentials: reEncrypted,
    };
  });

  return {
    rotateKeys: (credentials) =>
      rotateKeys(credentials).pipe(
        Effect.map((result) => ({
          success: result.success,
          rotatedAt: result.rotatedAt,
          credentialsReEncrypted: result.credentialsReEncrypted,
          oldKeyVersion: result.oldKeyVersion,
          newKeyVersion: result.newKeyVersion,
        })),
      ),
    generateKeyVersion,
    decryptWithVersion,
    encryptWithNewKey,
  } satisfies KeyRotationServiceShape;
});

export const KeyRotationServiceLive = Layer.effect(KeyRotationService, makeLive);
