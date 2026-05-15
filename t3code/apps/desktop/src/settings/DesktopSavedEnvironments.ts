import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Crypto from "node:crypto";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Random from "effect/Random";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../electron/ElectronSafeStorage.ts";

type PersistedSavedEnvironmentDesktopSsh = NonNullable<
  PersistedSavedEnvironmentRecord["desktopSsh"]
>;

interface PersistedSavedEnvironmentStorageRecord extends Omit<
  PersistedSavedEnvironmentRecord,
  "desktopSsh"
> {
  readonly desktopSsh?: PersistedSavedEnvironmentDesktopSsh;
  readonly encryptedBearerToken?: string;
  readonly encryptedBearerTokenKeyVersion?: number;
}

interface SavedEnvironmentSafeStorageKey {
  readonly version: number;
  readonly encryptedKey: string;
  readonly createdAt: string;
}

interface SavedEnvironmentSafeStorageKeyring {
  readonly currentVersion: number;
  readonly keys: readonly SavedEnvironmentSafeStorageKey[];
}

interface SavedEnvironmentRegistryDocument {
  readonly version: number;
  readonly records: readonly PersistedSavedEnvironmentStorageRecord[];
  readonly safeStorageKeyring?: SavedEnvironmentSafeStorageKeyring;
}

interface SavedEnvironmentRegistryStorageDocument {
  readonly version?: number;
  readonly records?: readonly PersistedSavedEnvironmentStorageRecord[];
  readonly safeStorageKeyring?: SavedEnvironmentSafeStorageKeyring;
}

interface EncryptedBearerTokenReference {
  readonly encryptedBearerToken: string;
  readonly encryptedBearerTokenKeyVersion?: number;
}

export interface DesktopSafeStorageKeyRotationResult {
  readonly rotatedAt: string;
  readonly previousKeyVersion: number | null;
  readonly currentKeyVersion: number;
  readonly reencryptedCredentials: number;
}

const DesktopSshTargetSchema = Schema.Struct({
  alias: Schema.String,
  hostname: Schema.String,
  username: Schema.NullOr(Schema.String),
  port: Schema.NullOr(Schema.Number),
});

const PersistedSavedEnvironmentStorageRecordSchema = Schema.Struct({
  environmentId: EnvironmentId,
  label: Schema.String,
  httpBaseUrl: Schema.String,
  wsBaseUrl: Schema.String,
  createdAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
  desktopSsh: Schema.optionalKey(DesktopSshTargetSchema),
  encryptedBearerToken: Schema.optionalKey(Schema.String),
  encryptedBearerTokenKeyVersion: Schema.optionalKey(Schema.Number),
});

const SavedEnvironmentSafeStorageKeySchema = Schema.Struct({
  version: Schema.Number,
  encryptedKey: Schema.String,
  createdAt: Schema.String,
});

const SavedEnvironmentSafeStorageKeyringSchema = Schema.Struct({
  currentVersion: Schema.Number,
  keys: Schema.Array(SavedEnvironmentSafeStorageKeySchema),
});

const SavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(Schema.Array(PersistedSavedEnvironmentStorageRecordSchema)),
  safeStorageKeyring: Schema.optionalKey(SavedEnvironmentSafeStorageKeyringSchema),
});

const SavedEnvironmentRegistryDocumentJson = fromLenientJson(
  SavedEnvironmentRegistryDocumentSchema,
);
const decodeSavedEnvironmentRegistryDocumentJson = Schema.decodeEffect(
  SavedEnvironmentRegistryDocumentJson,
);
const encodeSavedEnvironmentRegistryDocumentJson = Schema.encodeEffect(
  SavedEnvironmentRegistryDocumentJson,
);

export class DesktopSavedEnvironmentsWriteError extends Data.TaggedError(
  "DesktopSavedEnvironmentsWriteError",
)<{
  readonly cause: PlatformError.PlatformError | Schema.SchemaError;
}> {
  override get message() {
    return `Failed to write desktop saved environments: ${this.cause.message}`;
  }
}

export class DesktopSavedEnvironmentSecretDecodeError extends Data.TaggedError(
  "DesktopSavedEnvironmentSecretDecodeError",
)<{
  readonly cause: Encoding.EncodingError;
}> {
  override get message() {
    return "Failed to decode desktop saved environment secret.";
  }
}

