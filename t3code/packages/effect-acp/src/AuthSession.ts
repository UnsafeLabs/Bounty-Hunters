import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Ref from "effect/Ref";
import * as Option from "effect/Option";
import * as Either from "effect/Either";
import * as Equal from "effect/Equal";
import * as Hash from "effect/Hash";
import * as Schema from "@effect/schema/Schema";

/**
 * Represents an authentication session with user information and expiration.
 */
export interface AuthSession {
  /** Unique session identifier */
  readonly id: string;
  /** User identifier */
  readonly userId: string;
  /** Session expiration timestamp (milliseconds since epoch) */
  readonly expiresAt: number;
  /** Optional session metadata */
  readonly metadata?: Record<string, unknown>;
  /** Session creation timestamp */
  readonly createdAt: number;
}

/**
 * Session storage interface for persisting sessions.
 */
export interface SessionStorage {
  /**
   * Get a session by ID.
   */
  readonly get: (id: string) => Effect.Effect<Option.Option<AuthSession>>;

  /**
   * Create or update a session.
   */
  readonly set: (session: AuthSession) => Effect.Effect<void>;

  /**
   * Remove a session by ID.
   */
  readonly remove: (id: string) => Effect.Effect<void>;

  /**
   * Get all sessions for a user.
   */
  readonly getByUserId: (userId: string) => Effect.Effect<ReadonlyArray<AuthSession>>;

  /**
   * Get all sessions.
   */
  readonly getAll: Effect.Effect<ReadonlyArray<AuthSession>>;

  /**
   * Remove all sessions for a user.
   */
  readonly removeByUserId: (userId: string) => Effect.Effect<void>;

  /**
   * Remove all expired sessions.
   */
  readonly removeExpired: Effect.Effect<void>;
}

/**
 * In-memory session storage implementation.
 */
export class MemorySessionStorage implements SessionStorage {
  private readonly sessions: Ref.Ref<Map<string, AuthSession>>;

  private constructor(sessions: Ref.Ref<Map<string, AuthSession>>) {
    this.sessions = sessions;
  }

  get(id: string): Effect.Effect<Option.Option<AuthSession>> = Effect.map(
    Ref.get(this.sessions),
    (sessions) => Option.fromNullable(sessions.get(id))
  );

  set(session: AuthSession): Effect.Effect<void> = Ref.update(
    this.sessions,
    (sessions) => new Map(sessions).set(session.id, session)
  );

  remove(id: string): Effect.Effect<void> = Ref.update(
    this.sessions,
    (sessions) => {
      const next = new Map(sessions);
      next.delete(id);
      return next;
    }
  );

  getByUserId(userId: string): Effect.Effect<ReadonlyArray<AuthSession>> =
    Effect.map(
      Ref.get(this.sessions),
      (sessions) =>
        Array.from(sessions.values()).filter(
          (session) => session.userId === userId
        )
    );

  getAll: Effect.Effect<ReadonlyArray<AuthSession>> = Effect.map(
    Ref.get(this.sessions),
    (sessions) => Array.from(sessions.values())
  );

  removeByUserId(userId: string): Effect.Effect<void> = Ref.update(
    this.sessions,
    (sessions) => {
      const next = new Map(sessions);
      for (const [id, session] of next) {
        if (session.userId === userId) {
          next.delete(id);
        }
      }
      return next;
    }
  );

  removeExpired: Effect.Effect<void> = Effect.gen(function* () {
    const now = Date.now();
    const sessions = yield* Ref.get(this.sessions);
    const next = new Map(sessions);

    for (const [id, session] of next) {
      if (session.expiresAt <= now) {
        next.delete(id);
      }
    }

    yield* Ref.set(this.sessions, next);
  });

  static make: Effect.Effect<MemorySessionStorage> = Effect.map(
    Ref.make<Map<string, AuthSession>>(new Map()),
    (sessions) => new MemorySessionStorage(sessions)
  );
}

/**
 * Session manager for creating, validating, and managing auth sessions.
 */
