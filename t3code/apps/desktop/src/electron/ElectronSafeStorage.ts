import * as Arr from "effect/Array";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as Electron from "electron";

export class ElectronSafeStorageAvailabilityError extends Data.TaggedError(
  "ElectronSafeStorageAvailabilityError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron safe storage failed to check encryption availability.";
  }
}

export class ElectronSafeStorageEncryptError extends Data.TaggedError(
  "ElectronSafeStorageEncryptError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron safe storage failed to encrypt a string.";
  }
}

export class ElectronSafeStorageDecryptError extends Data.TaggedError(
  "ElectronSafeStorageDecryptError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron safe storage failed to decrypt a string.";
  }
}

export class ElectronSafeStorageKeyRotationError extends Data.TaggedError(
  "ElectronSafeStorageKeyRotationError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Electron safe storage key rotation failed.";
  }
}

interface KeyRecord {
  readonly id: string;
  readonly createdAt: number;
}

interface KeyRotationState {
  readonly currentKeyId: string;
  readonly oldKeys: ReadonlyArray<KeyRecord>;
}

const storePrefix = "t3k:";

const makeKeyId = (): string =>
  `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const encodeVersioned = (keyId: string, ciphertext: Uint8Array): Uint8Array => {
  const encoded = new TextEncoder().encode(storePrefix + keyId + "\n");
  const result = new Uint8Array(encoded.length + ciphertext.length);
  result.set(encoded);
  result.set(ciphertext, encoded.length);
  return result;
};

export interface ElectronSafeStorageShape {
  readonly isEncryptionAvailable: Effect.Effect<boolean, ElectronSafeStorageAvailabilityError>;
  readonly encryptString: (
    value: string,
  ) => Effect.Effect<Uint8Array, ElectronSafeStorageEncryptError>;
  readonly decryptString: (
    value: Uint8Array,
  ) => Effect.Effect<string, ElectronSafeStorageDecryptError>;
  readonly rotate: Effect.Effect<void, ElectronSafeStorageEncryptError | ElectronSafeStorageKeyRotationError>;
}

export class ElectronSafeStorage extends Context.Service<
  ElectronSafeStorage,
  ElectronSafeStorageShape
>()("@t3tools/desktop/ElectronSafeStorage") {}

const make = Effect.fn("ElectronSafeStorage.make")(function* () {
  const state = yield* Ref.make<KeyRotationState>({
    currentKeyId: makeKeyId(),
    oldKeys: [],
  });

  const doEncrypt = (value: string, keyId: string) =>
    Effect.try({
      try: () => encodeVersioned(keyId, Electron.safeStorage.encryptString(value)),
      catch: (cause) => new ElectronSafeStorageEncryptError({ cause }),
    });

  const doDecrypt = (value: Uint8Array) =>
    Effect.try({
      try: () => {
        const decoded = new TextDecoder().decode(value);
        if (decoded.startsWith(storePrefix)) {
          const newlineIdx = decoded.indexOf("\n");
          if (newlineIdx !== -1) {
            const raw = value.slice(newlineIdx + 1);
            return Electron.safeStorage.decryptString(Buffer.from(raw));
          }
        }
        return Electron.safeStorage.decryptString(Buffer.from(value));
      },
      catch: (cause) => new ElectronSafeStorageDecryptError({ cause }),
    });

  const currentKeyStore = new Map<string, string>();

  const doStore = (value: string) =>
    Effect.try({
      try: () => {
        const encrypted = Electron.safeStorage.encryptString(value);
        return Buffer.from(encrypted).toString("base64");
      },
      catch: (cause) => new ElectronSafeStorageKeyRotationError({ cause }),
    });

  const doRetrieve = (stored: string) =>
    Effect.try({
      try: () =>
        Electron.safeStorage.decryptString(Buffer.from(stored, "base64")),
      catch: () => undefined,
    });

  return ElectronSafeStorage.of({
    isEncryptionAvailable: Effect.try({
      try: () => Electron.safeStorage.isEncryptionAvailable(),
      catch: (cause) => new ElectronSafeStorageAvailabilityError({ cause }),
    }),
    encryptString: (value: string) =>
      Ref.get(state).pipe(
        Effect.flatMap((s) => doEncrypt(value, s.currentKeyId)),
      ),
    decryptString: (value: Uint8Array) =>
      doDecrypt(value).pipe(
        Effect.catchAll(() =>
          Ref.get(state).pipe(
            Effect.flatMap((s) =>
              Arr.findFirst(s.oldKeys, (k) => {
                const stored = currentKeyStore.get(k.id);
                return stored !== undefined;
              }).pipe(
                Effect.flatMap((found) => {
                  if (found) {
                    const stored = currentKeyStore.get(found.id)!;
                    return doRetrieve(stored).pipe(
                      Effect.flatMap((decrypted) => {
                        if (decrypted !== undefined) {
                          return Effect.succeed(decrypted);
                        }
                        return Effect.fail(new ElectronSafeStorageDecryptError({
                          cause: new Error("Decryption failed with all keys"),
                        }));
                      }),
                    );
                  }
                  return Effect.fail(new ElectronSafeStorageDecryptError({
                    cause: new Error("Decryption failed with all keys"),
                  }));
                }),
              ),
            ),
          ),
        ),
      ),
    rotate: Ref.get(state).pipe(
      Effect.flatMap((s) =>
        doEncrypt(s.currentKeyId, s.currentKeyId).pipe(
          Effect.flatMap((selfEncrypted) => {
            const encoded = Buffer.from(selfEncrypted).toString("base64");
            currentKeyStore.set(s.currentKeyId, encoded);
            const oldEntry: KeyRecord = {
              id: s.currentKeyId,
              createdAt: Date.now(),
            };
            const newKeyId = makeKeyId();
            return Ref.set(state, {
              currentKeyId: newKeyId,
              oldKeys: [...s.oldKeys, oldEntry],
            }).pipe(Effect.flatMap(() =>
              doEncrypt(newKeyId, newKeyId).pipe(
                Effect.map(() => void 0),
              )
            ));
          }),
        ),
      ),
    ),
  });
});

export const layer = Layer.effect(ElectronSafeStorage, make);
