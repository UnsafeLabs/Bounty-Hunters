import {
  AuthClientSession,
  AuthClientMetadata,
  AuthSessionId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { ServerAuth, AuthError } from "./Services/ServerAuth.ts";
import { SessionCredentialService } from "./Services/SessionCredentialService.ts";
import { ServerAuthPolicy } from "./Services/ServerAuthPolicy.ts";
import { AuthControlPlane } from "./Services/AuthControlPlane.ts";
import { respondToAuthError } from "./http.ts";

export const DeviceInfoSchema = Schema.Struct({
  deviceType: Schema.String,
  label: Schema.optionalKey(Schema.String),
  ipAddress: Schema.optionalKey(Schema.String),
  userAgent: Schema.optionalKey(Schema.String),
  os: Schema.optionalKey(Schema.String),
  browser: Schema.optionalKey(Schema.String),
});

export const SessionInfoSchema = Schema.Struct({
  sessionId: Schema.String,
  subject: Schema.String,
  role: Schema.String,
  method: Schema.String,
  device: DeviceInfoSchema,
  issuedAt: Schema.String,
  expiresAt: Schema.String,
  lastConnectedAt: Schema.optionalKey(Schema.String),
  connected: Schema.Boolean,
  current: Schema.Boolean,
});

export const RevokeSessionInputSchema = Schema.Struct({
  sessionId: Schema.String,
});

export const RevokeByDeviceInputSchema = Schema.Struct({
  deviceType: Schema.String,
});

export const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const policy = yield* ServerAuthPolicy;
  const authResult = yield* serverAuth.authenticateHttpRequest(request);
  if (authResult.role !== "owner") {
    return yield* new AuthError({
      message: "Forbidden: owner access required.",
      status: 403,
    });
  }
  return { serverAuth, session: authResult };
});

/**
 * GET /api/auth/sessions — List all active sessions with device tracking info
 */
export const authSessionsRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/sessions",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const sessions = yield* serverAuth.listClientSessions(session.sessionId);

    // Enrich with device info
    const sessionInfos = sessions.map((s) => ({
      sessionId: s.sessionId,
      subject: s.subject,
      role: s.role,
      method: s.method,
      device: {
        deviceType: s.client.deviceType || "unknown",
        ...(s.client.label ? { label: s.client.label } : {}),
        ...(s.client.ipAddress ? { ipAddress: s.client.ipAddress } : {}),
        ...(s.client.userAgent ? { userAgent: s.client.userAgent } : {}),
        ...(s.client.os ? { os: s.client.os } : {}),
        ...(s.client.browser ? { browser: s.client.browser } : {}),
      },
      issuedAt: s.issuedAt?.toString() || null,
      expiresAt: s.expiresAt?.toString() || null,
      lastConnectedAt: s.lastConnectedAt?.toString() || null,
      connected: s.connected,
      current: s.current,
    }));

    return HttpServerResponse.jsonUnsafe(
      { sessions: sessionInfos },
      { status: 200 },
    );
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * POST /api/auth/sessions/revoke — Revoke a specific session by ID
 */
export const authSessionsRevokeRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/sessions/revoke",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const payload = yield* HttpServerRequest.schemaBodyJson(RevokeSessionInputSchema).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid revoke payload.",
            status: 400,
            cause,
          }),
      ),
    );

    const revoked = yield* serverAuth.revokeClientSession(
      session.sessionId,
      payload.sessionId as AuthSessionId,
    );

    return HttpServerResponse.jsonUnsafe({ revoked }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * POST /api/auth/sessions/revoke-by-device — Revoke all sessions for a device type
 */
export const authSessionsRevokeByDeviceRouteLayer = HttpRouter.add(
  "POST",
  "/api/auth/sessions/revoke-by-device",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const payload = yield* HttpServerRequest.schemaBodyJson(RevokeByDeviceInputSchema).pipe(
      Effect.mapError(
        (cause) =>
          new AuthError({
            message: "Invalid device type.",
            status: 400,
            cause,
          }),
      ),
    );

    // List all sessions and revoke matching device types
    const sessions = yield* serverAuth.listClientSessions(session.sessionId);
    const targetSessions = sessions.filter(
      (s) =>
        s.client.deviceType === payload.deviceType &&
        !s.current &&
        s.sessionId !== session.sessionId,
    );

    let revokedCount = 0;
    for (const target of targetSessions) {
      const result = yield* serverAuth.revokeClientSession(
        session.sessionId,
        target.sessionId,
      );
      if (result) revokedCount++;
    }

    return HttpServerResponse.jsonUnsafe({ revokedCount }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);

/**
 * GET /api/auth/sessions/devices — List unique device types in use
 */
export const authSessionsDevicesRouteLayer = HttpRouter.add(
  "GET",
  "/api/auth/sessions/devices",
  Effect.gen(function* () {
    const { serverAuth, session } = yield* authenticateOwnerSession;
    const sessions = yield* serverAuth.listClientSessions(session.sessionId);

    const deviceMap = new Map<string, { count: number; sessions: typeof sessions }>();

    for (const s of sessions) {
      const deviceType = s.client.deviceType || "unknown";
      if (!deviceMap.has(deviceType)) {
        deviceMap.set(deviceType, { count: 0, sessions: [] });
      }
      const entry = deviceMap.get(deviceType)!;
      entry.count++;
      entry.sessions.push(s);
    }

    const devices = Array.from(deviceMap.entries()).map(([deviceType, info]) => ({
      deviceType,
      sessionCount: info.count,
      sessions: info.sessions.map((s) => ({
        sessionId: s.sessionId,
        subject: s.subject,
        connected: s.connected,
        current: s.current,
        lastConnectedAt: s.lastConnectedAt?.toString() || null,
      })),
    }));

    return HttpServerResponse.jsonUnsafe({ devices }, { status: 200 });
  }).pipe(Effect.catchTag("AuthError", respondToAuthError)),
);