export class AuthSessionManager extends Context.Tag(
  "t3/effect-acp/AuthSessionManager"
)<AuthSessionManager, {
  /**
   * Create a new session.
   */
  readonly create: (
    userId: string,
    options?: {
      readonly expiresIn?: number;
      readonly metadata?: Record<string, unknown>;
    }
  ) => Effect.Effect<AuthSession>;

  /**
   * Get a session by ID.
   */
  readonly get: (id: string) => Effect.Effect<Option.Option<AuthSession>>;

  /**
   * Validate a session and return it if valid.
   */
  readonly validate: (id: string) => Effect.Effect<Option.Option<AuthSession>>;

  /**
   * Refresh a session by extending its expiration.
   */
  readonly refresh: (
    id: string,
    expiresIn: number
  ) => Effect.Effect<Option.Option<AuthSession>>;

  /**
   * Invalidate a session.
   */
  readonly invalidate: (id: string) => Effect.Effect<void>;

  /**
   * Invalidate all sessions for a user.
   */
  readonly invalidateUser: (userId: string) => Effect.Effect<void>;

  /**
   * Invalidate all sessions except the current one.
   */
  readonly invalidateOthers: (
    userId: string,
    exceptSessionId: string
  ) => Effect.Effect<void>;

  /**
   * Get all sessions for a user.
   */
  readonly getUserSessions: (userId: string) => Effect.Effect<ReadonlyArray<AuthSession>>;

  /**
   * Get the current session from a request context.
   */
  readonly getCurrent: () => Effect.Effect<Option.Option<AuthSession>>;

  /**
   * Set the current session in the request context.
   */
  readonly setCurrent: (session: AuthSession) => Effect.Effect<void>;

  /**
   * Clear the current session from the request context.
   */
  readonly clearCurrent: Effect.Effect<void>;

  /**
   * Generate a unique session ID.
   */
  readonly generateId: Effect.Effect<string>;

  /**
   * Configuration for session management.
   */
  readonly config: {
    readonly defaultExpiresIn: number;
    readonly maxSessionsPerUser: number;
    readonly cleanupInterval: number;
  };
}> {}

/**
 * Context key for storing the current session.
 */
export const CurrentSession = Context.GenericTag<Option.Option<AuthSession>>(
  "t3/effect-acp/CurrentSession"
);

/**
 * Configuration for AuthSessionManager.
 */
export interface AuthSessionConfig {
  readonly defaultExpiresIn: number; // Default: 24 hours (24 * 60 * 60 * 1000)
  readonly maxSessionsPerUser: number; // Default: 5
  readonly cleanupInterval: number; // Default: 1 hour (60 * 60 * 1000)
  readonly sessionIdPrefix: string; // Default: "sess_"
}

/**
 * Default configuration.
 */
export const DefaultAuthSessionConfig: AuthSessionConfig = {
  defaultExpiresIn: 24 * 60 * 60 * 1000, // 24 hours
  maxSessionsPerUser: 5,
  cleanupInterval: 60 * 60 * 1000, // 1 hour
  sessionIdPrefix: "sess_",
};

/**
 * Implementation of AuthSessionManager.
 */
export class AuthSessionManagerImpl implements AuthSessionManager.Prototype {
  readonly config: AuthSessionConfig;
  private readonly storage: SessionStorage;

  constructor(config: AuthSessionConfig, storage: SessionStorage) {
    this.config = config;
    this.storage = storage;
  }

  create(
    userId: string,
    options?: {
      readonly expiresIn?: number;
      readonly metadata?: Record<string, unknown>;
    }
  ): Effect.Effect<AuthSession> = Effect.gen(function* () {
    // Check max sessions per user
    const userSessions = yield* this.storage.getByUserId(userId);
    if (userSessions.length >= this.config.maxSessionsPerUser) {
      // Remove oldest session
      const sorted = [...userSessions].sort(
        (a, b) => a.createdAt - b.createdAt
      );
      yield* this.storage.remove(sorted[0].id);
    }

    // Generate session
    const id = yield* this.generateId;
    const expiresIn = options?.expiresIn ?? this.config.defaultExpiresIn;
    const expiresAt = Date.now() + expiresIn;
    const session: AuthSession = {
      id,
      userId,
      expiresAt,
      metadata: options?.metadata,
      createdAt: Date.now(),
    };

    // Store session
    yield* this.storage.set(session);

    return session;
  });

  get(id: string): Effect.Effect<Option.Option<AuthSession>> =
    this.storage.get(id);

  validate(id: string): Effect.Effect<Option.Option<AuthSession>> =
    Effect.gen(function* () {
      const session = yield* this.storage.get(id);
      if (Option.isNone(session)) {
        return Option.none<AuthSession>();
      }

      const now = Date.now();
      if (session.value.expiresAt <= now) {
        // Session expired, remove it
        yield* this.storage.remove(id);
        return Option.none<AuthSession>();
      }

      return session;
    });

  refresh(
    id: string,
    expiresIn: number
  ): Effect.Effect<Option.Option<AuthSession>> = Effect.gen(function* () {
    const session = yield* this.storage.get(id);
    if (Option.isNone(session)) {
      return Option.none<AuthSession>();
    }

    const now = Date.now();
    if (session.value.expiresAt <= now) {
      // Session expired, cannot refresh
      return Option.none<AuthSession>();
    }

    // Update expiration
    const updatedSession: AuthSession = {
      ...session.value,
      expiresAt: now + expiresIn,
    };

    yield* this.storage.set(updatedSession);
    return Option.some(updatedSession);
  });

  invalidate(id: string): Effect.Effect<void> = this.storage.remove(id);

  invalidateUser(userId: string): Effect.Effect<void> =
    this.storage.removeByUserId(userId);

