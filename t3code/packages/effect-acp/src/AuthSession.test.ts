import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  AuthSession,
  AuthSessionManager,
  AuthSessionManagerImpl,
  AuthSessionConfig,
  DefaultAuthSessionConfig,
  MemorySessionStorage,
  AuthSessionError,
  CurrentSession,
  AuthSessionManagerLayer,
  MemorySessionStorageLayer,
  createSessionToken,
  parseSessionToken,
  withSession,
  requireSession,
} from "./AuthSession";

describe("AuthSession", () => {
  describe("MemorySessionStorage", () => {
    let storage: MemorySessionStorage;

    beforeEach(async () => {
      storage = await Effect.runPromise(MemorySessionStorage.make);
    });

    it("should store and retrieve a session", async () => {
      const session: AuthSession = {
        id: "test-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(session));
      const retrieved = await Effect.runPromise(storage.get("test-id"));

      expect(Option.isSome(retrieved)).toBe(true);
      if (Option.isSome(retrieved)) {
        expect(retrieved.value.id).toBe("test-id");
        expect(retrieved.value.userId).toBe("user-1");
      }
    });

    it("should return none for non-existent session", async () => {
      const retrieved = await Effect.runPromise(storage.get("non-existent"));
      expect(Option.isNone(retrieved)).toBe(true);
    });

    it("should remove a session", async () => {
      const session: AuthSession = {
        id: "test-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(session));
      await Effect.runPromise(storage.remove("test-id"));
      const retrieved = await Effect.runPromise(storage.get("test-id"));
      expect(Option.isNone(retrieved)).toBe(true);
    });

    it("should get sessions by user ID", async () => {
      const session1: AuthSession = {
        id: "test-id-1",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };
      const session2: AuthSession = {
        id: "test-id-2",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };
      const session3: AuthSession = {
        id: "test-id-3",
        userId: "user-2",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(session1));
      await Effect.runPromise(storage.set(session2));
      await Effect.runPromise(storage.set(session3));

      const user1Sessions = await Effect.runPromise(
        storage.getByUserId("user-1")
      );
      expect(user1Sessions).toHaveLength(2);
      expect(user1Sessions.map((s) => s.id)).toContain("test-id-1");
      expect(user1Sessions.map((s) => s.id)).toContain("test-id-2");
    });

    it("should remove sessions by user ID", async () => {
      const session1: AuthSession = {
        id: "test-id-1",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };
      const session2: AuthSession = {
        id: "test-id-2",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(session1));
      await Effect.runPromise(storage.set(session2));

      await Effect.runPromise(storage.removeByUserId("user-1"));

      const user1Sessions = await Effect.runPromise(
        storage.getByUserId("user-1")
      );
      expect(user1Sessions).toHaveLength(0);
    });

    it("should remove expired sessions", async () => {
      const expiredSession: AuthSession = {
        id: "expired-id",
        userId: "user-1",
        expiresAt: Date.now() - 1000, // Already expired
        createdAt: Date.now() - 2000,
      };
      const validSession: AuthSession = {
        id: "valid-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(expiredSession));
      await Effect.runPromise(storage.set(validSession));

      await Effect.runPromise(storage.removeExpired);

      const expiredRetrieved = await Effect.runPromise(
        storage.get("expired-id")
      );
      const validRetrieved = await Effect.runPromise(
        storage.get("valid-id")
      );

      expect(Option.isNone(expiredRetrieved)).toBe(true);
      expect(Option.isSome(validRetrieved)).toBe(true);
    });

    it("should get all sessions", async () => {
      const session1: AuthSession = {
        id: "test-id-1",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };
      const session2: AuthSession = {
        id: "test-id-2",
        userId: "user-2",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      await Effect.runPromise(storage.set(session1));
      await Effect.runPromise(storage.set(session2));

      const allSessions = await Effect.runPromise(storage.getAll);
      expect(allSessions).toHaveLength(2);
    });
  });

  describe("AuthSessionManager", () => {
    let manager: AuthSessionManager;

    beforeEach(async () => {
      manager = await Effect.runPromise(AuthSessionManagerImpl.make());
    });

    it("should create a session", async () => {
      const session = await Effect.runPromise(
        manager.create("user-1")
      );

      expect(session.id).toBeTruthy();
      expect(session.userId).toBe("user-1");
      expect(session.expiresAt).toBeGreaterThan(Date.now());
      expect(session.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should create a session with custom expiration", async () => {
      const session = await Effect.runPromise(
        manager.create("user-1", { expiresIn: 60000 })
      );

      expect(session.expiresAt - Date.now()).toBeLessThanOrEqual(60000);
    });

    it("should create a session with metadata", async () => {
      const metadata = { ip: "192.168.1.1", userAgent: "test" };
      const session = await Effect.runPromise(
        manager.create("user-1", { metadata })
      );

      expect(session.metadata).toEqual(metadata);
    });

    it("should get a session by ID", async () => {
      const created = await Effect.runPromise(
        manager.create("user-1")
      );

      const retrieved = await Effect.runPromise(
        manager.get(created.id)
      );

      expect(Option.isSome(retrieved)).toBe(true);
      if (Option.isSome(retrieved)) {
        expect(retrieved.value.id).toBe(created.id);
      }
    });

    it("should validate a valid session", async () => {
      const created = await Effect.runPromise(
        manager.create("user-1")
      );

      const validated = await Effect.runPromise(
        manager.validate(created.id)
      );

      expect(Option.isSome(validated)).toBe(true);
    });

    it("should not validate an expired session", async () => {
      const storage = await Effect.runPromise(MemorySessionStorage.make);
      const expiredSession: AuthSession = {
        id: "expired-id",
        userId: "user-1",
        expiresAt: Date.now() - 1000,
        createdAt: Date.now() - 2000,
      };

      await Effect.runPromise(storage.set(expiredSession));

      const customManager = await Effect.runPromise(
        AuthSessionManagerImpl.make(undefined, storage)
      );

      const validated = await Effect.runPromise(
        customManager.validate("expired-id")
      );

      expect(Option.isNone(validated)).toBe(true);
    });

    it("should refresh a session", async () => {
      const created = await Effect.runPromise(
        manager.create("user-1")
      );

      const originalExpiresAt = created.expiresAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const refreshed = await Effect.runPromise(
        manager.refresh(created.id, 120000)
      );

      expect(Option.isSome(refreshed)).toBe(true);
      if (Option.isSome(refreshed)) {
        expect(refreshed.value.expiresAt).toBeGreaterThan(originalExpiresAt);
      }
    });

    it("should invalidate a session", async () => {
      const created = await Effect.runPromise(
        manager.create("user-1")
      );

      await Effect.runPromise(manager.invalidate(created.id));

      const retrieved = await Effect.runPromise(
        manager.get(created.id)
      );
      expect(Option.isNone(retrieved)).toBe(true);
    });

    it("should invalidate all sessions for a user", async () => {
      await Effect.runPromise(manager.create("user-1"));
      await Effect.runPromise(manager.create("user-1"));

      await Effect.runPromise(manager.invalidateUser("user-1"));

      const sessions = await Effect.runPromise(
        manager.getUserSessions("user-1")
      );
      expect(sessions).toHaveLength(0);
    });

    it("should invalidate all sessions except one", async () => {
      const session1 = await Effect.runPromise(
        manager.create("user-1")
      );
      const session2 = await Effect.runPromise(
        manager.create("user-1")
      );

      await Effect.runPromise(
        manager.invalidateOthers("user-1", session1.id)
      );

      const sessions = await Effect.runPromise(
        manager.getUserSessions("user-1")
      );
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session1.id);
    });

    it("should enforce max sessions per user", async () => {
      const config: Partial<AuthSessionConfig> = {
        maxSessionsPerUser: 2,
      };
      const limitedManager = await Effect.runPromise(
        AuthSessionManagerImpl.make(config)
      );

      const session1 = await Effect.runPromise(
        limitedManager.create("user-1")
      );
      const session2 = await Effect.runPromise(
        limitedManager.create("user-1")
      );
      const session3 = await Effect.runPromise(
        limitedManager.create("user-1")
      );

      const sessions = await Effect.runPromise(
        limitedManager.getUserSessions("user-1")
      );

      // Should only have 2 sessions (max)
      expect(sessions).toHaveLength(2);
      // The oldest session should have been removed
      expect(sessions.map((s) => s.id)).not.toContain(session1.id);
    });

    it("should generate unique session IDs", async () => {
      const id1 = await Effect.runPromise(manager.generateId);
      const id2 = await Effect.runPromise(manager.generateId);

      expect(id1).not.toBe(id2);
      expect(id1.startsWith("sess_")).toBe(true);
      expect(id2.startsWith("sess_")).toBe(true);
    });

    it("should set and get current session", async () => {
      const session: AuthSession = {
        id: "current-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      const program = Effect.gen(function* () {
        const manager = yield* AuthSessionManager;
        yield* manager.setCurrent(session);
        const current = yield* manager.getCurrent();
        return current;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(AuthSessionManagerLayer))
      );

      expect(Option.isSome(result)).toBe(true);
      if (Option.isSome(result)) {
        expect(result.value.id).toBe("current-id");
      }
    });

    it("should clear current session", async () => {
      const session: AuthSession = {
        id: "current-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      const program = Effect.gen(function* () {
        const manager = yield* AuthSessionManager;
        yield* manager.setCurrent(session);
        yield* manager.clearCurrent();
        return yield* manager.getCurrent();
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(AuthSessionManagerLayer))
      );

      expect(Option.isNone(result)).toBe(true);
    });
  });

  describe("Session Token", () => {
    it("should create a session token", async () => {
      const session: AuthSession = {
        id: "test-id",
        userId: "user-1",
        expiresAt: Date.now() + 10000,
        createdAt: Date.now(),
      };

      const token = await Effect.runPromise(
        createSessionToken(session, "secret")
      );

      expect(token).toBeTruthy();
      expect(token.split(".")).toHaveLength(3);
    });

    it("should parse a valid session token", async () => {
      const session: AuthSession = {
        id: "test-id",
        userId: "user-1",
        expiresAt: Math.floor(Date.now() / 1000) + 100,
        createdAt: Date.now(),
      };

      const token = await Effect.runPromise(
        createSessionToken(session, "secret")
      );

      const parsed = await Effect.runPromise(parseSessionToken(token));

      expect(Option.isSome(parsed)).toBe(true);
      if (Option.isSome(parsed)) {
        expect(parsed.value.id).toBe("test-id");
        expect(parsed.value.userId).toBe("user-1");
      }
    });

    it("should return none for invalid token", async () => {
      const parsed = await Effect.runPromise(
        parseSessionToken("invalid.token")
      );
      expect(Option.isNone(parsed)).toBe(true);
    });
  });

  describe("Middleware", () => {
    it("should work with withSession middleware", async () => {
      const mockRequest = { headers: { authorization: "Bearer token" } };

      const extractSession = vi.fn().mockResolvedValue(
        Option.some({
          id: "test-id",
          userId: "user-1",
          expiresAt: Date.now() + 10000,
          createdAt: Date.now(),
        })
      );

      const handler = Effect.succeed("success");
      const wrapped = withSession(extractSession as any)(handler);

      const result = await Effect.runPromise(
        wrapped(mockRequest)
      );

      expect(result).toBe("success");
      expect(extractSession).toHaveBeenCalled();
    });

    it("should work with requireSession middleware", async () => {
      const mockRequest = { headers: { authorization: "Bearer token" } };

      const extractSession = vi.fn().mockResolvedValue(
        Option.some({
          id: "test-id",
          userId: "user-1",
          expiresAt: Date.now() + 10000,
          createdAt: Date.now(),
        })
      );

      const handler = Effect.succeed("success");
      const wrapped = requireSession(extractSession as any)(handler);

      const result = await Effect.runPromise(
        wrapped(mockRequest)
      );

      expect(result).toBe("success");
    });

    it("should reject with requireSession middleware when no session", async () => {
      const mockRequest = { headers: {} };

      const extractSession = vi.fn().mockResolvedValue(Option.none());

      const handler = Effect.succeed("success");
      const wrapped = requireSession(extractSession as any)(handler);

      await expect(
        Effect.runPromise(wrapped(mockRequest))
      ).rejects.toThrow(AuthSessionError);
    });
  });

  describe("Layer Integration", () => {
    it("should work with AuthSessionManagerLayer", async () => {
      const program = Effect.gen(function* () {
        const manager = yield* AuthSessionManager;
        const session = yield* manager.create("user-1");
        return session.userId;
      });

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(AuthSessionManagerLayer))
      );

      expect(result).toBe("user-1");
    });

    it("should work with custom configuration", async () => {
      const config: Partial<AuthSessionConfig> = {
        defaultExpiresIn: 3600000, // 1 hour
        sessionIdPrefix: "custom_",
      };

      const program = Effect.gen(function* () {
        const manager = yield* AuthSessionManager;
        const session = yield* manager.create("user-1");
        return session.id;
      });

      const customLayer = Layer.effect(
        AuthSessionManager,
        AuthSessionManagerImpl.make(config)
      );

      const result = await Effect.runPromise(
        program.pipe(Effect.provide(customLayer))
      );

      expect(result.startsWith("custom_")).toBe(true);
    });
  });
});
