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
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";

export type SessionRole = "owner" | "client";

/**
 * Device information for session tracking.
 */
export interface DeviceInfo {
  readonly deviceId: string;
  readonly userAgent: string;
  readonly ipAddress: string;
  readonly platform: string;
  readonly lastActiveAt: DateTime.DateTime;
  readonly createdAt: DateTime.DateTime;
}

/**
 * Extended session information with device tracking.
 */
export interface SessionInfo {
  readonly sessionId: AuthSessionId;
  readonly token: string;
  readonly method: ServerAuthSessionMethod;
  readonly client: AuthClientMetadata;
  readonly expiresAt: DateTime.DateTime;
  readonly role: SessionRole;
  readonly deviceInfo: DeviceInfo;
  readonly isConnected: boolean;
}

/**
 * Session with device tracking.
 */
export interface SessionWithDevice {
  readonly session: IssuedSession;
  readonly deviceInfo: DeviceInfo;
  readonly isConnected: boolean;
  readonly lastActiveAt: DateTime.DateTime;
}

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
    }
  | {
      readonly type: "deviceConnected";
      readonly sessionId: AuthSessionId;
      readonly deviceInfo: DeviceInfo;
    }
  | {
      readonly type: "deviceDisconnected";
      readonly sessionId: AuthSessionId;
      readonly deviceInfo: DeviceInfo;
    };

export class SessionCredentialError extends Data.TaggedError("SessionCredentialError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class SessionNotFoundError extends Data.TaggedError("SessionNotFoundError")<{
  readonly sessionId: AuthSessionId;
}> {
  readonly message = `Session not found: ${this.sessionId}`;
}

export class NoActiveSessionsError extends Data.TaggedError("NoActiveSessionsError")<{}> {
  readonly message = "No active sessions found";
}

export interface SessionCredentialServiceShape {
  readonly cookieName: string;
  
  /**
   * Issue a new session with optional device information.
   */
  readonly issue: (input?: {
    readonly ttl?: Duration.Duration;
    readonly subject?: string;
    readonly method?: ServerAuthSessionMethod;
    readonly role?: SessionRole;
    readonly client?: AuthClientMetadata;
    readonly deviceInfo?: Partial<DeviceInfo>;
  }) => Effect.Effect<IssuedSession, SessionCredentialError>;
  
  /**
   * Verify a token and return the verified session.
   */
  readonly verify: (token: string) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  
  /**
   * Issue a WebSocket token for a session.
   */
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
  
  /**
   * Verify a WebSocket token.
   */
  readonly verifyWebSocketToken: (
    token: string,
  ) => Effect.Effect<VerifiedSession, SessionCredentialError>;
  
  /**
   * List all active sessions.
   */
  readonly listActive: () => Effect.Effect<
    ReadonlyArray<AuthClientSession>,
    SessionCredentialError
  >;
  
  /**
   * List all sessions with device information.
   */
  readonly listSessions: () => Effect.Effect<
    ReadonlyArray<SessionInfo>,
    SessionCredentialError
  >;
  
  /**
   * Get a specific session by ID.
   */
  readonly getSession: (sessionId: AuthSessionId) => Effect.Effect<SessionInfo, SessionNotFoundError>;
  
  /**
   * Get the current session for the given subject.
   */
  readonly getCurrentSession: (subject: string) => Effect.Effect<Option.Option<SessionInfo>, never>;
  
  /**
   * Get sessions for a specific subject/user.
   */
  readonly getSessionsBySubject: (subject: string) => Effect.Effect<ReadonlyArray<SessionInfo>, never>;
  
  /**
   * Get sessions for a specific device.
   */
  readonly getSessionsByDevice: (deviceId: string) => Effect.Effect<ReadonlyArray<SessionInfo>, never>;
  
  /**
   * Stream of session credential changes.
   */
  readonly streamChanges: Stream.Stream<SessionCredentialChange>;
  
  /**
   * Revoke a specific session.
   */
  readonly revoke: (sessionId: AuthSessionId) => Effect.Effect<boolean, SessionCredentialError>;
  
  /**
   * Revoke all sessions except the specified one.
   */
  readonly revokeAllExcept: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<number, SessionCredentialError>;
  
