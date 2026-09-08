import type {
  AuthClientMetadata,
  AuthClientSession,
  AuthSessionId,
  ServerAuthSessionMethod,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";
import * as Database from "@t3tools/database";

// Session database record interface
export interface SessionRecord {
  readonly id: number;
  readonly user_id: number;
  readonly device_name: string;
  readonly device_type: string;
  readonly ip_address: string;
  readonly last_active_at: string;
  readonly created_at: string;
  readonly revoked_at: string | null;
  readonly session_id: AuthSessionId;
}

// Session with device info for listing
export interface UserSession {
  readonly sessionId: AuthSessionId;
  readonly deviceName: string;
  readonly deviceType: string;
  readonly ipAddress: string;
  readonly lastActiveAt: DateTime.DateTime;
  readonly createdAt: DateTime.DateTime;
  readonly isCurrent: boolean;
}

export type SessionRole = "owner" | "client";

export interface IssuedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.DateTime;
  readonly role: SessionRole;
}

export interface VerifiedSession {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt?: DateTime.DateTime;
  readonly subject: string;
  readonly role: SessionRole;
}

export type SessionCredentialChange =
  | {
      readonly type: "clientUpserted";
      readonly clientSession: AuthClientSession;
    }
  | {
      readonly type: "clientRemoved";
      readonly sessionId: AuthSessionId;
    };