export class DesktopSavedEnvironmentSecretCipherError extends Data.TaggedError(
  "DesktopSavedEnvironmentSecretCipherError",
)<{
  readonly cause: unknown;
}> {
  override get message() {
    return "Failed to decrypt desktop saved environment secret.";
  }
}

export class DesktopSavedEnvironmentKeyRotationUnavailableError extends Data.TaggedError(
  "DesktopSavedEnvironmentKeyRotationUnavailableError",
)<{}> {
  override get message() {
    return "Desktop safe storage encryption is unavailable.";
  }
}

export type DesktopSavedEnvironmentsGetSecretError =
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError;

export type DesktopSavedEnvironmentsSetSecretError =
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | DesktopSavedEnvironmentsWriteError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError
  | ElectronSafeStorage.ElectronSafeStorageEncryptError;

export type DesktopSavedEnvironmentsRotateKeysError =
  | DesktopSavedEnvironmentKeyRotationUnavailableError
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | DesktopSavedEnvironmentsWriteError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError
  | ElectronSafeStorage.ElectronSafeStorageEncryptError;

export interface DesktopSavedEnvironmentsShape {
  readonly getRegistry: Effect.Effect<readonly PersistedSavedEnvironmentRecord[]>;
  readonly setRegistry: (
    records: readonly PersistedSavedEnvironmentRecord[],
  ) => Effect.Effect<void, DesktopSavedEnvironmentsWriteError>;
  readonly getSecret: (
    environmentId: string,
  ) => Effect.Effect<Option.Option<string>, DesktopSavedEnvironmentsGetSecretError>;
  readonly setSecret: (input: {
    readonly environmentId: string;
    readonly secret: string;
  }) => Effect.Effect<boolean, DesktopSavedEnvironmentsSetSecretError>;
  readonly removeSecret: (
    environmentId: string,
  ) => Effect.Effect<void, DesktopSavedEnvironmentsWriteError>;
  readonly rotateKeys: Effect.Effect<
    DesktopSafeStorageKeyRotationResult,
    DesktopSavedEnvironmentsRotateKeysError
  >;
}

export class DesktopSavedEnvironments extends Context.Service<
  DesktopSavedEnvironments,
  DesktopSavedEnvironmentsShape
>()("t3/desktop/SavedEnvironments") {}

function toPersistedSavedEnvironmentRecord(
  record: PersistedSavedEnvironmentStorageRecord,
): PersistedSavedEnvironmentRecord {
  const nextRecord = {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  return record.desktopSsh ? { ...nextRecord, desktopSsh: record.desktopSsh } : nextRecord;
}

function toSavedEnvironmentStorageRecord(
  record: PersistedSavedEnvironmentRecord | PersistedSavedEnvironmentStorageRecord,
  encryptedBearerToken: Option.Option<EncryptedBearerTokenReference>,
): PersistedSavedEnvironmentStorageRecord {
  const nextRecord = {
    environmentId: record.environmentId,
    label: record.label,
    httpBaseUrl: record.httpBaseUrl,
    wsBaseUrl: record.wsBaseUrl,
    createdAt: record.createdAt,
    lastConnectedAt: record.lastConnectedAt,
  };
  const desktopSsh = record.desktopSsh;
  if (desktopSsh) {
    return Option.match(encryptedBearerToken, {
      onNone: () => ({ ...nextRecord, desktopSsh }),
      onSome: (value) => ({
        ...nextRecord,
        desktopSsh,
        encryptedBearerToken: value.encryptedBearerToken,
        ...(value.encryptedBearerTokenKeyVersion === undefined
          ? {}
          : { encryptedBearerTokenKeyVersion: value.encryptedBearerTokenKeyVersion }),
      }),
    });
  }
  return Option.match(encryptedBearerToken, {
    onNone: () => nextRecord,
    onSome: (value) => ({
      ...nextRecord,
      encryptedBearerToken: value.encryptedBearerToken,
      ...(value.encryptedBearerTokenKeyVersion === undefined
        ? {}
        : { encryptedBearerTokenKeyVersion: value.encryptedBearerTokenKeyVersion }),
    }),
  });
}

function normalizeSavedEnvironmentRegistryDocument(
  document: SavedEnvironmentRegistryStorageDocument,
): SavedEnvironmentRegistryDocument {
  return {
    version: document.version ?? 1,
    records: document.records ?? [],
    ...(document.safeStorageKeyring === undefined
      ? {}
      : { safeStorageKeyring: document.safeStorageKeyring }),
  };
}

function readRegistryDocument(
  fileSystem: FileSystem.FileSystem,
  registryPath: string,
): Effect.Effect<SavedEnvironmentRegistryDocument> {
  return fileSystem.readFileString(registryPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed({ version: 1, records: [] }),
        onSome: (raw) =>
          decodeSavedEnvironmentRegistryDocumentJson(raw).pipe(
            Effect.map(normalizeSavedEnvironmentRegistryDocument),
            Effect.catch(() => Effect.succeed({ version: 1, records: [] })),
          ),
      }),
    ),
  );
}

