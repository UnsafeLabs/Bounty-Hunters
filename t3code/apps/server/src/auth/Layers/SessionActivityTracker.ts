import { AuthSessionId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { AuthSessionRepository } from "../../persistence/Services/AuthSessions.ts";
import {
  SessionActivityError,
  SessionActivityTracker,
  type SessionActivityTrackerShape,
  type TrackedSession,
} from "../Services/SessionActivityTracker.ts";
import type { DeviceInfo } from "../Services/UserAgentParser.ts";

const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000;

const toSessionActivityError =
  (message: string) =>
  (cause: unknown) =>
    new SessionActivityError(message, cause);

export const makeSessionActivityTracker = Effect.gen(function* () {
  const authSessions = yield* AuthSessionRepository;
  const lastUpdateRef = yield* Ref.make(new Map<string, number>());

  const trackActivity: SessionActivityTrackerShape["trackActivity"] = (
    sessionId,
    deviceInfo,
    ipAddress,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      const lastUpdate = yield* Ref.get(lastUpdateRef).pipe(
        Effect.map((m) => m.get(sessionId) ?? 0),
      );

      if (now - lastUpdate < ACTIVITY_DEBOUNCE_MS) {
        return;
      }

      yield* Ref.update(lastUpdateRef, (m) => {
        const next = new Map(m);
        next.set(sessionId, now);
        return next;
      });

      const lastActiveAt = yield* DateTime.now;
      yield* authSessions.setLastConnectedAt({ sessionId, lastConnectedAt: lastActiveAt }).pipe(
        Effect.mapError(toSessionActivityError("Failed to update session activity")),
      );
    });

  const listSessions: SessionActivityTrackerShape["listSessions"] = (subject) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      const rows = yield* authSessions.listActive({ now }).pipe(
        Effect.mapError(toSessionActivityError("Failed to list sessions")),
      );

      return rows
        .filter((row) => row.subject === subject)
        .map(
          (row): TrackedSession => ({
            sessionId: row.sessionId,
            deviceName: row.client.label ?? "Unknown Device",
            deviceType: row.client.deviceType,
            ipAddress: row.client.ipAddress,
            lastActiveAt: row.lastConnectedAt
              ? new Date(row.lastConnectedAt.epochMilliseconds)
              : null,
            createdAt: new Date(row.issuedAt.epochMilliseconds),
            revokedAt: row.revokedAt ? new Date(row.revokedAt.epochMilliseconds) : null,
          }),
        )
        .sort(
          (a, b) =>
            (b.lastActiveAt?.getTime() ?? 0) - (a.lastActiveAt?.getTime() ?? 0),
        );
    });

  const revokeSession: SessionActivityTrackerShape["revokeSession"] = (sessionId) =>
    Effect.gen(function* () {
      const revokedAt = yield* DateTime.now;
      const revoked = yield* authSessions.revoke({ sessionId, revokedAt }).pipe(
        Effect.mapError(toSessionActivityError("Failed to revoke session")),
      );
      return revoked;
    });

  const revokeAllOtherSessions: SessionActivityTrackerShape["revokeAllOtherSessions"] = (
    currentSessionId,
    _subject,
  ) =>
    Effect.gen(function* () {
      const revokedAt = yield* DateTime.now;
      const revokedSessionIds = yield* authSessions
        .revokeAllExcept({ currentSessionId, revokedAt })
        .pipe(
          Effect.mapError(toSessionActivityError("Failed to revoke other sessions")),
        );
      return revokedSessionIds.length;
    });

  return {
    trackActivity,
    listSessions,
    revokeSession,
    revokeAllOtherSessions,
  } satisfies SessionActivityTrackerShape;
});

export const SessionActivityTrackerLive = Layer.effect(
  SessionActivityTracker,
  makeSessionActivityTracker,
);
