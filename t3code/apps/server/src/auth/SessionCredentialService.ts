import { Effect, Layer } from "effect";
import { SqlitePersistence } from "../persistence/SqlitePersistence.js";

export interface SessionServiceConstructor {
  createSession(
    options: { deviceName: string; deviceType: string; ipAddress: string }
  ): Effect.Effect<never, any, SessionRecord>;
  listSessions(userId: string): Effect.Effect<never, any, SessionRecord[]>;
  revokeSession(sessionId: string): Effect.Effect<never, any, void>;
  updateLastActive(sessionId: string): Effect.Effect<never, any, void>;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly deviceName: string;
  readonly deviceType: string;
 readonly ipAddress: string;
  readonly lastActiveAt: Date;
  readonly createdAt: Date;
  readonly revokedAt?: Date;
}

export const SessionService = Context.GenericTag<SessionServiceConstructor>("SessionService");

export const make = Effect.gen(function* (_) {
  const persistence = yield* _(SqlitePersistence);
  
  const createSession = (
    options: { deviceName: string; deviceType: string; ipAddress: string }
  ) => Effect.gen(function* (_) {
    const session: SessionRecord = {
      id: yield* _(persistence.generateId()),
      userId: "",
      deviceName: options.deviceName,
      deviceType: options.deviceType,
      ipAddress: options.ipAddress,
      lastActiveAt: new Date(),
      createdAt: new Date(),
      revokedAt: undefined
    };
    return session;
  });
  
  return yield* persistence.createSession(session);
}));

  return SessionServiceConstructor;
}) as Effect.Effect<SessionServiceConstructor, never, Scope>;
});