import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import * as Ref from "effect/Ref";
import * as Schema from "@effect/schema/Schema";
import * as Option from "effect/Option";
import {
  DynamicConfig,
  DynamicConfigImpl,
  DynamicConfigValidationError,
  DynamicConfigNotFoundError,
  DynamicConfigService,
  DynamicConfigServiceImpl,
  DynamicConfigServiceLayer,
  makeDynamicConfig,
  makeDynamicConfigLayer,
} from "./DynamicConfig";

// Test schema for validation
const TestSchema = Schema.Struct({
  value: Schema.Number,
  name: Schema.String,
});

type TestType = Schema.Schema.To<typeof TestSchema>;

describe("DynamicConfig", () => {
  describe("DynamicConfigImpl", () => {
    it("should get the initial value", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      const value = await Effect.runPromise(config.get);
      expect(value).toBe(42);
    });

    it("should get the value as Option", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      const value = await Effect.runPromise(config.getOption);
      expect(Option.isSome(value)).toBe(true);
      if (Option.isSome(value)) {
        expect(value.value).toBe(42);
      }
    });

    it("should set a new value and return the old one", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      const oldValue = await Effect.runPromise(config.set(100));
      expect(oldValue).toBe(42);
      const newValue = await Effect.runPromise(config.get);
      expect(newValue).toBe(100);
    });

    it("should update the value using a function", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      const oldValue = await Effect.runPromise(config.update((x) => x * 2));
      expect(oldValue).toBe(42);
      const newValue = await Effect.runPromise(config.get);
      expect(newValue).toBe(84);
    });

    it("should update the value using an effectful function", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      const oldValue = await Effect.runPromise(
        config.updateEffect((x) => Effect.succeed(x + 10))
      );
      expect(oldValue).toBe(42);
      const newValue = await Effect.runPromise(config.get);
      expect(newValue).toBe(52);
    });

    it("should reset to initial value", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      await Effect.runPromise(config.set(100));
      const oldValue = await Effect.runPromise(config.reset);
      expect(oldValue).toBe(100);
      const newValue = await Effect.runPromise(config.get);
      expect(newValue).toBe(42);
    });

    it("should check if modified", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );
      let isModified = await Effect.runPromise(config.isModified);
      expect(isModified).toBe(false);

      await Effect.runPromise(config.set(100));
      isModified = await Effect.runPromise(config.isModified);
      expect(isModified).toBe(true);

      await Effect.runPromise(config.reset);
      isModified = await Effect.runPromise(config.isModified);
      expect(isModified).toBe(false);
    });

    it("should notify listeners on change", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make(42)
      );

      const listener = vi.fn();
      await Effect.runPromise(
        config.onChange((oldValue, newValue) => {
          listener(oldValue, newValue);
          return Effect.void;
        })
      );

      await Effect.runPromise(config.set(100));
      expect(listener).toHaveBeenCalledWith(42, 100);
    });

    it("should validate values when schema is provided", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make<TestType>
        ({ value: 42, name: "test" }, { schema: TestSchema })
      );

      // Valid update
      await Effect.runPromise(
        config.set({ value: 100, name: "new test" })
      );
      const newValue = await Effect.runPromise(config.get);
      expect(newValue).toEqual({ value: 100, name: "new test" });
    });

    it("should reject invalid values when schema is provided", async () => {
      const config = await Effect.runPromise(
        DynamicConfigImpl.make<TestType>
        ({ value: 42, name: "test" }, { schema: TestSchema })
      );

      await expect(
        Effect.runPromise(config.set({ value: "invalid", name: "test" }))
      ).rejects.toThrow(DynamicConfigValidationError);
    });
  });

  describe("DynamicConfigService", () => {
    it("should create and retrieve a config", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await Effect.runPromise(
        service.set("test", 42)
      );

      const config = await Effect.runPromise(
        service.get<number>("test")
      );
      const value = await Effect.runPromise(config.get);
      expect(value).toBe(42);
    });

    it("should throw when getting non-existent config", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await expect(
        Effect.runPromise(service.get("non-existent"))
      ).rejects.toThrow(DynamicConfigNotFoundError);
    });

    it("should check if config exists", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      let exists = await Effect.runPromise(service.has("test"));
      expect(exists).toBe(false);

      await Effect.runPromise(service.set("test", 42));
      exists = await Effect.runPromise(service.has("test"));
      expect(exists).toBe(true);
    });

    it("should remove a config", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await Effect.runPromise(service.set("test", 42));
      await Effect.runPromise(service.remove("test"));

      const exists = await Effect.runPromise(service.has("test"));
      expect(exists).toBe(false);
    });

    it("should get all keys", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await Effect.runPromise(service.set("test1", 1));
      await Effect.runPromise(service.set("test2", 2));

      const keys = await Effect.runPromise(service.keys);
      expect(keys).toContain("test1");
      expect(keys).toContain("test2");
    });

    it("should reset all configs", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await Effect.runPromise(service.set("test1", 1));
      await Effect.runPromise(service.set("test2", 2));

      const config1 = await Effect.runPromise(
        service.get<number>("test1")
      );
      const config2 = await Effect.runPromise(
        service.get<number>("test2")
      );

      await Effect.runPromise(config1.set(100));
      await Effect.runPromise(config2.set(200));

      await Effect.runPromise(service.resetAll);

      const value1 = await Effect.runPromise(config1.get);
      const value2 = await Effect.runPromise(config2.get);

      expect(value1).toBe(1);
      expect(value2).toBe(2);
    });

    it("should notify on create", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      const listener = vi.fn();
      await Effect.runPromise(
        service.onCreate((key, config) => {
          listener(key);
          return Effect.void;
        })
      );

      await Effect.runPromise(service.set("test", 42));
      expect(listener).toHaveBeenCalledWith("test");
    });

    it("should notify on remove", async () => {
      const service = await Effect.runPromise(DynamicConfigServiceImpl.make);

      await Effect.runPromise(service.set("test", 42));

      const listener = vi.fn();
      await Effect.runPromise(
        service.onRemove((key) => {
          listener(key);
          return Effect.void;
        })
      );

      await Effect.runPromise(service.remove("test"));
      expect(listener).toHaveBeenCalledWith("test");
    });
  });

  describe("makeDynamicConfig", () => {
    it("should create a config with initial value", async () => {
      const config = await Effect.runPromise(makeDynamicConfig(42));
      const value = await Effect.runPromise(config.get);
      expect(value).toBe(42);
    });

    it("should create a config with schema validation", async () => {
      const config = await Effect.runPromise(
        makeDynamicConfig<TestType>({ value: 42, name: "test" }, {
          schema: TestSchema,
        })
      );

      const value = await Effect.runPromise(config.get);
      expect(value).toEqual({ value: 42, name: "test" });
    });
  });

  describe("Layer integration", () => {
    it("should work with DynamicConfigServiceLayer", async () => {
      const program = Effect.gen(function* () {
        const service = yield* DynamicConfigService;
        yield* service.set("test", 42);
        const config = yield* service.get<number>("test");
        return yield* config.get;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(DynamicConfigServiceLayer))
      );
      expect(result).toBe(42);
    });

    it("should work with makeDynamicConfigLayer", async () => {
      const TestLayer = makeDynamicConfigLayer("test", 42);

      const program = Effect.gen(function* () {
        const config = yield* DynamicConfig<number>;
        return yield* config.get;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(TestLayer))
      );
      expect(result).toBe(42);
    });
  });
});
