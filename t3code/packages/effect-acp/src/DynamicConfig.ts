import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "@effect/schema/Schema";
import * as ParseResult from "@effect/schema/ParseResult";
import * as Equivalence from "effect/Equivalence";

/**
 * A type representing a dynamic configuration value that can be updated at runtime.
 */
export interface DynamicConfig<A> {
  /**
   * Get the current value of the configuration.
   */
  readonly get: Effect.Effect<A>;

  /**
   * Get the current value as an Option.
   */
  readonly getOption: Effect.Effect<Option.Option<A>>;

  /**
   * Set a new value for the configuration.
   * Returns the old value.
   */
  readonly set: (value: A) => Effect.Effect<A>;

  /**
   * Update the configuration using a function.
   * Returns the old value.
   */
  readonly update: (f: (current: A) => A) => Effect.Effect<A>;

  /**
   * Update the configuration using an effectful function.
   * Returns the old value.
   */
  readonly updateEffect: <R, E>(
    f: (current: A) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E, R>;

  /**
   * Reset the configuration to its initial value.
   * Returns the old value.
   */
  readonly reset: Effect.Effect<A>;

  /**
   * Check if the configuration has been modified from its initial value.
   */
  readonly isModified: Effect.Effect<boolean>;

  /**
   * Subscribe to changes in the configuration.
   * Returns an effect that will be executed whenever the value changes.
   */
  readonly onChange: (
    callback: (oldValue: A, newValue: A) => Effect.Effect<void, never, never>
  ) => Effect.Effect<void>;

  /**
   * Get the initial value of the configuration.
   */
  readonly initialValue: A;
}

/**
 * A class implementing DynamicConfig with validation and change tracking.
 */
export class DynamicConfigImpl<A> implements DynamicConfig<A> {
  private readonly ref: Ref.Ref<A>;
  private readonly initialValue: A;
  private readonly schema: Option.Option<Schema.Schema<A, any, never>>;
  private readonly listeners: Ref.Ref<ReadonlyArray<(
    oldValue: A,
    newValue: A
  ) => Effect.Effect<void, never, never>>>;

  private constructor(
    ref: Ref.Ref<A>,
    initialValue: A,
    schema: Option.Option<Schema.Schema<A, any, never>>,
    listeners: Ref.Ref<ReadonlyArray<(
      oldValue: A,
      newValue: A
    ) => Effect.Effect<void, never, never>>>
  ) {
    this.ref = ref;
    this.initialValue = initialValue;
    this.schema = schema;
    this.listeners = listeners;
  }

  get: Effect.Effect<A> = Effect.flatMap(
    Effect.service(DynamicConfigService),
    () => Ref.get(this.ref)
  );

  getOption: Effect.Effect<Option.Option<A>> = Effect.map(
    Ref.get(this.ref),
    Option.some
  );

  set(value: A): Effect.Effect<A> = Effect.gen(function* () {
    // Validate if schema is present
    if (Option.isSome(this.schema)) {
      const parseResult = yield* Schema.parseEither(this.schema.value, value);
      if (Effect.isFailure(parseResult)) {
        throw new DynamicConfigValidationError({
          message: `Validation failed: ${ParseResult.getError(parseResult)}`,
        });
      }
    }

    const oldValue = yield* Ref.get(this.ref);
    yield* Ref.set(this.ref, value);

    // Notify listeners
    const listeners = yield* Ref.get(this.listeners);
    for (const listener of listeners) {
      yield* listener(oldValue, value);
    }

    return oldValue;
  });

  update(f: (current: A) => A): Effect.Effect<A> = Effect.gen(function* () {
    const oldValue = yield* Ref.get(this.ref);
    const newValue = f(oldValue);
    yield* Ref.set(this.ref, newValue);

    // Notify listeners
    const listeners = yield* Ref.get(this.listeners);
    for (const listener of listeners) {
      yield* listener(oldValue, newValue);
    }

    return oldValue;
  });

