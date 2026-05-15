import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import { AuthSessionId } from "@t3tools/contracts";
import type { DeviceInfo } from "./UserAgentParser.ts";

export class SessionActivityError extends Error {
  readonly _tag = "SessionActivityError";
  constructor(message: string, readonly cause?: unknown) {
    super(message);
  }
}

export interface TrackedSession {
  readonly sessionId: string;
  readonly deviceName: string;
  readonly deviceType: string;
  readonly ipAddress: string | null;
  readonly lastActiveAt: Date | null;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionActivityTrackerShape {
  readonly trackActivity: (
    sessionId: AuthSessionId,
    deviceInfo: DeviceInfo,
    ipAddress: string | null,
  ) => Effect.Effect<void, SessionActivityError>;

  readonly listSessions: (
    subject: string,
  ) => Effect.Effect<ReadonlyArray<TrackedSession>, SessionActivityError>;

  readonly revokeSession: (
    sessionId: AuthSessionId,
  ) => Effect.Effect<boolean, SessionActivityError>;

  readonly revokeAllOtherSessions: (
    currentSessionId: AuthSessionId,
    subject: string,
  ) => Effect.Effect<number, SessionActivityError>;
}

export class SessionActivityTracker extends Context.Service<
  SessionActivityTracker,
  SessionActivityTrackerShape
>()("t3/auth/Services/SessionActivityTracker") {}
