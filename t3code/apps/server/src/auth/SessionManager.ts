import { Effect, Schema, Ref, Layer } from "effect";

export const DeviceInfo = Schema.Struct({
  deviceId: Schema.String,
  userAgent: Schema.String,
  ipAddress: Schema.String,
  platform: Schema.String,
  lastActiveAt: Schema.String,
});

export type DeviceInfoType = Schema.Schema.Type<typeof DeviceInfo>;

export const SessionRecord = Schema.Struct({
  sessionId: Schema.String,
  userId: Schema.String,
  deviceId: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  isActive: Schema.Boolean,
  device: DeviceInfo,
});

export type SessionRecordType = Schema.Schema.Type<typeof SessionRecord>;

export const SessionPolicy = Schema.Struct({
  maxSessionsPerUser: Schema.Number,
  sessionTimeoutMinutes: Schema.Number,
  maxDevicesPerUser: Schema.Number,
});

export type SessionPolicyType = Schema.Schema.Type<typeof SessionPolicy>;

export const DefaultSessionPolicy: SessionPolicyType = {
  maxSessionsPerUser: 5,
  sessionTimeoutMinutes: 60,
  maxDevicesPerUser: 3,
};

export const SessionManager = Effect.gen(function* (_) {
  const sessions = yield* _(Ref.make<Map<string, SessionRecordType>>(new Map()));
  const devices = yield* _(Ref.make<Map<string, DeviceInfoType[]>>(new Map()));
  const policy = yield* _(Ref.make(DefaultSessionPolicy));

  const createSession = (userId: string, device: DeviceInfoType) =>
    Effect.gen(function* (_) {
      const p = yield* _(Ref.get(policy));
      const allSessions = yield* _(Ref.get(sessions));
      const userSessions = [...allSessions.values()].filter(
        (s) => s.userId === userId && s.isActive
      );

      // Enforce max sessions per user
      if (userSessions.length >= p.maxSessionsPerUser) {
        // Revoke oldest session
        const oldest = userSessions.sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        )[0];
        yield* _(Ref.update(sessions, (m) => {
          const next = new Map(m);
          const existing = next.get(oldest.sessionId);
          if (existing) next.set(oldest.sessionId, { ...existing, isActive: false });
          return next;
        }));
      }

      // Track device
      const userDevices = (yield* _(Ref.get(devices))).get(userId) || [];
      const existingDevice = userDevices.find((d) => d.deviceId === device.deviceId);

      if (!existingDevice) {
        if (userDevices.length >= p.maxDevicesPerUser) {
          // Remove oldest device
          const updatedDevices = [...userDevices.slice(1), device];
          yield* _(Ref.update(devices, (m) => {
            const next = new Map(m);
            next.set(userId, updatedDevices);
            return next;
          }));
        } else {
          yield* _(Ref.update(devices, (m) => {
            const next = new Map(m);
            next.set(userId, [...userDevices, device]);
            return next;
          }));
        }
      } else {
        // Update last active
        yield* _(Ref.update(devices, (m) => {
          const next = new Map(m);
          next.set(userId, userDevices.map((d) =>
            d.deviceId === device.deviceId ? { ...d, lastActiveAt: new Date().toISOString() } : d
          ));
          return next;
        }));
      }

      const sessionId = crypto.randomUUID();
      const now = new Date();
      const record: SessionRecordType = {
        sessionId,
        userId,
        deviceId: device.deviceId,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + p.sessionTimeoutMinutes * 60000).toISOString(),
        isActive: true,
        device,
      };

      yield* _(Ref.update(sessions, (m) => {
        const next = new Map(m);
        next.set(sessionId, record);
        return next;
      }));

      return record;
    });

  const revokeSession = (sessionId: string) =>
    Effect.gen(function* (_) {
      yield* _(Ref.update(sessions, (m) => {
        const next = new Map(m);
        const existing = next.get(sessionId);
        if (existing) next.set(sessionId, { ...existing, isActive: false });
        return next;
      }));
    });

  const revokeAllUserSessions = (userId: string) =>
    Effect.gen(function* (_) {
      yield* _(Ref.update(sessions, (m) => {
        const next = new Map(m);
        for (const [id, session] of next) {
          if (session.userId === userId) {
            next.set(id, { ...session, isActive: false });
          }
        }
        return next;
      }));
    });

  const getUserSessions = (userId: string) =>
    Effect.gen(function* (_) {
      const all = yield* _(Ref.get(sessions));
      return [...all.values()].filter(
        (s) => s.userId === userId && s.isActive
      );
    });

  const getUserDevices = (userId: string) =>
    Effect.gen(function* (_) {
      const all = yield* _(Ref.get(devices));
      return all.get(userId) || [];
    });

  const validateSession = (sessionId: string) =>
    Effect.gen(function* (_) {
      const all = yield* _(Ref.get(sessions));
      const session = all.get(sessionId);
      if (!session || !session.isActive) return null;
      if (new Date(session.expiresAt) < new Date()) {
        yield* _(revokeSession(sessionId));
        return null;
      }
      return session;
    });

  const updatePolicy = (newPolicy: Partial<SessionPolicyType>) =>
    Ref.update(policy, (p) => ({ ...p, ...newPolicy }));

  const cleanupExpired = Effect.gen(function* (_) {
    const all = yield* _(Ref.get(sessions));
    let cleaned = 0;
    for (const [id, session] of all) {
      if (new Date(session.expiresAt) < new Date() && session.isActive) {
        yield* _(revokeSession(id));
        cleaned++;
      }
    }
    return cleaned;
  });

  return {
    createSession,
    revokeSession,
    revokeAllUserSessions,
    getUserSessions,
    getUserDevices,
    validateSession,
    updatePolicy,
    cleanupExpired,
  };
});

export const SessionManagerLayer = Layer.effect(SessionManager, SessionManager);
