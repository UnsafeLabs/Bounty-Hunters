import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Context from "effect/Context";
import { SessionCredentialService as SessionCredentialServiceEffect } from "./Services/SessionCredentialService.js";
import { SqlitePersistence } from "../persistence/SqlitePersistence.js";
import { pipe } from "effect/Function";

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

export interface SessionCreateOptions {
  deviceName: string;
  deviceType: string;
  ipAddress: string;
}

export class SessionCredentialService extends SessionCredentialServiceEffect.Context.Tag(
  "SessionCredentialService"
)<SessionCredentialService>() {
  static readonly live = SessionCredentialServiceEffect.layer;

  static createSession = (
    sessionId: string,
    options: SessionCreateOptions
  ) => Effect.Effect<SessionRecord, never, void>;

  static listSessions = (userId: string) => Effect.Effect<SessionRecord[], never, SqlitePersistence>;
  
  static revokeSession = (sessionId: string) => Effect.Effect<void, never, SqlitePersistence>;
  
  static revokeAllOtherSessions = (
    currentSessionId: string
  ) => Effect.Effect<void, never, SqlitePersistence>;

  static updateLastActive = (
    sessionId: string
  ) => Effect.Effect<void, never, SqlitePersistence>;
}

  // Implementation of session management
  export const make = Effect.gen(function* () {
    const sessionCredentials = yield* SessionCredentialServiceEffect;
    const persistence = yield* SqlitePersistence;
    
    const createSession = (options: SessionCreateOptions) => 
      Effect.gen(function* () {
        const session: SessionRecord = {
          id: yield* persistence.generateId(),
          userId: "", // Will be set from context
          deviceName: options.deviceName,
          deviceType: options.deviceType,
          ipAddress: options.ipAddress,
          lastActiveAt: new Date(),
          createdAt: new Date(),
        };
        return yield* persistence.createSession(session);
      });
    
    return session;
  });
}