  updateEffect<R, E>(
    f: (current: A) => Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> = Effect.gen(function* () {
    const oldValue = yield* Ref.get(this.ref);
    const newValue = yield* f(oldValue);
    yield* Ref.set(this.ref, newValue);

    // Notify listeners
    const listeners = yield* Ref.get(this.listeners);
    for (const listener of listeners) {
      yield* listener(oldValue, newValue);
    }

    return oldValue;
  });

  reset: Effect.Effect<A> = Effect.gen(function* () {
    const oldValue = yield* Ref.get(this.ref);
    yield* Ref.set(this.ref, this.initialValue);

    // Notify listeners
    const listeners = yield* Ref.get(this.listeners);
    for (const listener of listeners) {
      yield* listener(oldValue, this.initialValue);
    }

    return oldValue;
  });

  isModified: Effect.Effect<boolean> = Effect.gen(function* () {
    const currentValue = yield* Ref.get(this.ref);
    return currentValue !== this.initialValue;
  });

  onChange(
    callback: (oldValue: A, newValue: A) => Effect.Effect<void, never, never>
  ): Effect.Effect<void> = Effect.gen(function* () {
    const currentListeners = yield* Ref.get(this.listeners);
    yield* Ref.set(
      this.listeners,
      [...currentListeners, callback] as const
    );
  });

  readonly initialValue: A;

  /**
   * Static method to create a new DynamicConfig.
   */
  static make<A>(
    initialValue: A,
    options?: {
      readonly schema?: Schema.Schema<A, any, never>;
    }
  ): Effect.Effect<DynamicConfig<A>> {
    return Effect.gen(function* () {
      const ref = yield* Ref.make(initialValue);
      const listeners = yield* Ref.make<ReadonlyArray<(
        oldValue: A,
        newValue: A
      ) => Effect.Effect<void, never, never>>>([]);

      return new DynamicConfigImpl(
        ref,
        initialValue,
        Option.fromNullable(options?.schema),
        listeners
      );
    });
  }
}

/**
 * Error thrown when configuration validation fails.
 */
export class DynamicConfigValidationError extends Error {
  readonly _tag = "DynamicConfigValidationError";

  constructor(readonly error: { readonly message: string }) {
    super(error.message);
    this.name = "DynamicConfigValidationError";
  }
}

/**
 * Error thrown when trying to access a non-existent configuration.
 */
export class DynamicConfigNotFoundError extends Error {
  readonly _tag = "DynamicConfigNotFoundError";

  constructor(readonly key: string) {
    super(`Dynamic configuration with key '${key}' not found`);
    this.name = "DynamicConfigNotFoundError";
  }
}

/**
 * A service for managing multiple dynamic configurations.
 */
export class DynamicConfigService extends Context.Tag(
  "t3/effect-acp/DynamicConfigService"
)<DynamicConfigService, {
  /**
   * Get a configuration by key.
   */
  readonly get: <A>(key: string) => Effect.Effect<DynamicConfig<A>>;

  /**
   * Create or update a configuration.
   */
  readonly set: <A>(
    key: string,
    initialValue: A,
    options?: { readonly schema?: Schema.Schema<A, any, never> }
  ) => Effect.Effect<DynamicConfig<A>>;

  /**
   * Remove a configuration.
   */
  readonly remove: (key: string) => Effect.Effect<void>;

  /**
   * Check if a configuration exists.
   */
  readonly has: (key: string) => Effect.Effect<boolean>;

  /**
   * Get all configuration keys.
   */
  readonly keys: Effect.Effect<ReadonlyArray<string>>;

  /**
   * Reset all configurations to their initial values.
   */
  readonly resetAll: Effect.Effect<void>;

  /**
   * Subscribe to creation of new configurations.
   */
  readonly onCreate: (
    callback: (key: string, config: DynamicConfig<any>) => Effect.Effect<void>
  ) => Effect.Effect<void>;

  /**
   * Subscribe to removal of configurations.
   */
  readonly onRemove: (
    callback: (key: string) => Effect.Effect<void>
  ) => Effect.Effect<void>;
}> {}

/**
 * Implementation of DynamicConfigService.
 */
export class DynamicConfigServiceImpl implements DynamicConfigService.Prototype {
  private readonly configs: Ref.Ref<Map<string, DynamicConfig<any>>>;
  private readonly createListeners: Ref.Ref<
    ReadonlyArray<(key: string, config: DynamicConfig<any>) => Effect.Effect<void>>
  >;
  private readonly removeListeners: Ref.Ref<
    ReadonlyArray<(key: string) => Effect.Effect<void>>
  >;

  constructor(
    configs: Ref.Ref<Map<string, DynamicConfig<any>>>,
    createListeners: Ref.Ref<
      ReadonlyArray<(key: string, config: DynamicConfig<any>) => Effect.Effect<void>>
    >,
    removeListeners: Ref.Ref<
      ReadonlyArray<(key: string) => Effect.Effect<void>>
    >
  ) {
    this.configs = configs;
    this.createListeners = createListeners;
    this.removeListeners = removeListeners;
  }

