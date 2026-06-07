import { EnvironmentId, type PersistedSavedEnvironmentRecord } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
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

import * as DesktopObservability from "../app/DesktopObservability.ts";
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
  readonly encryptedBearerTokenKeyVersion?: string;
}

interface SavedEnvironmentRegistryDocument {
  readonly version: number;
  readonly currentKeyVersion: string;
  readonly records: readonly PersistedSavedEnvironmentStorageRecord[];
}

interface SavedEnvironmentRegistryStorageDocument {
  readonly version?: number;
  readonly currentKeyVersion?: string;
  readonly records?: readonly PersistedSavedEnvironmentStorageRecord[];
}

export interface DesktopSavedEnvironmentKeyRotationResult {
  readonly previousKeyVersion: string;
  readonly currentKeyVersion: string;
  readonly reencryptedSecrets: number;
  readonly rotatedAt: string;
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
  encryptedBearerTokenKeyVersion: Schema.optionalKey(Schema.String),
});

const SavedEnvironmentRegistryDocumentSchema = Schema.Struct({
  version: Schema.optionalKey(Schema.Number),
  currentKeyVersion: Schema.optionalKey(Schema.String),
  records: Schema.optionalKey(Schema.Array(PersistedSavedEnvironmentStorageRecordSchema)),
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

export type DesktopSavedEnvironmentsGetSecretError =
  | DesktopSavedEnvironmentSecretDecodeError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageDecryptError;

export type DesktopSavedEnvironmentsSetSecretError =
  | DesktopSavedEnvironmentsWriteError
  | ElectronSafeStorage.ElectronSafeStorageAvailabilityError
  | ElectronSafeStorage.ElectronSafeStorageEncryptError;

export type DesktopSavedEnvironmentsRotateKeysError =
  | DesktopSavedEnvironmentsWriteError
  | DesktopSavedEnvironmentSecretDecodeError
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
    DesktopSavedEnvironmentKeyRotationResult,
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
  encryptedBearerToken: Option.Option<string>,
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
        encryptedBearerToken: value,
      }),
    });
  }
  return Option.match(encryptedBearerToken, {
    onNone: () => nextRecord,
    onSome: (value) => ({ ...nextRecord, encryptedBearerToken: value }),
  });
}

function normalizeSavedEnvironmentRegistryDocument(
  document: SavedEnvironmentRegistryStorageDocument,
): SavedEnvironmentRegistryDocument {
  return {
    version: document.version ?? 1,
    currentKeyVersion: document.currentKeyVersion ?? "safe-storage-v1",
    records: document.records ?? [],
  };
}