const writeRegistryDocument = Effect.fn("desktop.savedEnvironments.writeRegistryDocument")(
  function* (input: {
    readonly fileSystem: FileSystem.FileSystem;
    readonly path: Path.Path;
    readonly registryPath: string;
    readonly document: SavedEnvironmentRegistryDocument;
  }): Effect.fn.Return<void, PlatformError.PlatformError | Schema.SchemaError> {
    const directory = input.path.dirname(input.registryPath);
    const suffix = (yield* Random.nextUUIDv4).replace(/-/g, "");
    const tempPath = `${input.registryPath}.${process.pid}.${suffix}.tmp`;
    const encoded = yield* encodeSavedEnvironmentRegistryDocumentJson(input.document);
    yield* input.fileSystem.makeDirectory(directory, { recursive: true });
    yield* input.fileSystem.writeFileString(tempPath, `${encoded}\n`);
    yield* input.fileSystem.rename(tempPath, input.registryPath);
  },
);

function preserveExistingSecrets(
  currentDocument: SavedEnvironmentRegistryDocument,
  records: readonly PersistedSavedEnvironmentRecord[],
): SavedEnvironmentRegistryDocument {
  const encryptedBearerTokenById = new Map(
    currentDocument.records.flatMap((record) =>
      record.encryptedBearerToken
        ? [
            [
              record.environmentId,
              {
                encryptedBearerToken: record.encryptedBearerToken,
                ...(record.encryptedBearerTokenKeyVersion === undefined
                  ? {}
                  : { encryptedBearerTokenKeyVersion: record.encryptedBearerTokenKeyVersion }),
              },
            ] as const,
          ]
        : [],
    ),
  );

  return {
    version: currentDocument.version,
    ...(currentDocument.safeStorageKeyring === undefined
      ? {}
      : { safeStorageKeyring: currentDocument.safeStorageKeyring }),
    records: records.map((record) => {
      const encryptedBearerToken = encryptedBearerTokenById.get(record.environmentId);
      return toSavedEnvironmentStorageRecord(record, Option.fromNullishOr(encryptedBearerToken));
    }),
  };
}

function decodeSecretBytes(
  encoded: string,
): Effect.Effect<Uint8Array, DesktopSavedEnvironmentSecretDecodeError> {
  return Effect.fromResult(Encoding.decodeBase64(encoded)).pipe(
    Effect.mapError((cause) => new DesktopSavedEnvironmentSecretDecodeError({ cause })),
  );
}

const DATA_KEY_BYTES = 32;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_AUTH_TAG_BYTES = 16;
const currentIsoTimestamp = DateTime.now.pipe(Effect.map(DateTime.formatIso));

function encodeDataKey(value: Uint8Array): string {
  return Buffer.from(value).toString("base64");
}

function maxKeyVersion(keyring: Option.Option<SavedEnvironmentSafeStorageKeyring>): number {
  return Option.match(keyring, {
    onNone: () => 0,
    onSome: (value) =>
      value.keys.reduce((highest, key) => Math.max(highest, key.version), value.currentVersion),
  });
}

function findKeyEntry(
  keyring: SavedEnvironmentSafeStorageKeyring | undefined,
  version: number,
): Effect.Effect<SavedEnvironmentSafeStorageKey, DesktopSavedEnvironmentSecretCipherError> {
  const key = keyring?.keys.find((entry) => entry.version === version);
  if (key === undefined) {
    return Effect.fail(
      new DesktopSavedEnvironmentSecretCipherError({
        cause: new Error(`Missing safe storage key version ${version}.`),
      }),
    );
  }
  return Effect.succeed(key);
}

function validateDataKey(
  value: Uint8Array,
): Effect.Effect<Uint8Array, DesktopSavedEnvironmentSecretCipherError> {
  if (value.byteLength !== DATA_KEY_BYTES) {
    return Effect.fail(
      new DesktopSavedEnvironmentSecretCipherError({
        cause: new Error("Invalid safe storage data key length."),
      }),
    );
  }
  return Effect.succeed(value);
}

