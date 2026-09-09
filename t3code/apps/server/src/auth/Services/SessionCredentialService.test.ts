import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import {
  SessionCredentialService,
  SessionCredentialError,
  SessionNotFoundError,
  NoActiveSessionsError,
  SessionWithDevice,
  DeviceInfo,
  SessionInfo,
} from "./SessionCredentialService";
import type { AuthClientMetadata, AuthSessionId } from "@t3tools/contracts";

// Mock client metadata
const mockClient: AuthClientMetadata = {
  userAgent: "test-agent",
  subject: "test-subject",
};

// Helper to get service from layer
function getService() {
  return Effect.service(SessionCredentialService).pipe(
    Effect.provide(SessionCredentialService.layer)
  );
}

describe("SessionCredentialService", () => {
  describe("Basic Session Operations", () => {
    it("should issue a new session", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({
          client: mockClient,
          ttl: Duration.minutes(60),
        })
      );
      
      expect(session.sessionId).toBeDefined();
      expect(session.token).toBeDefined();
      expect(session.client).toEqual(mockClient);
      expect(session.expiresAt).toBeInstanceOf(DateTime.DateTime);
    });

    it("should verify a valid token", async () => {
      const service = await Effect.runPromise(getService());
      
      const issued = await Effect.runPromise(
        service.issue({
          client: mockClient,
          subject: "test-user",
        })
      );
      
      const verified = await Effect.runPromise(
        service.verify(issued.token)
      );
      
      expect(verified.token).toBe(issued.token);
      expect(verified.subject).toBeDefined();
    });

    it("should fail to verify invalid token", async () => {
      const service = await Effect.runPromise(getService());
      
      await expect(
        Effect.runPromise(service.verify("invalid-token"))
      ).rejects.toThrow(SessionCredentialError);
    });

    it("should list active sessions", async () => {
      const service = await Effect.runPromise(getService());
      
      // Issue multiple sessions
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user2" })
      );
      
      const active = await Effect.runPromise(service.listActive());
      
      expect(active.length).toBeGreaterThanOrEqual(2);
    });

    it("should revoke a session", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      const revoked = await Effect.runPromise(
        service.revoke(session.sessionId)
      );
      
      expect(revoked).toBe(true);
      
      // Session should no longer be active
      const active = await Effect.runPromise(service.listActive());
      expect(active.some((s) => s.sessionId === session.sessionId)).toBe(false);
    });

    it("should return false when revoking non-existent session", async () => {
      const service = await Effect.runPromise(getService());
      
      const revoked = await Effect.runPromise(
        service.revoke("non-existent-session-id" as AuthSessionId)
      );
      
      expect(revoked).toBe(false);
    });
  });

  describe("Multi-Session Management", () => {
    it("should revoke all sessions except one", async () => {
      const service = await Effect.runPromise(getService());
      
      // Issue multiple sessions
      const session1 = await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      const session2 = await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      const session3 = await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      
      // Revoke all except session2
      const count = await Effect.runPromise(
        service.revokeAllExcept(session2.sessionId)
      );
      
      expect(count).toBe(2);
      
      // Only session2 should remain
      const active = await Effect.runPromise(service.listActive());
      expect(active.length).toBe(1);
      expect(active[0].sessionId).toBe(session2.sessionId);
    });

    it("should list all sessions with device info", async () => {
      const service = await Effect.runPromise(getService());
      
      await Effect.runPromise(
        service.issue({
          client: mockClient,
          deviceInfo: { ipAddress: "192.168.1.1", platform: "web" },
        })
      );
      
      const sessions = await Effect.runPromise(service.listSessions());
      
      expect(sessions.length).toBeGreaterThanOrEqual(1);
      expect(sessions[0].deviceInfo).toBeDefined();
      expect(sessions[0].deviceInfo.userAgent).toBe("test-agent");
    });

    it("should get a specific session by ID", async () => {
      const service = await Effect.runPromise(getService());
      
      const issued = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      const session = await Effect.runPromise(
        service.getSession(issued.sessionId)
      );
      
      expect(session.sessionId).toBe(issued.sessionId);
      expect(session.token).toBe(issued.token);
    });

    it("should throw when getting non-existent session", async () => {
      const service = await Effect.runPromise(getService());
      
      await expect(
        Effect.runPromise(
          service.getSession("non-existent" as AuthSessionId)
        )
      ).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("Device Tracking", () => {
    it("should track device information", async () => {
      const service = await Effect.runPromise(getService());
      
      const deviceInfo: Partial<DeviceInfo> = {
        ipAddress: "10.0.0.1",
        platform: "mobile",
      };
      
      const session = await Effect.runPromise(
        service.issue({
          client: mockClient,
          deviceInfo,
        })
      );
      
      const sessionInfo = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      expect(sessionInfo.deviceInfo.ipAddress).toBe("10.0.0.1");
      expect(sessionInfo.deviceInfo.platform).toBe("mobile");
    });

    it("should get sessions by device", async () => {
      const service = await Effect.runPromise(getService());
      
      // Issue sessions with different devices
      await Effect.runPromise(
        service.issue({
          client: { ...mockClient, userAgent: "device-1" },
          deviceInfo: { deviceId: "device-1" },
        })
      );
      await Effect.runPromise(
        service.issue({
          client: { ...mockClient, userAgent: "device-2" },
          deviceInfo: { deviceId: "device-2" },
        })
      );
      
      const device1Sessions = await Effect.runPromise(
        service.getSessionsByDevice("device-1")
      );
      
      expect(device1Sessions.length).toBeGreaterThanOrEqual(1);
      expect(device1Sessions.every((s) => s.deviceInfo.deviceId === "device-1")).toBe(true);
    });

    it("should update device information", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      await Effect.runPromise(
        service.updateDeviceInfo(session.sessionId, {
          ipAddress: "192.168.1.100",
          platform: "desktop",
        })
      );
      
      const updatedSession = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      expect(updatedSession.deviceInfo.ipAddress).toBe("192.168.1.100");
      expect(updatedSession.deviceInfo.platform).toBe("desktop");
    });

    it("should throw when updating device info for non-existent session", async () => {
      const service = await Effect.runPromise(getService());
      
      await expect(
        Effect.runPromise(
          service.updateDeviceInfo("non-existent" as AuthSessionId, {})
        )
      ).rejects.toThrow(SessionNotFoundError);
    });
  });

  describe("Subject-Based Session Management", () => {
    it("should get current session for subject", async () => {
      const service = await Effect.runPromise(getService());
      
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      const session2 = await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      
      const current = await Effect.runPromise(
        service.getCurrentSession("user1")
      );
      
      expect(Option.isSome(current)).toBe(true);
      if (Option.isSome(current)) {
        expect(current.value.sessionId).toBe(session2.sessionId);
      }
    });

    it("should return none for subject with no sessions", async () => {
      const service = await Effect.runPromise(getService());
      
      const current = await Effect.runPromise(
        service.getCurrentSession("non-existent-user")
      );
      
      expect(Option.isNone(current)).toBe(true);
    });

    it("should get all sessions for a subject", async () => {
      const service = await Effect.runPromise(getService());
      
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user2" })
      );
      
      const user1Sessions = await Effect.runPromise(
        service.getSessionsBySubject("user1")
      );
      
      expect(user1Sessions.length).toBe(2);
      expect(user1Sessions.every((s) => s.client.subject === "user1")).toBe(true);
    });

    it("should revoke all sessions for a subject", async () => {
      const service = await Effect.runPromise(getService());
      
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user1" })
      );
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "user2" })
      );
      
      const count = await Effect.runPromise(
        service.revokeAllBySubject("user1")
      );
      
      expect(count).toBe(2);
      
      const user1Sessions = await Effect.runPromise(
        service.getSessionsBySubject("user1")
      );
      expect(user1Sessions.length).toBe(0);
      
      const user2Sessions = await Effect.runPromise(
        service.getSessionsBySubject("user2")
      );
      expect(user2Sessions.length).toBe(1);
    });
  });

  describe("Connection Tracking", () => {
    it("should mark session as connected", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      await Effect.runPromise(service.markDisconnected(session.sessionId));
      await Effect.runPromise(service.markConnected(session.sessionId));
      
      const sessionInfo = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      expect(sessionInfo.isConnected).toBe(true);
    });

    it("should mark session as disconnected", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      await Effect.runPromise(service.markDisconnected(session.sessionId));
      
      const sessionInfo = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      expect(sessionInfo.isConnected).toBe(false);
    });

    it("should update last active timestamp", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      const beforeUpdate = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      await Effect.runPromise(service.updateLastActive(session.sessionId));
      
      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 5100));
      
      const afterUpdate = await Effect.runPromise(
        service.getSession(session.sessionId)
      );
      
      // Last active should have been updated
      expect(afterUpdate.lastActiveAt.getTime()).toBeGreaterThan(
        beforeUpdate.lastActiveAt.getTime()
      );
    });
  });

  describe("Device-Based Revocation", () => {
    it("should revoke all sessions for a device", async () => {
      const service = await Effect.runPromise(getService());
      
      await Effect.runPromise(
        service.issue({
          client: { ...mockClient, userAgent: "device-1" },
          deviceInfo: { deviceId: "device-1" },
        })
      );
      await Effect.runPromise(
        service.issue({
          client: { ...mockClient, userAgent: "device-1" },
          deviceInfo: { deviceId: "device-1" },
        })
      );
      await Effect.runPromise(
        service.issue({
          client: { ...mockClient, userAgent: "device-2" },
          deviceInfo: { deviceId: "device-2" },
        })
      );
      
      const count = await Effect.runPromise(
        service.revokeAllByDevice("device-1")
      );
      
      expect(count).toBe(2);
      
      const device1Sessions = await Effect.runPromise(
        service.getSessionsByDevice("device-1")
      );
      expect(device1Sessions.length).toBe(0);
      
      const device2Sessions = await Effect.runPromise(
        service.getSessionsByDevice("device-2")
      );
      expect(device2Sessions.length).toBe(1);
    });
  });

  describe("Session Cleanup", () => {
    it("should clean up expired sessions", async () => {
      const service = await Effect.runPromise(getService());
      
      // Issue a session with very short TTL
      await Effect.runPromise(
        service.issue({
          client: mockClient,
          ttl: Duration.millis(10), // 10ms TTL
        })
      );
      
      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 50));
      
      // Clean up
      const count = await Effect.runPromise(service.cleanupExpired());
      
      expect(count).toBeGreaterThanOrEqual(1);
      
      // Session should be cleaned up
      const active = await Effect.runPromise(service.listActive());
      expect(active.length).toBe(0);
    });
  });

  describe("WebSocket Tokens", () => {
    it("should issue WebSocket token", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      const wsToken = await Effect.runPromise(
        service.issueWebSocketToken(session.sessionId)
      );
      
      expect(wsToken.token).toBeDefined();
      expect(wsToken.expiresAt).toBeInstanceOf(DateTime.DateTime);
    });

    it("should verify WebSocket token", async () => {
      const service = await Effect.runPromise(getService());
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      const wsToken = await Effect.runPromise(
        service.issueWebSocketToken(session.sessionId)
      );
      
      const verified = await Effect.runPromise(
        service.verifyWebSocketToken(wsToken.token)
      );
      
      expect(verified.token).toBe(wsToken.token);
    });
  });

  describe("Stream Changes", () => {
    it("should emit changes when session is issued", async () => {
      const service = await Effect.runPromise(getService());
      const changes: Array<any> = [];
      
      // Subscribe to changes
      Effect.runPromise(
        Effect.gen(function* () {
          for await (const change of service.streamChanges) {
            changes.push(change);
          }
        })
      );
      
      // Issue a session
      await Effect.runPromise(
        service.issue({ client: mockClient, subject: "test" })
      );
      
      // Wait for changes to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.some((c) => c.type === "clientUpserted")).toBe(true);
    });

    it("should emit changes when session is revoked", async () => {
      const service = await Effect.runPromise(getService());
      const changes: Array<any> = [];
      
      // Subscribe to changes
      Effect.runPromise(
        Effect.gen(function* () {
          for await (const change of service.streamChanges) {
            changes.push(change);
          }
        })
      );
      
      // Issue and revoke a session
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      await Effect.runPromise(service.revoke(session.sessionId));
      
      // Wait for changes to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      expect(changes.some((c) => c.type === "clientRemoved")).toBe(true);
    });

    it("should emit device connected/disconnected changes", async () => {
      const service = await Effect.runPromise(getService());
      const changes: Array<any> = [];
      
      // Subscribe to changes
      Effect.runPromise(
        Effect.gen(function* () {
          for await (const change of service.streamChanges) {
            changes.push(change);
          }
        })
      );
      
      // Issue a session
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      // Mark as disconnected and connected
      await Effect.runPromise(service.markDisconnected(session.sessionId));
      await Effect.runPromise(service.markConnected(session.sessionId));
      
      // Wait for changes to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));
      
      expect(changes.some((c) => c.type === "deviceDisconnected")).toBe(true);
      expect(changes.some((c) => c.type === "deviceConnected")).toBe(true);
    });
  });

  describe("Layer Integration", () => {
    it("should work with layer", async () => {
      const service = await Effect.runPromise(
        Effect.service(SessionCredentialService).pipe(
          Effect.provide(SessionCredentialService.layer)
        )
      );
      
      const session = await Effect.runPromise(
        service.issue({ client: mockClient })
      );
      
      expect(session.sessionId).toBeDefined();
    });
  });
});