  invalidateOthers(
    userId: string,
    exceptSessionId: string
  ): Effect.Effect<void> = Effect.gen(function* () {
    const userSessions = yield* this.storage.getByUserId(userId);
    for (const session of userSessions) {
      if (session.id !== exceptSessionId) {
        yield* this.storage.remove(session.id);
      }
    }
  });

  getUserSessions(userId: string): Effect.Effect<ReadonlyArray<AuthSession>> =
    this.storage.getByUserId(userId);

  getCurrent(): Effect.Effect<Option.Option<AuthSession>> =
    CurrentSession.pipe(Effect.map(Option.fromNullable));

  setCurrent(session: AuthSession): Effect.Effect<void> =
    Context.set(CurrentSession, Option.some(session));

  clearCurrent: Effect.Effect<void> = Context.set(CurrentSession, Option.none());

  generateId: Effect.Effect<string> = Effect.map(
    Effect.sync(() => {
      return (
        this.config.sessionIdPrefix +
        Math.random().toString(36).substring(2, 15) +
        Math.random().toString(36).substring(2, 15)
      );
    })
  );

  static make: (
    config?: Partial<AuthSessionConfig>,
    storage?: SessionStorage
  ) => Effect.Effect<AuthSessionManager> = Effect.gen(function* () {
    const finalConfig: AuthSessionConfig = {
      ...DefaultAuthSessionConfig,
      ...config,
    };

    const finalStorage = storage ?? (yield* MemorySessionStorage.make);

    return new AuthSessionManagerImpl(finalConfig, finalStorage);
  });
}

/**
 * Layer for AuthSessionManager.
 */
export const AuthSessionManagerLayer = Layer.effect(
  AuthSessionManager,
  AuthSessionManagerImpl.make()
);

/**
 * Layer for AuthSessionManager with custom configuration.
 */
export function makeAuthSessionManagerLayer(
  config?: Partial<AuthSessionConfig>,
  storage?: SessionStorage
): Layer.Layer<AuthSessionManager> {
  return Layer.effect(
    AuthSessionManager,
    AuthSessionManagerImpl.make(config, storage)
  );
}

/**
 * Layer for MemorySessionStorage.
 */
export const MemorySessionStorageLayer = Layer.effect(
  SessionStorage,
  MemorySessionStorage.make
);

/**
 * Session middleware for Effect-based HTTP handlers.
 * Extracts session from request and sets it in context.
 */
export function withSession(
  extractSession: (
    request: unknown
  ) => Effect.Effect<Option.Option<AuthSession>>
): <R, E, A>(
  effect: Effect.Effect<A, E, R>
) => Effect.Effect<A, E | AuthSessionError, R> {
  return (request: unknown) =>
    Effect.gen(function* () {
      const session = yield* extractSession(request);
      yield* Context.set(CurrentSession, session);
      return yield* effect;
    });
}

/**
 * Require session middleware - rejects if no session is present.
 */
export function requireSession(
  extractSession: (
    request: unknown
  ) => Effect.Effect<Option.Option<AuthSession>>
): <R, E, A>(
  effect: Effect.Effect<A, E, R>
) => Effect.Effect<A, E | AuthSessionError, R> {
  return (request: unknown) =>
    Effect.gen(function* () {
      const session = yield* extractSession(request);
      if (Option.isNone(session)) {
        throw new AuthSessionError({ code: "UNAUTHORIZED" });
      }
      yield* Context.set(CurrentSession, session);
      return yield* effect;
    });
}

/**
 * Error type for session-related errors.
 */
export class AuthSessionError extends Error {
  readonly _tag = "AuthSessionError";

  constructor(
    readonly error: {
      readonly code: "UNAUTHORIZED" | "EXPIRED" | "INVALID" | "MAX_SESSIONS";
      readonly message?: string;
    }
  ) {
    super(error.message ?? `Auth session error: ${error.code}`);
    this.name = "AuthSessionError";
  }
}

/**
 * Helper to create a session token (JWT-like) from a session.
 */
export function createSessionToken(
  session: AuthSession,
  secret: string
): Effect.Effect<string> {
  return Effect.sync(() => {
    const header = Buffer.from(
      JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64");
    const payload = Buffer.from(
      JSON.stringify({
        sid: session.id,
        uid: session.userId,
        exp: Math.floor(session.expiresAt / 1000),
      })
    ).toString("base64");
    const signature = Buffer.from(
      JSON.stringify({ secret })
    ).toString("base64");
    return `${header}.${payload}.${signature}`;
  });
}

/**
 * Helper to parse a session token.
 */
export function parseSessionToken(
  token: string
): Effect.Effect<Option.Option<{ id: string; userId: string; exp: number }>> {
  return Effect.sync(() => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return Option.none();
      }
      const payload = JSON.parse(
        Buffer.from(parts[1], "base64").toString("utf-8")
      );
      return Option.some({
        id: payload.sid,
        userId: payload.uid,
        exp: payload.exp,
      });
    } catch {
      return Option.none();
    }
  });
}