function decryptSafeStorageKey(
  safeStorage: ElectronSafeStorage.ElectronSafeStorageShape,
  key: SavedEnvironmentSafeStorageKey,
): Effect.Effect<
  Uint8Array,
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError
> {
  return Effect.gen(function* () {
    const wrappedKeyBytes = yield* decodeSecretBytes(key.encryptedKey);
    const rawKey = yield* safeStorage.decryptString(wrappedKeyBytes);
    return yield* decodeSecretBytes(rawKey).pipe(Effect.flatMap(validateDataKey));
  });
}

function encryptCredentialWithDataKey(
  secret: string,
  key: Uint8Array,
): Effect.Effect<string, DesktopSavedEnvironmentSecretCipherError> {
  return Effect.try({
    try: () => {
      const iv = Crypto.randomBytes(AES_GCM_IV_BYTES);
      const cipher = Crypto.createCipheriv("aes-256-gcm", Buffer.from(key), iv);
      const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
    },
    catch: (cause) => new DesktopSavedEnvironmentSecretCipherError({ cause }),
  });
}

function decryptCredentialWithDataKey(
  encryptedSecret: string,
  key: Uint8Array,
): Effect.Effect<
  string,
  DesktopSavedEnvironmentSecretDecodeError | DesktopSavedEnvironmentSecretCipherError