function readRegistryDocument(
  fileSystem: FileSystem.FileSystem,
  registryPath: string,
): Effect.Effect<SavedEnvironmentRegistryDocument> {
  const emptyDocument: SavedEnvironmentRegistryDocument = {
    version: 1,
    currentKeyVersion: "safe-storage-v1",
    records: [],
  };
  return fileSystem.readFileString(registryPath).pipe(
    Effect.option,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.succeed(emptyDocument),
        onSome: (raw) =>
          decodeSavedEnvironmentRegistryDocumentJson(raw).pipe(
            Effect.map(normalizeSavedEnvironmentRegistryDocument),
            Effect.catch(() => Effect.succeed(emptyDocument)),
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
  const encryptedBearerTokenById = new Map<
    string,
    { readonly token: string; readonly keyVersion: string }
  >(
    currentDocument.records.flatMap((record) =>
      record.encryptedBearerToken
        ? [
            [
              record.environmentId,
              {
                token: record.encryptedBearerToken,
                keyVersion:
                  record.encryptedBearerTokenKeyVersion ?? currentDocument.currentKeyVersion,
              },
            ] as const,
          ]
        : [],
    ),
  );

  return {
    version: currentDocument.version,
    currentKeyVersion: currentDocument.currentKeyVersion,
    records: records.map((record) => {
      const existing = encryptedBearerTokenById.get(record.environmentId);
      const nextRecord = toSavedEnvironmentStorageRecord(
        record,
        Option.fromNullishOr(existing?.token),
      );
      return existing
        ? { ...nextRecord, encryptedBearerTokenKeyVersion: existing.keyVersion }
        : nextRecord;
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

export const layer = Layer.effect(
  DesktopSavedEnvironments,
  Effect.gen(function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const safeStorage = yield* ElectronSafeStorage.ElectronSafeStorage;
    const { logInfo } = DesktopObservability.makeComponentLogger("desktop-saved-environments");

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
        const encoded = Option.fromNullishOr(
          document.records.find((record) => record.environmentId === environmentId)
            ?.encryptedBearerToken,
        );
        if (Option.isNone(encoded) || !(yield* safeStorage.isEncryptionAvailable)) {
          return Option.none<string>();
        }

        const secretBytes = yield* decodeSecretBytes(encoded.value);
        return Option.some(yield* safeStorage.decryptString(secretBytes));
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

        const encryptedBearerToken = Encoding.encodeBase64(
          yield* safeStorage.encryptString(secret),
        );
        let found = false;
        const nextDocument: SavedEnvironmentRegistryDocument = {
          version: document.version,
          currentKeyVersion: document.currentKeyVersion,
          records: document.records.map((record) => {
            if (record.environmentId !== environmentId) {
              return record;
            }

            found = true;
            return {
              ...toSavedEnvironmentStorageRecord(record, Option.some(encryptedBearerToken)),
              encryptedBearerTokenKeyVersion: document.currentKeyVersion,
            };
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
          currentKeyVersion: document.currentKeyVersion,
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
          return yield* new ElectronSafeStorage.ElectronSafeStorageAvailabilityError({
            cause: new Error("Encryption is unavailable."),
          });
        }

        const document = yield* readRegistryDocument(
          fileSystem,
          environment.savedEnvironmentRegistryPath,
        );
        const nextKeyVersion = yield* safeStorage.generateEncryptionKeyVersion;
        const rotatedAt = new Date().toISOString();
        let reencryptedSecrets = 0;
        const nextRecords: PersistedSavedEnvironmentStorageRecord[] = [];

        for (const record of document.records) {
          if (!record.encryptedBearerToken) {
            nextRecords.push(record);
            continue;
          }

          const secretBytes = yield* decodeSecretBytes(record.encryptedBearerToken);
          const secret = yield* safeStorage.decryptString(secretBytes);
          const encryptedBearerToken = Encoding.encodeBase64(
            yield* safeStorage.encryptString(secret),
          );
          nextRecords.push({
            ...record,
            encryptedBearerToken,
            encryptedBearerTokenKeyVersion: nextKeyVersion,
          });
          reencryptedSecrets += 1;
        }

        yield* writeDocument({
          version: document.version,
          currentKeyVersion: nextKeyVersion,
          records: nextRecords,
        });
        yield* logInfo("desktop saved environment key rotation completed", {
          rotatedAt,
          previousKeyVersion: document.currentKeyVersion,
          currentKeyVersion: nextKeyVersion,
          reencryptedSecrets,
        });
        return {
          previousKeyVersion: document.currentKeyVersion,
          currentKeyVersion: nextKeyVersion,
          reencryptedSecrets,
          rotatedAt,
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
      const keyVersionRef = yield* Ref.make("test-key-v1");

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
          const previousKeyVersion = yield* Ref.get(keyVersionRef);
          const currentKeyVersion = "test-key-v2";
          yield* Ref.set(keyVersionRef, currentKeyVersion);
          const secrets = yield* Ref.get(secretsRef);
          return {
            previousKeyVersion,
            currentKeyVersion,
            reencryptedSecrets: secrets.size,
            rotatedAt: new Date().toISOString(),
          };
        }),
      });
    }),
  );