export class SessionCredentialError extends Data.TaggedError("SessionCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Helper to extract device info from user agent
function parseUserAgent(userAgent: string | undefined): {
  deviceName: string;
  deviceType: string;
} {
  const defaultDevice = { deviceName: "Unknown", deviceType: "desktop" };
  
  if (!userAgent) {
    return defaultDevice;
  }

  const ua = userAgent.toLowerCase();
  
  // Detect device type
  let deviceType = "desktop";
  if (ua.includes("mobile") || ua.includes("android") || ua.includes("iphone") || ua.includes("ipad")) {
    deviceType = "mobile";
  } else if (ua.includes("tablet")) {
    deviceType = "tablet";
  }
  
  // Detect device name
  let deviceName = "Unknown";
  if (ua.includes("windows")) {
    deviceName = "Windows";
  } else if (ua.includes("macintosh") || ua.includes("mac os x")) {
    deviceName = "Mac";
  } else if (ua.includes("linux")) {
    deviceName = "Linux";
  } else if (ua.includes("iphone")) {
    deviceName = "iPhone";
  } else if (ua.includes("ipad")) {
    deviceName = "iPad";
  } else if (ua.includes("android")) {
    deviceName = "Android";
  } else if (ua.includes("chrome")) {
    deviceName = "Chrome Browser";
  } else if (ua.includes("firefox")) {
    deviceName = "Firefox Browser";
  } else if (ua.includes("safari")) {
    deviceName = "Safari Browser";
  }
  
  return { deviceName, deviceType };
}

// Debounce tracking - only update last_active_at every 5 minutes
const LAST_ACTIVE_DEBOUNCE_MINUTES = 5;
const LAST_ACTIVE_DEBOUNCE_MS = LAST_ACTIVE_DEBOUNCE_MINUTES * 60 * 1000;

// In-memory cache for last activity tracking to avoid excessive DB writes
const lastActivityCache = new Map<string, number>();

export interface SessionCredentialServiceShape {
  readonly cookieName: string;
  readonly issue: (input?: {
    readonly ttl?: Duration.Duration;
    readonly subject?: string;
    readonly method?: ServerAuthSessionMethod;
    readonly role?: SessionRole;
    readonly client?: AuthClientMetadata;
    readonly ipAddress?: string;
    readonly userAgent?: string;
  }) => Effect.Effect<IssuedSession, SessionCredentialError>;
  readonly verify: (token: string) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly issueWebSocketToken: (
    sessionId: AuthSessionId,
    input?: {
      readonly ttl?: Duration.Duration;
    },
  ) => Effect.Effect<
    {
      readonly token: string;
      readonly expiresAt: DateTime.DateTime;
    },
    SessionCredentialError
  >;
  readonly verifyWebSocketToken: (
    token: string,
  ) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<AuthClientSession>,
    SessionCredentialError
  >;
  readonly streamChanges: Stream.Stream<SessionCredentialChange>;
  readonly revoke: (sessionId: AuthSessionId) => Effect.Effect<boolean, SessionCredentialError>;
  readonly revokeAllExcept: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<number, SessionCredentialError>;
  readonly markConnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  readonly markDisconnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  // New methods for multi-session management
  readonly listSessions: (userId: number) => Effect.Effect<ReadonlyArray<UserSession>, SessionCredentialError>;
  readonly revokeSession: (sessionId: AuthSessionId) => Effect.Effect<boolean, SessionCredentialError>;
  readonly revokeAllOtherSessions: (sessionId: AuthSessionId, userId: number) => Effect.Effect<number, SessionCredentialError>;
  readonly updateLastActive: (sessionId: AuthSessionId, userId: number) => Effect.Effect<void, never>;
}

export class SessionCredentialService extends Context.Service<
  SessionCredentialService,
  SessionCredentialServiceShape
>()("t3/auth/Services/SessionCredentialService") {
  // Static method to create a session record in the database
  static createSessionRecord(
    sessionId: AuthSessionId,
    userId: number,
    deviceName: string,
    deviceType: string,
    ipAddress: string
  ): Effect.Effect<void, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const now = DateTime.DateTime.now();
      const nowString = DateTime.formatISO(now);
      
      yield* db.run({
        sql: `INSERT INTO sessions (user_id, device_name, device_type, ip_address, last_active_at, created_at, session_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        values: [userId, deviceName, deviceType, ipAddress, nowString, nowString, sessionId],
      });
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to create session record: ${String(error)}`,
        cause: error,
      }));
    });
  }

  // Static method to get session by sessionId
  static getSessionById(sessionId: AuthSessionId): Effect.Effect<SessionRecord | null, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const result = yield* db.run({
        sql: `SELECT * FROM sessions WHERE session_id = ? AND revoked_at IS NULL`,
        values: [sessionId],
      });
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return result.rows[0] as SessionRecord;
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to get session: ${String(error)}`,
        cause: error,
      }));
    });
  }

  // Static method to list sessions for a user
  static listSessionsForUser(userId: number): Effect.Effect<ReadonlyArray<UserSession>, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const result = yield* db.run({
        sql: `SELECT * FROM sessions 
              WHERE user_id = ? AND revoked_at IS NULL 
              ORDER BY last_active_at DESC`,
        values: [userId],
      });
      
      const sessions = result.rows as SessionRecord[];
      
      return sessions.map((s) => ({
        sessionId: s.session_id,
        deviceName: s.device_name,
        deviceType: s.device_type,
        ipAddress: s.ip_address,
        lastActiveAt: DateTime.DateTime.fromISOString(s.last_active_at),
        createdAt: DateTime.DateTime.fromISOString(s.created_at),
        isCurrent: false, // Will be set by caller
      }));
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to list sessions: ${String(error)}`,
        cause: error,
      }));
    });
  }

  // Static method to revoke a session
  static revokeSession(sessionId: AuthSessionId): Effect.Effect<boolean, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const now = DateTime.DateTime.now();
      const nowString = DateTime.formatISO(now);
      
      const result = yield* db.run({
        sql: `UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL`,
        values: [nowString, sessionId],
      });
      
      return result.changes > 0;
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to revoke session: ${String(error)}`,
        cause: error,
      }));
    });
  }

  // Static method to revoke all sessions except one
  static revokeAllOtherSessions(sessionId: AuthSessionId, userId: number): Effect.Effect<number, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const now = DateTime.DateTime.now();
      const nowString = DateTime.formatISO(now);
      
      const result = yield* db.run({
        sql: `UPDATE sessions SET revoked_at = ? 
              WHERE user_id = ? AND session_id != ? AND revoked_at IS NULL`,
        values: [nowString, userId, sessionId],
      });
      
      return result.changes;
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to revoke other sessions: ${String(error)}`,
        cause: error,
      }));
    });
  }

  // Static method to update last_active_at (debounced)
  static updateLastActive(sessionId: AuthSessionId, userId: number): Effect.Effect<void, never> {
    return Effect.gen(function* () {
      const now = DateTime.DateTime.now();
      const nowMs = DateTime.toMillis(now);
      
      // Check cache to avoid excessive DB writes
      const cacheKey = `${userId}:${sessionId}`;
      const lastUpdate = lastActivityCache.get(cacheKey) ?? 0;
      
      if (nowMs - lastUpdate < LAST_ACTIVE_DEBOUNCE_MS) {
        return; // Skip update if within debounce window
      }
      
      // Update cache
      lastActivityCache.set(cacheKey, nowMs);
      
      const db = yield* Database.Database;
      const nowString = DateTime.formatISO(now);
      
      yield* db.run({
        sql: `UPDATE sessions SET last_active_at = ? 
              WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL`,
        values: [nowString, sessionId, userId],
      });
    }).catchAll(() => {
      // Silently fail - we don't want to break auth due to activity tracking issues
      return Effect.void;
    });
  }

  // Static method to check if session is revoked
  static isSessionRevoked(sessionId: AuthSessionId): Effect.Effect<boolean, SessionCredentialError> {
    return Effect.gen(function* () {
      const db = yield* Database.Database;
      
      const result = yield* db.run({
        sql: `SELECT revoked_at FROM sessions WHERE session_id = ?`,
        values: [sessionId],
      });
      
      if (result.rows.length === 0) {
        return false; // Session doesn't exist, not revoked
      }
      
      return result.rows[0].revoked_at !== null;
    }).catchAll((error) => {
      return Effect.fail(new SessionCredentialError({
        message: `Failed to check session revocation: ${String(error)}`,
        cause: error,
      }));
    });
  }
}