> {
  return Effect.gen(function* () {
    const payload = Buffer.from(yield* decodeSecretBytes(encryptedSecret));
    if (payload.byteLength <= AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES) {
      return yield* new DesktopSavedEnvironmentSecretCipherError({
        cause: new Error("Invalid encrypted credential payload."),
      });
    }

    return yield* Effect.try({
      try: () => {
        const iv = payload.subarray(0, AES_GCM_IV_BYTES);
        const authTag = payload.subarray(
          AES_GCM_IV_BYTES,
          AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES,
        );
        const ciphertext = payload.subarray(AES_GCM_IV_BYTES + AES_GCM_AUTH_TAG_BYTES);
        const decipher = Crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
        decipher.setAuthTag(authTag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      },
      catch: (cause) => new DesktopSavedEnvironmentSecretCipherError({ cause }),
    });
  });
}

function generateSafeStorageKey(
  safeStorage: ElectronSafeStorage.ElectronSafeStorageShape,
  version: number,
  createdAt: string,
): Effect.Effect<
  { readonly entry: SavedEnvironmentSafeStorageKey; readonly key: Uint8Array },
  ElectronSafeStorage.ElectronSafeStorageEncryptError
> {
  return Effect.gen(function* () {
    const key = Crypto.randomBytes(DATA_KEY_BYTES);
    const encryptedKey = Encoding.encodeBase64(
      yield* safeStorage.encryptString(encodeDataKey(key)),
    );
    return {
      entry: {
        version,
        encryptedKey,
        createdAt,
      },
      key,
    };
  });
}

function resolveCurrentDataKey(
  safeStorage: ElectronSafeStorage.ElectronSafeStorageShape,
  document: SavedEnvironmentRegistryDocument,
): Effect.Effect<
  { readonly version: number; readonly key: Uint8Array },
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError
> {
  return Effect.gen(function* () {
    const keyring = document.safeStorageKeyring;
    if (keyring === undefined) {
      return yield* new DesktopSavedEnvironmentSecretCipherError({
        cause: new Error("Missing safe storage keyring."),
      });
    }
    const entry = yield* findKeyEntry(keyring, keyring.currentVersion);
    const key = yield* decryptSafeStorageKey(safeStorage, entry);
    return { version: keyring.currentVersion, key };
  });
}

function ensureCurrentDataKey(
  safeStorage: ElectronSafeStorage.ElectronSafeStorageShape,
  document: SavedEnvironmentRegistryDocument,
): Effect.Effect<
  {
    readonly document: SavedEnvironmentRegistryDocument;
    readonly version: number;
    readonly key: Uint8Array;
  },
  | DesktopSavedEnvironmentSecretDecodeError
  | DesktopSavedEnvironmentSecretCipherError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError
  | ElectronSafeStorage.ElectronSafeStorageEncryptError
> {
  if (document.safeStorageKeyring !== undefined) {
    return resolveCurrentDataKey(safeStorage, document).pipe(
      Effect.map(({ version, key }) => ({ document, version, key })),
    );
  }

  return Effect.gen(function* () {
    const createdAt = yield* currentIsoTimestamp;
    const { entry, key } = yield* generateSafeStorageKey(safeStorage, 1, createdAt);
    return {
      document: {
        ...document,
        safeStorageKeyring: {
          currentVersion: entry.version,
          keys: [entry],
        },
      },
      version: entry.version,
      key,
    };
  });
}

function readRecordSecret(
  safeStorage: ElectronSafeStorage.ElectronSafeStorageShape,
  document: SavedEnvironmentRegistryDocument,
  record: PersistedSavedEnvironmentStorageRecord,
): Effect.Effect<Option.Option<string>, DesktopSavedEnvironmentsGetSecretError> {
  return Effect.gen(function* () {
    const encoded = Option.fromNullishOr(record.encryptedBearerToken);
    if (Option.isNone(encoded)) {
      return Option.none<string>();
    }

    if (record.encryptedBearerTokenKeyVersion === undefined) {
      const secretBytes = yield* decodeSecretBytes(encoded.value);
      return Option.some(yield* safeStorage.decryptString(secretBytes));
    }

    const keyEntry = yield* findKeyEntry(
      document.safeStorageKeyring,
      record.encryptedBearerTokenKeyVersion,
    );
    const key = yield* decryptSafeStorageKey(safeStorage, keyEntry);
    return Option.some(yield* decryptCredentialWithDataKey(encoded.value, key));
  });
}

export const layer = Layer.effect(
  DesktopSavedEnvironments,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;

    const writeDocument = (document: SavedEnvironmentRegistryDocument) =>
      writeRegistryDocument({
        fileSystem,
        path,
        registryPath: environment.savedEnvironmentRegistryPath,
        document,
      }).pipe(Effect.mapError((cause) => new DesktopSavedEnvironmentsWriteError({ cause })));

    return DesktopSavedEnvironments.of({
      getRegistry: readRegistryDocument(fileSystem, environment.savedEnvironmentRegistryPath).pipe(
        Effect.map((document) =>
          document.records.map((record) => toPersistedSavedEnvironmentRecord(record)),
        ),
        Effect.withSpan("desktop.savedEnvironments.getRegistry"),
      ),
      setRegistry: Effect.fn("desktop.savedEnvironments.setRegistry")(function* (records) {
        const currentDocument = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );
        yield* writeDocument(preserveExistingSecrets(currentDocument, records));
      }),
      getSecret: Effect.fn("desktop.savedEnvironments.getSecret")(function* (environmentId) {
        yield* Effect.annotateCurrentSpan({ environmentId });
        const document = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );
        const record = document.records.find((record) => record.environmentId === environmentId);
        if (record === undefined || !(yield* safeStorage.isEncryptionAvailable)) {
          return Option.none<string>();
        }

        return yield* readRecordSecret(safeStorage, document, record);
      }),
      setSecret: Effect.fn("desktop.savedEnvironments.setSecret")(function* (input) {
        const { environmentId, secret } = input;
        yield* Effect.annotateCurrentSpan({ environmentId });
        const document = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );

        if (!(yield* safeStorage.isEncryptionAvailable)) {
          return false;
        }

        const currentKey = yield* ensureCurrentDataKey(safeStorage, document);
        const encryptedBearerToken = yield* encryptCredentialWithDataKey(secret, currentKey.key);
        let found = false;
        const nextDocument: SavedEnvironmentRegistryDocument = {
          version: currentKey.document.version,
          ...(currentKey.document.safeStorageKeyring === undefined
            ? {}
            : { safeStorageKeyring: currentKey.document.safeStorageKeyring }),
          records: currentKey.document.records.map((record) => {
            if (record.environmentId !== environmentId) {
              return record;
            }

            found = true;
            return toSavedEnvironmentStorageRecord(
              record,
              Option.some({
                encryptedBearerToken,
                encryptedBearerTokenKeyVersion: currentKey.version,
              }),
            );
          }),
        };

        if (found) {
          yield* writeDocument(nextDocument);
        }
        return found;
      }),
      removeSecret: Effect.fn("desktop.savedEnvironments.removeSecret")(function* (environmentId) {
        yield* Effect.annotateCurrentSpan({ environmentId });
        const document = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );
        if (
          !document.records.some(
            (record) =>
              record.environmentId === environmentId && record.encryptedBearerToken !== undefined,
          )
        ) {
          return;
        }

        yield* writeDocument({
          version: document.version,
          ...(document.safeStorageKeyring === undefined
            ? {}
            : { safeStorageKeyring: document.safeStorageKeyring }),
          records: document.records.map((record) => {
            if (record.environmentId !== environmentId) {
              return record;
            }
            return toPersistedSavedEnvironmentRecord(record);
          }),
        });
      }),
      rotateKeys: Effect.gen(function* () {
        if (!(yield* safeStorage.isEncryptionAvailable)) {
          return yield* new DesktopSavedEnvironmentKeyRotationUnavailableError();
        }

        const document = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );
        const recordsWithSecrets = [];
        for (const record of document.records) {
          const secret = yield* readRecordSecret(safeStorage, document, record);
          if (Option.isSome(secret)) {
            recordsWithSecrets.push({ environmentId: record.environmentId, secret: secret.value });
          }
        }

        const rotatedAt = yield* currentIsoTimestamp;
        const previousKeyVersion = document.safeStorageKeyring?.currentVersion ?? null;
        const currentKeyVersion =
          maxKeyVersion(Option.fromNullishOr(document.safeStorageKeyring)) + 1;
        const { entry, key } = yield* generateSafeStorageKey(
          safeStorage,
          currentKeyVersion,
          rotatedAt,
        );
        const secretByEnvironmentId = new Map(
          yield* Effect.all(
            recordsWithSecrets.map((record) =>
              encryptCredentialWithDataKey(record.secret, key).pipe(
                Effect.map(
                  (encryptedBearerToken) =>
                    [
                      record.environmentId,
                      {
                        encryptedBearerToken,
                        encryptedBearerTokenKeyVersion: currentKeyVersion,
                      },
                    ] as const,
                ),
              ),
            ),
          ),
        );

        yield* writeDocument({
          version: document.version,
          safeStorageKeyring: {
            currentVersion: currentKeyVersion,
            keys: [entry],
          },
          records: document.records.map((record) =>
            toSavedEnvironmentStorageRecord(
              toPersistedSavedEnvironmentRecord(record),
              Option.fromNullishOr(secretByEnvironmentId.get(record.environmentId)),
            ),
          ),
        });

        yield* Effect.logInfo("Rotated desktop safe storage credential encryption key.").pipe(
          Effect.annotateLogs({
            rotatedAt,
            previousKeyVersion: previousKeyVersion ?? "legacy",
            currentKeyVersion,
            reencryptedCredentials: recordsWithSecrets.length,
          }),
        );

        return {
          rotatedAt,
          previousKeyVersion,
          currentKeyVersion,
          reencryptedCredentials: recordsWithSecrets.length,
        };
      }).pipe(Effect.withSpan("desktop.savedEnvironments.rotateKeys")),
    });
  }),
);

