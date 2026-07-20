/**
 * Multi-session management with device tracking, revocation, and debounced
 * last_active_at updates (issue #835).
 *
 * Complements SessionCredentialService with an explicit session registry
 * suitable for list/revoke APIs and activity heartbeats.
 */

import { parseDeviceName } from "./deviceName.ts";

export const ACTIVITY_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes

export type DeviceType = "desktop" | "mobile" | "tablet" | "bot" | "unknown";

export interface SessionRecord {
  id: string;
  userId: string;
  deviceName: string;
  deviceType: DeviceType;
  ipAddress: string | null;
  userAgent: string | null;
  lastActiveAt: number;
  createdAt: number;
  revokedAt: number | null;
}

export interface CreateSessionInput {
  id?: string;
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceType?: DeviceType;
  now?: number;
}

function inferDeviceType(userAgent: string | null | undefined): DeviceType {
  if (!userAgent) return "unknown";
  const n = userAgent.toLowerCase();
  if (/bot|crawler|spider|slurp|curl|wget/.test(n)) return "bot";
  if (/ipad|tablet/.test(n)) return "tablet";
  if (/iphone|android.+mobile|mobile/.test(n)) return "mobile";
  return "desktop";
}

export class MultiSessionManager {
  private sessions = new Map<string, SessionRecord>();
  /** Last time we persisted lastActiveAt for a session (debounce). */
  private lastWriteAt = new Map<string, number>();

  create(input: CreateSessionInput): SessionRecord {
    const now = input.now ?? Date.now();
    const ua = input.userAgent ?? null;
    const id = input.id ?? cryptoRandomId();
    const record: SessionRecord = {
      id,
      userId: input.userId,
      deviceName: parseDeviceName(ua),
      deviceType: input.deviceType ?? inferDeviceType(ua),
      ipAddress: input.ipAddress ?? null,
      userAgent: ua,
      lastActiveAt: now,
      createdAt: now,
      revokedAt: null,
    };
    this.sessions.set(id, record);
    this.lastWriteAt.set(id, now);
    return { ...record };
  }

  get(sessionId: string): SessionRecord | undefined {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : undefined;
  }

  isActive(sessionId: string, now = Date.now()): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.revokedAt !== null) return false;
    return true;
  }

  /**
   * Touch last_active_at. Returns true if the write was applied (not debounced).
   * Debounce: at most one DB/write every ACTIVITY_DEBOUNCE_MS.
   */
  touchActivity(sessionId: string, now = Date.now()): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.revokedAt !== null) return false;
    const lastWrite = this.lastWriteAt.get(sessionId) ?? 0;
    if (now - lastWrite < ACTIVITY_DEBOUNCE_MS) {
      // In-memory view can advance lightly without counting as a write
      return false;
    }
    s.lastActiveAt = now;
    this.lastWriteAt.set(sessionId, now);
    return true;
  }

  /** Force-set activity (tests / connect events). */
  forceTouch(sessionId: string, now = Date.now()): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.revokedAt !== null) return;
    s.lastActiveAt = now;
    this.lastWriteAt.set(sessionId, now);
  }

  listSessions(userId: string): SessionRecord[] {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId && s.revokedAt === null)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((s) => ({ ...s }));
  }

  revokeSession(sessionId: string, now = Date.now()): boolean {
    const s = this.sessions.get(sessionId);
    if (!s || s.revokedAt !== null) return false;
    s.revokedAt = now;
    return true;
  }

  /** Revoke every session for the user except currentSessionId. */
  revokeAllOtherSessions(userId: string, currentSessionId: string, now = Date.now()): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.userId === userId && s.id !== currentSessionId && s.revokedAt === null) {
        s.revokedAt = now;
        n += 1;
      }
    }
    return n;
  }

  /** SQL DDL for persistence (sessions table as specified). */
  static schemaSql(): string {
    return `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  ip_address TEXT,
  last_active_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, revoked_at, last_active_at DESC);
`.trim();
  }
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