  /**
   * Revoke all sessions for a specific subject.
   */
  readonly revokeAllBySubject: (subject: string) => Effect.Effect<number, SessionCredentialError>;
  
  /**
   * Revoke all sessions for a specific device.
   */
  readonly revokeAllByDevice: (deviceId: string) => Effect.Effect<number, SessionCredentialError>;
  
  /**
   * Mark a session as connected.
   */
  readonly markConnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  
  /**
   * Mark a session as disconnected.
   */
  readonly markDisconnected: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  
  /**
   * Update device information for a session.
   */
  readonly updateDeviceInfo: (
    sessionId: AuthSessionId,
    deviceInfo: Partial<DeviceInfo>
  ) => Effect.Effect<void, SessionNotFoundError>;
  
  /**
   * Update the last active timestamp for a session (debounced).
   */
  readonly updateLastActive: (sessionId: AuthSessionId) => Effect.Effect<void, never>;
  
  /**
   * Clean up expired sessions.
   */
  readonly cleanupExpired: () => Effect.Effect<number, never>;
}

export class SessionCredentialService extends Context.Service<
  SessionCredentialService,
  SessionCredentialServiceShape
>()("t3/auth/Services/SessionCredentialService") {
  static readonly layer = Layer.effect(
    SessionCredentialService,
    Effect.gen(function* () {
      const sessions = yield* Ref.make(
        HashMap.empty<AuthSessionId, SessionWithDevice>()
      );
      const subjectSessions = yield* Ref.make(
        HashMap.empty<string, ReadonlyArray<AuthSessionId>>()
      );
      const deviceSessions = yield* Ref.make(
        HashMap.empty<string, ReadonlyArray<AuthSessionId>>()
      );
      const changeHub = yield* Stream.makeHub<SessionCredentialChange>();
      const lastActiveDebouncer = yield* Ref.make(
        new Map<AuthSessionId, NodeJS.Timeout>()
      );
      const debounceDelayMs = 5000; // 5 seconds debounce

      const updateLastActiveDebounced = (sessionId: AuthSessionId) =>
        Effect.gen(function* () {
          const debouncers = yield* Ref.get(lastActiveDebouncer);
          
          // Clear existing timeout
          if (debouncers.has(sessionId)) {
            clearTimeout(debouncers.get(sessionId));
          }
          
          // Set new timeout
          const timeout = setTimeout(() => {
            Effect.runPromise(
              Effect.gen(function* () {
                const currentSessions = yield* Ref.get(sessions);
                const session = HashMap.get(currentSessions, sessionId);
                
                if (Option.isSome(session)) {
                  const updatedSession: SessionWithDevice = {
                    ...session.value,
                    lastActiveAt: DateTime.DateTime.now(),
                  };
                  
                  yield* Ref.set(
                    sessions,
                    HashMap.set(currentSessions, sessionId, updatedSession)
                  );
                  
                  yield* Stream.emit(changeHub, {
                    type: "deviceConnected",
                    sessionId,
                    deviceInfo: updatedSession.deviceInfo,
                  });
                }
                
                // Clean up the timeout
                const updatedDebouncers = new Map(debouncers);
                updatedDebouncers.delete(sessionId);
                yield* Ref.set(lastActiveDebouncer, updatedDebouncers);
              })
            );
          }, debounceDelayMs);
          
          const updatedDebouncers = new Map(debouncers);
          updatedDebouncers.set(sessionId, timeout);
          yield* Ref.set(lastActiveDebouncer, updatedDebouncers);
        });

      const getDeviceId = (client: AuthClientMetadata): string => {
        // Generate a consistent device ID from client metadata
        return client.userAgent || "unknown";
      };

      const createDeviceInfo = (
        client: AuthClientMetadata,
        overrides?: Partial<DeviceInfo>
      ): DeviceInfo => ({
        deviceId: getDeviceId(client),
        userAgent: client.userAgent || "unknown",
        ipAddress: overrides?.ipAddress || "unknown",
        platform: overrides?.platform || "unknown",
        lastActiveAt: DateTime.DateTime.now(),
        createdAt: DateTime.DateTime.now(),
      });

      return SessionCredentialService.of({
        cookieName: "t3-session",
        
        issue: (input) =>
          Effect.gen(function* () {
            const sessionId = yield* Effect.uuid();
            const now = DateTime.DateTime.now();
            const ttl = input?.ttl ?? Duration.minutes(60);
            const expiresAt = DateTime.now().pipe(Duration.add(ttl));
            
            const client = input?.client ?? { userAgent: "unknown" };
            const deviceInfo = createDeviceInfo(client, input?.deviceInfo);
            
            const session: IssuedSession = {
              sessionId,
              token: yield* Effect.uuid(),
              method: input?.method ?? "cookie",
              client,
              expiresAt: yield* expiresAt,
              role: input?.role ?? "client",
            };
            
            const sessionWithDevice: SessionWithDevice = {
              session,
              deviceInfo,
              isConnected: true,
              lastActiveAt: now,
            };
            
            // Store session
            const currentSessions = yield* Ref.get(sessions);
            yield* Ref.set(
              sessions,
              HashMap.set(currentSessions, sessionId, sessionWithDevice)
            );
            
            // Index by subject
            if (input?.subject) {
              const currentSubjectSessions = yield* Ref.get(subjectSessions);
              const existing = HashMap.get(currentSubjectSessions, input.subject) ?? [];
              yield* Ref.set(
                subjectSessions,
                HashMap.set(currentSubjectSessions, input.subject, [...existing, sessionId])
              );
            }
            
            // Index by device
            const currentDeviceSessions = yield* Ref.get(deviceSessions);
            const existing = HashMap.get(currentDeviceSessions, deviceInfo.deviceId) ?? [];
            yield* Ref.set(
              deviceSessions,
              HashMap.set(currentDeviceSessions, deviceInfo.deviceId, [...existing, sessionId])
            );
            
            yield* Stream.emit(changeHub, {
              type: "clientUpserted",
              clientSession: {
                sessionId,
                token: session.token,
                method: session.method,
                client: session.client,
                expiresAt: session.expiresAt,
                role: session.role,
              },
            });
            
            yield* Stream.emit(changeHub, {
              type: "deviceConnected",
              sessionId,
              deviceInfo,
            });
            
            return session;
          }),
        
        verify: (token) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            
            for (const sessionWithDevice of HashMap.values(currentSessions)) {
              if (sessionWithDevice.session.token === token) {
                const now = DateTime.DateTime.now();
                const isExpired = sessionWithDevice.session.expiresAt < now;
                
                if (isExpired) {
                  // Auto-revoke expired session
                  yield* Ref.set(
                    sessions,
                    HashMap.remove(currentSessions, sessionWithDevice.session.sessionId)
                  );
                  continue;
                }
                
                const subject = yield* Effect.succeed(
                  sessionWithDevice.session.client.subject || sessionWithDevice.session.client.userAgent
                );
                
                return {
                  sessionId: sessionWithDevice.session.sessionId,
                  token: sessionWithDevice.session.token,
                  method: sessionWithDevice.session.method,
                  client: sessionWithDevice.session.client,
                  expiresAt: sessionWithDevice.session.expiresAt,
                  subject,
                  role: sessionWithDevice.session.role,
                };
              }
            }
            
            return yield* new SessionCredentialError({
              message: "Invalid token",
            });
          }),
        
        issueWebSocketToken: (sessionId, input) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const session = HashMap.get(currentSessions, sessionId);
            
            if (Option.isNone(session)) {
              return yield* new SessionCredentialError({
                message: `Session ${sessionId} not found`,
              });
            }
            
            const ttl = input?.ttl ?? Duration.hours(1);
            const expiresAt = DateTime.DateTime.now().pipe(Duration.add(ttl));
            
            return {
              token: yield* Effect.uuid(),
              expiresAt: yield* expiresAt,
            };
          }),
        
        verifyWebSocketToken: (token) =>
          Effect.gen(function* () {
            // WebSocket token verification would check against stored WS tokens
            // For now, return a dummy response
            return {
              sessionId: "ws-session",
              token,
              method: "websocket",
              client: { userAgent: "websocket-client" },
              role: "client",
            };
          }),
        
        listActive: () =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const now = DateTime.DateTime.now();
            
            const active: Array<AuthClientSession> = [];
            
            for (const sessionWithDevice of HashMap.values(currentSessions)) {
              if (sessionWithDevice.session.expiresAt > now) {
                active.push({
                  sessionId: sessionWithDevice.session.sessionId,
                  token: sessionWithDevice.session.token,
                  method: sessionWithDevice.session.method,
                  client: sessionWithDevice.session.client,
                  expiresAt: sessionWithDevice.session.expiresAt,
                  role: sessionWithDevice.session.role,
                });
              }
            }
            
            return active;
          }),
        
        listSessions: () =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const now = DateTime.DateTime.now();
            
            const sessionsList: Array<SessionInfo> = [];
            
            for (const sessionWithDevice of HashMap.values(currentSessions)) {
              if (sessionWithDevice.session.expiresAt > now) {
                sessionsList.push({
                  sessionId: sessionWithDevice.session.sessionId,
                  token: sessionWithDevice.session.token,
                  method: sessionWithDevice.session.method,
                  client: sessionWithDevice.session.client,
                  expiresAt: sessionWithDevice.session.expiresAt,
                  role: sessionWithDevice.session.role,
                  deviceInfo: sessionWithDevice.deviceInfo,
                  isConnected: sessionWithDevice.isConnected,
                });
              }
            }
            
            return sessionsList;
          }),
        
        getSession: (sessionId) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const sessionWithDevice = HashMap.get(currentSessions, sessionId);
            
            if (Option.isNone(sessionWithDevice)) {
              return yield* new SessionNotFoundError({ sessionId });
            }
            
            return {
              sessionId: sessionWithDevice.value.session.sessionId,
              token: sessionWithDevice.value.session.token,
              method: sessionWithDevice.value.session.method,
              client: sessionWithDevice.value.session.client,
              expiresAt: sessionWithDevice.value.session.expiresAt,
              role: sessionWithDevice.value.session.role,
              deviceInfo: sessionWithDevice.value.deviceInfo,
              isConnected: sessionWithDevice.value.isConnected,
            };
          }),
        
        getCurrentSession: (subject) =>
          Effect.gen(function* () {
            const currentSubjectSessions = yield* Ref.get(subjectSessions);
            const sessionIds = HashMap.get(currentSubjectSessions, subject) ?? [];
            
            if (sessionIds.length === 0) {
              return Option.none<SessionInfo>();
            }
            
            const currentSessions = yield* Ref.get(sessions);
            const lastSessionId = sessionIds[sessionIds.length - 1];
            const sessionWithDevice = HashMap.get(currentSessions, lastSessionId);
            
            if (Option.isNone(sessionWithDevice)) {
              return Option.none<SessionInfo>();
            }
            
            return Option.some({
              sessionId: sessionWithDevice.value.session.sessionId,
              token: sessionWithDevice.value.session.token,
              method: sessionWithDevice.value.session.method,
              client: sessionWithDevice.value.session.client,
              expiresAt: sessionWithDevice.value.session.expiresAt,
              role: sessionWithDevice.value.session.role,
              deviceInfo: sessionWithDevice.value.deviceInfo,
              isConnected: sessionWithDevice.value.isConnected,
            });
          }),
        
        getSessionsBySubject: (subject) =>
          Effect.gen(function* () {
            const currentSubjectSessions = yield* Ref.get(subjectSessions);
            const sessionIds = HashMap.get(currentSubjectSessions, subject) ?? [];
            const currentSessions = yield* Ref.get(sessions);
            const now = DateTime.DateTime.now();
            
            const sessionsList: Array<SessionInfo> = [];
            
            for (const sessionId of sessionIds) {
              const sessionWithDevice = HashMap.get(currentSessions, sessionId);
              if (Option.isSome(sessionWithDevice) && sessionWithDevice.value.session.expiresAt > now) {
                sessionsList.push({
                  sessionId: sessionWithDevice.value.session.sessionId,
                  token: sessionWithDevice.value.session.token,
                  method: sessionWithDevice.value.session.method,
                  client: sessionWithDevice.value.session.client,
                  expiresAt: sessionWithDevice.value.session.expiresAt,
                  role: sessionWithDevice.value.session.role,
                  deviceInfo: sessionWithDevice.value.deviceInfo,
                  isConnected: sessionWithDevice.value.isConnected,
                });
              }
            }
            
            return sessionsList;
          }),
        
        getSessionsByDevice: (deviceId) =>
          Effect.gen(function* () {
            const currentDeviceSessions = yield* Ref.get(deviceSessions);
            const sessionIds = HashMap.get(currentDeviceSessions, deviceId) ?? [];
            const currentSessions = yield* Ref.get(sessions);
            const now = DateTime.DateTime.now();
            
            const sessionsList: Array<SessionInfo> = [];
            
            for (const sessionId of sessionIds) {
              const sessionWithDevice = HashMap.get(currentSessions, sessionId);
              if (Option.isSome(sessionWithDevice) && sessionWithDevice.value.session.expiresAt > now) {
                sessionsList.push({
                  sessionId: sessionWithDevice.value.session.sessionId,
                  token: sessionWithDevice.value.session.token,
                  method: sessionWithDevice.value.session.method,
                  client: sessionWithDevice.value.session.client,
                  expiresAt: sessionWithDevice.value.session.expiresAt,
                  role: sessionWithDevice.value.session.role,
                  deviceInfo: sessionWithDevice.value.deviceInfo,
                  isConnected: sessionWithDevice.value.isConnected,
                });
              }
            }
            
            return sessionsList;
          }),
        
        streamChanges: changeHub,
        
        revoke: (sessionId) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const sessionWithDevice = HashMap.get(currentSessions, sessionId);
            
            if (Option.isNone(sessionWithDevice)) {
              return false;
            }
            
            // Remove from sessions
            yield* Ref.set(
              sessions,
              HashMap.remove(currentSessions, sessionId)
            );
            
            // Remove from subject index
            const currentSubjectSessions = yield* Ref.get(subjectSessions);
            const subject = sessionWithDevice.value.session.client.subject;
            if (subject) {
              const existing = HashMap.get(currentSubjectSessions, subject) ?? [];
              const updated = existing.filter((id) => id !== sessionId);
              yield* Ref.set(
                subjectSessions,
                updated.length > 0
                  ? HashMap.set(currentSubjectSessions, subject, updated)
                  : HashMap.remove(currentSubjectSessions, subject)
              );
            }
            
            // Remove from device index
            const currentDeviceSessions = yield* Ref.get(deviceSessions);
            const deviceId = sessionWithDevice.value.deviceInfo.deviceId;
            const existingDevice = HashMap.get(currentDeviceSessions, deviceId) ?? [];
            const updatedDevice = existingDevice.filter((id) => id !== sessionId);
            yield* Ref.set(
              deviceSessions,
              updatedDevice.length > 0
                ? HashMap.set(currentDeviceSessions, deviceId, updatedDevice)
                : HashMap.remove(currentDeviceSessions, deviceId)
            );
            
            yield* Stream.emit(changeHub, {
              type: "clientRemoved",
              sessionId,
            });
            
            yield* Stream.emit(changeHub, {
              type: "deviceDisconnected",
              sessionId,
              deviceInfo: sessionWithDevice.value.deviceInfo,
            });
            
            return true;
          }),
        
        revokeAllExcept: (exceptSessionId) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            let count = 0;
            
            for (const sessionId of HashMap.keys(currentSessions)) {
              if (sessionId !== exceptSessionId) {
                const sessionWithDevice = HashMap.get(currentSessions, sessionId);
                if (Option.isSome(sessionWithDevice)) {
                  // Revoke this session
                  yield* Ref.set(
                    sessions,
                    HashMap.remove(currentSessions, sessionId)
                  );
                  
                  // Update indexes
                  const currentSubjectSessions = yield* Ref.get(subjectSessions);
                  const subject = sessionWithDevice.value.session.client.subject;
                  if (subject) {
                    const existing = HashMap.get(currentSubjectSessions, subject) ?? [];
                    const updated = existing.filter((id) => id !== sessionId);
                    yield* Ref.set(
                      subjectSessions,
                      updated.length > 0
                        ? HashMap.set(currentSubjectSessions, subject, updated)
                        : HashMap.remove(currentSubjectSessions, subject)
                    );
                  }
                  
                  const currentDeviceSessions = yield* Ref.get(deviceSessions);
                  const deviceId = sessionWithDevice.value.deviceInfo.deviceId;
                  const existingDevice = HashMap.get(currentDeviceSessions, deviceId) ?? [];
                  const updatedDevice = existingDevice.filter((id) => id !== sessionId);
                  yield* Ref.set(
                    deviceSessions,
                    updatedDevice.length > 0
                      ? HashMap.set(currentDeviceSessions, deviceId, updatedDevice)
                      : HashMap.remove(currentDeviceSessions, deviceId)
                  );
                  
                  yield* Stream.emit(changeHub, {
                    type: "clientRemoved",
                    sessionId,
                  });
                  
                  yield* Stream.emit(changeHub, {
                    type: "deviceDisconnected",
                    sessionId,
                    deviceInfo: sessionWithDevice.value.deviceInfo,
                  });
                  
                  count++;
                }
              }
            }
            
            return count;
          }),
        
        revokeAllBySubject: (subject) =>
          Effect.gen(function* () {
            const currentSubjectSessions = yield* Ref.get(subjectSessions);
            const sessionIds = HashMap.get(currentSubjectSessions, subject) ?? [];
            const currentSessions = yield* Ref.get(sessions);
            let count = 0;
            
            for (const sessionId of sessionIds) {
              const sessionWithDevice = HashMap.get(currentSessions, sessionId);
              if (Option.isSome(sessionWithDevice)) {
                // Remove from sessions
                yield* Ref.set(
                  sessions,
                  HashMap.remove(currentSessions, sessionId)
                );
                
                // Remove from device index
                const currentDeviceSessions = yield* Ref.get(deviceSessions);
                const deviceId = sessionWithDevice.value.deviceInfo.deviceId;
                const existingDevice = HashMap.get(currentDeviceSessions, deviceId) ?? [];
                const updatedDevice = existingDevice.filter((id) => id !== sessionId);
                yield* Ref.set(
                  deviceSessions,
                  updatedDevice.length > 0
                    ? HashMap.set(currentDeviceSessions, deviceId, updatedDevice)
                    : HashMap.remove(currentDeviceSessions, deviceId)
                );
                
                yield* Stream.emit(changeHub, {
                  type: "clientRemoved",
                  sessionId,
                });
                
                yield* Stream.emit(changeHub, {
                  type: "deviceDisconnected",
                  sessionId,
                  deviceInfo: sessionWithDevice.value.deviceInfo,
                });
                
                count++;
              }
            }
            
            // Remove from subject index
            yield* Ref.set(
              subjectSessions,
              HashMap.remove(currentSubjectSessions, subject)
            );
            
            return count;
          }),
        
        revokeAllByDevice: (deviceId) =>
          Effect.gen(function* () {
            const currentDeviceSessions = yield* Ref.get(deviceSessions);
            const sessionIds = HashMap.get(currentDeviceSessions, deviceId) ?? [];
            const currentSessions = yield* Ref.get(sessions);
            let count = 0;
            
            for (const sessionId of sessionIds) {
              const sessionWithDevice = HashMap.get(currentSessions, sessionId);
              if (Option.isSome(sessionWithDevice)) {
                // Remove from sessions
                yield* Ref.set(
                  sessions,
                  HashMap.remove(currentSessions, sessionId)
                );
                
                // Remove from subject index
                const currentSubjectSessions = yield* Ref.get(subjectSessions);
                const subject = sessionWithDevice.value.session.client.subject;
                if (subject) {
                  const existing = HashMap.get(currentSubjectSessions, subject) ?? [];
                  const updated = existing.filter((id) => id !== sessionId);
                  yield* Ref.set(
                    subjectSessions,
                    updated.length > 0
                      ? HashMap.set(currentSubjectSessions, subject, updated)
                      : HashMap.remove(currentSubjectSessions, subject)
                  );
                }
                
                yield* Stream.emit(changeHub, {
                  type: "clientRemoved",
                  sessionId,
                });
                
                yield* Stream.emit(changeHub, {
                  type: "deviceDisconnected",
                  sessionId,
                  deviceInfo: sessionWithDevice.value.deviceInfo,
                });
                
                count++;
              }
            }
            
            // Remove from device index
            yield* Ref.set(
              deviceSessions,
              HashMap.remove(currentDeviceSessions, deviceId)
            );
            
            return count;
          }),
        
        markConnected: (sessionId) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const sessionWithDevice = HashMap.get(currentSessions, sessionId);
            
            if (Option.isSome(sessionWithDevice)) {
              const updated: SessionWithDevice = {
                ...sessionWithDevice.value,
                isConnected: true,
                lastActiveAt: DateTime.DateTime.now(),
              };
              
              yield* Ref.set(
                sessions,
                HashMap.set(currentSessions, sessionId, updated)
              );
              
              yield* Stream.emit(changeHub, {
                type: "deviceConnected",
                sessionId,
                deviceInfo: updated.deviceInfo,
              });
            }
          }),
        
        markDisconnected: (sessionId) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const sessionWithDevice = HashMap.get(currentSessions, sessionId);
            
            if (Option.isSome(sessionWithDevice)) {
              const updated: SessionWithDevice = {
                ...sessionWithDevice.value,
                isConnected: false,
              };
              
              yield* Ref.set(
                sessions,
                HashMap.set(currentSessions, sessionId, updated)
              );
              
              yield* Stream.emit(changeHub, {
                type: "deviceDisconnected",
                sessionId,
                deviceInfo: updated.deviceInfo,
              });
            }
          }),
        
        updateDeviceInfo: (sessionId, deviceInfo) =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const sessionWithDevice = HashMap.get(currentSessions, sessionId);
            
            if (Option.isNone(sessionWithDevice)) {
              return yield* new SessionNotFoundError({ sessionId });
            }
            
            const updated: SessionWithDevice = {
              ...sessionWithDevice.value,
              deviceInfo: {
                ...sessionWithDevice.value.deviceInfo,
                ...deviceInfo,
              },
            };
            
            yield* Ref.set(
              sessions,
              HashMap.set(currentSessions, sessionId, updated)
            );
          }),
        
        updateLastActive: (sessionId) =>
          yield* updateLastActiveDebounced(sessionId),
        
        cleanupExpired: () =>
          Effect.gen(function* () {
            const currentSessions = yield* Ref.get(sessions);
            const now = DateTime.DateTime.now();
            let count = 0;
            
            for (const sessionId of HashMap.keys(currentSessions)) {
              const sessionWithDevice = HashMap.get(currentSessions, sessionId);
              if (Option.isSome(sessionWithDevice) && sessionWithDevice.value.session.expiresAt <= now) {
                // Remove expired session
                yield* Ref.set(
                  sessions,
                  HashMap.remove(currentSessions, sessionId)
                );
                
                // Update indexes
                const currentSubjectSessions = yield* Ref.get(subjectSessions);
                const subject = sessionWithDevice.value.session.client.subject;
                if (subject) {
                  const existing = HashMap.get(currentSubjectSessions, subject) ?? [];
                  const updated = existing.filter((id) => id !== sessionId);
                  yield* Ref.set(
                    subjectSessions,
                    updated.length > 0
                      ? HashMap.set(currentSubjectSessions, subject, updated)
                      : HashMap.remove(currentSubjectSessions, subject)
                  );
                }
                
                const currentDeviceSessions = yield* Ref.get(deviceSessions);
                const deviceId = sessionWithDevice.value.deviceInfo.deviceId;
                const existingDevice = HashMap.get(currentDeviceSessions, deviceId) ?? [];
                const updatedDevice = existingDevice.filter((id) => id !== sessionId);
                yield* Ref.set(
                  deviceSessions,
                  updatedDevice.length > 0
                    ? HashMap.set(currentDeviceSessions, deviceId, updatedDevice)
                    : HashMap.remove(currentDeviceSessions, deviceId)
                );
                
                count++;
              }
            }
            
            return count;
          }),
      });
    }),
  );
}
