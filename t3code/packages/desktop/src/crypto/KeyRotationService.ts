import { Effect, Schema, Ref, Layer } from "effect";

export const KeyVersion = Schema.Struct({
  version: Schema.Number,
  keyId: Schema.String,
  createdAt: Schema.String,
  isActive: Schema.Boolean,
  rotatedAt: Schema.String.pipe(Schema.optional),
});

export type KeyVersionType = Schema.Schema.Type<typeof KeyVersion>;

export const KeyRotationConfig = Schema.Struct({
  maxKeyVersions: Schema.Number,
  rotationIntervalDays: Schema.Number,
  gracePeriodDays: Schema.Number,
});

export type KeyRotationConfigType = Schema.Schema.Type<typeof KeyRotationConfig>;

export const DefaultKeyRotationConfig: KeyRotationConfigType = {
  maxKeyVersions: 3,
  rotationIntervalDays: 90,
  gracePeriodDays: 7,
};

export const KeyRotationService = Effect.gen(function* (_) {
  const keys = yield* _(Ref.make<KeyVersionType[]>([]));
  const config = yield* _(Ref.make(DefaultKeyRotationConfig));

  const generateKeyId = (): string => `key-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const addKey = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(config));
    const newKey: KeyVersionType = {
      version: Date.now(),
      keyId: generateKeyId(),
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    yield* _(Ref.update(keys, (k) => {
      // Deactivate old keys
      const updated = k.map((key) => ({ ...key, isActive: false }));
      const all = [...updated, newKey];

      // Keep only maxKeyVersions
      if (all.length > c.maxKeyVersions) {
        // Keep the newest ones, but respect grace period
        const gracePeriodStart = new Date(
          Date.now() - c.gracePeriodDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const withinGrace = all.filter(
          (k) => k.rotatedAt && k.rotatedAt > gracePeriodStart
        );
        const outsideGrace = all.filter(
          (k) => !k.rotatedAt || k.rotatedAt <= gracePeriodStart
        );

        // Remove oldest outside grace period first
        const toRemove = Math.max(0, all.length - c.maxKeyVersions);
        const trimmed = [...outsideGrace.slice(toRemove), ...withinGrace, newKey];

        // Deduplicate and sort
        const unique = new Map(trimmed.map((k) => [k.keyId, k]));
        return [...unique.values()].sort((a, b) => b.version - a.version)
          .slice(0, c.maxKeyVersions);
      }

      return all;
    }));

    return newKey;
  });

  const rotateKey = Effect.gen(function* (_) {
    const currentKeys = yield* _(Ref.get(keys));
    const activeKey = currentKeys.find((k) => k.isActive);

    if (activeKey) {
      yield* _(Ref.update(keys, (k) =>
        k.map((key) =>
          key.keyId === activeKey.keyId
            ? { ...key, isActive: false, rotatedAt: new Date().toISOString() }
            : key
        )
      ));
    }

    return yield* _(addKey);
  });

  const getActiveKey = Effect.gen(function* (_) {
    const k = yield* _(Ref.get(keys));
    return k.find((key) => key.isActive) || null;
  });

  const getKeyHistory = Effect.gen(function* (_) {
    const k = yield* _(Ref.get(keys));
    return k.sort((a, b) => b.version - a.version);
  });

  const shouldRotate = Effect.gen(function* (_) {
    const c = yield* _(Ref.get(config));
    const k = yield* _(Ref.get(keys));
    const active = k.find((key) => key.isActive);

    if (!active) return true;

    const age = Date.now() - new Date(active.createdAt).getTime();
    return age > c.rotationIntervalDays * 24 * 60 * 60 * 1000;
  });

  return { addKey, rotateKey, getActiveKey, getKeyHistory, shouldRotate };
});

export const KeyRotationServiceLayer = Layer.effect(KeyRotationService, KeyRotationService);
