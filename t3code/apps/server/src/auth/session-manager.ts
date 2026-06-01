/**
 * Multi-session management with device tracking.
 */

interface Session {
  id: string;
  userId: string;
  device: { name: string; os: string; ip: string };
  createdAt: number;
  lastActive: number;
  current: boolean;
}

export class SessionManager {
  private sessions: Map<string, Session> = new Map();

  createSession(userId: string, device: Session["device"]): Session {
    const session: Session = {
      id: crypto.randomUUID(),
      userId, device,
      createdAt: Date.now(),
      lastActive: Date.now(),
      current: true,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSessions(userId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.lastActive - a.lastActive);
  }

  revokeSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  revokeAllExcept(userId: string, keepSessionId: string): number {
    let count = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && id !== keepSessionId) {
        this.sessions.delete(id);
        count++;
      }
    }
    return count;
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) session.lastActive = Date.now();
  }
}