export const layerTest = (input?: {
  readonly records?: readonly PersistedSavedEnvironmentRecord[];
  readonly secrets?: ReadonlyMap<string, string>;
}) =>
  Layer.effect(
    DesktopSavedEnvironments,
    Effect.gen(function* () {
      const recordsRef = yield* Ref.make(input?.records ?? []);
      const secretsRef = yield* Ref.make(new Map(input?.secrets ?? []));

      return DesktopSavedEnvironments.of({
        getRegistry: Ref.get(recordsRef),
        setRegistry: (records) => Ref.set(recordsRef, records),
        getSecret: (environmentId) =>
          Ref.get(secretsRef).pipe(
            Effect.map((secrets) => Option.fromNullishOr(secrets.get(environmentId))),
          ),
        setSecret: ({ environmentId, secret }) =>
          Ref.get(recordsRef).pipe(
            Effect.flatMap((records) => {
              if (!records.some((record) => record.environmentId === environmentId)) {
                return Effect.succeed(false);
              }
              return Ref.update(secretsRef, (secrets) => {
                const nextSecrets = new Map(secrets);
                nextSecrets.set(environmentId, secret);
                return nextSecrets;
              }).pipe(Effect.as(true));
            }),
          ),
        removeSecret: (environmentId) =>
          Ref.update(secretsRef, (secrets) => {
            const nextSecrets = new Map(secrets);
            nextSecrets.delete(environmentId);
            return nextSecrets;
          }),
        rotateKeys: Effect.gen(function* () {
          const secrets = yield* Ref.get(secretsRef);
          return {
            rotatedAt: yield* currentIsoTimestamp,
            previousKeyVersion: null,
            currentKeyVersion: 1,
            reencryptedCredentials: secrets.size,
          };
        }),
      });
    }),
  );