  get<A>(key: string): Effect.Effect<DynamicConfig<A>> = Effect.gen(function* () {
    const configs = yield* Ref.get(this.configs);
    const config = configs.get(key);
    if (!config) {
      throw new DynamicConfigNotFoundError(key);
    }
    return config as DynamicConfig<A>;
  });

  set<A>(
    key: string,
    initialValue: A,
    options?: { readonly schema?: Schema.Schema<A, any, never> }
  ): Effect.Effect<DynamicConfig<A>> = Effect.gen(function* () {
    const configs = yield* Ref.get(this.configs);
    const existingConfig = configs.get(key);

    const config = yield* DynamicConfigImpl.make(initialValue, options);

    // Store the config
    configs.set(key, config as DynamicConfig<any>);

    // Notify create listeners if this is a new config
    if (!existingConfig) {
      const listeners = yield* Ref.get(this.createListeners);
      for (const listener of listeners) {
        yield* listener(key, config as DynamicConfig<any>);
      }
    }

    return config as DynamicConfig<A>;
  });

  remove(key: string): Effect.Effect<void> = Effect.gen(function* () {
    const configs = yield* Ref.get(this.configs);
    const existingConfig = configs.get(key);

    if (existingConfig) {
      configs.delete(key);

      // Notify remove listeners
      const listeners = yield* Ref.get(this.removeListeners);
      for (const listener of listeners) {
        yield* listener(key);
      }
    }
  });

  has(key: string): Effect.Effect<boolean> = Effect.map(
    Ref.get(this.configs),
    (configs) => configs.has(key)
  );

  keys: Effect.Effect<ReadonlyArray<string>> = Effect.map(
    Ref.get(this.configs),
    (configs) => Array.from(configs.keys())
  );

  resetAll: Effect.Effect<void> = Effect.gen(function* () {
    const configs = yield* Ref.get(this.configs);
    for (const [, config] of configs) {
      yield* config.reset;
    }
  });

  onCreate(
    callback: (key: string, config: DynamicConfig<any>) => Effect.Effect<void>
  ): Effect.Effect<void> = Effect.gen(function* () {
    const currentListeners = yield* Ref.get(this.createListeners);
    yield* Ref.set(
      this.createListeners,
      [...currentListeners, callback] as const
    );
  });

  onRemove(
    callback: (key: string) => Effect.Effect<void>
  ): Effect.Effect<void> = Effect.gen(function* () {
    const currentListeners = yield* Ref.get(this.removeListeners);
    yield* Ref.set(
      this.removeListeners,
      [...currentListeners, callback] as const
    );
  });

  static make: Effect.Effect<DynamicConfigService> = Effect.gen(function* () {
    const configs = yield* Ref.make<Map<string, DynamicConfig<any>>>(new Map());
    const createListeners = yield* Ref.make<ReadonlyArray<(
      key: string,
      config: DynamicConfig<any>
    ) => Effect.Effect<void>>>([]);
    const removeListeners = yield* Ref.make<ReadonlyArray<(
      key: string
    ) => Effect.Effect<void>>>([]);

    return new DynamicConfigServiceImpl(
      configs,
      createListeners,
      removeListeners
    );
  });
}

/**
 * Layer for DynamicConfigService.
 */
export const DynamicConfigServiceLayer = Layer.effect(
  DynamicConfigService,
  DynamicConfigServiceImpl.make
);

/**
 * Layer that provides both DynamicConfigService and DynamicConfig.
 */
export const DynamicConfigLayer = Layer.provideMerge(
  DynamicConfigServiceLayer,
  Layer.effect(DynamicConfigService)
);

/**
 * A layer that provides a specific dynamic configuration.
 */
export function makeDynamicConfigLayer<A>(
  key: string,
  initialValue: A,
  options?: { readonly schema?: Schema.Schema<A, any, never> }
): Layer.Layer<DynamicConfig<A>> {
  return Layer.effect(
    DynamicConfig<A>,
    Effect.gen(function* () {
      const service = yield* DynamicConfigService;
      return yield* service.set(key, initialValue, options);
    })
  );
}

/**
 * Utility to create a typed dynamic configuration.
 */
export function makeDynamicConfig<A>(
  initialValue: A,
  options?: { readonly schema?: Schema.Schema<A, any, never> }
): Effect.Effect<DynamicConfig<A>> {
  return DynamicConfigImpl.make(initialValue, options);
}
