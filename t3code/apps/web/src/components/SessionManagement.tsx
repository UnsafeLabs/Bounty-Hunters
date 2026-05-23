import { useState, useEffect } from "react";

interface DeviceInfo {
  deviceType: string;
  label?: string;
  ipAddress?: string;
  userAgent?: string;
  os?: string;
  browser?: string;
}

interface SessionInfo {
  sessionId: string;
  subject: string;
  role: string;
  method: string;
  device: DeviceInfo;
  issuedAt: string | null;
  expiresAt: string | null;
  lastConnectedAt: string | null;
  connected: boolean;
  current: boolean;
}

interface DeviceGroup {
  deviceType: string;
  sessionCount: number;
  sessions: {
    sessionId: string;
    subject: string;
    connected: boolean;
    current: boolean;
    lastConnectedAt: string | null;
  }[];
}

export function SessionManagement() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [devices, setDevices] = useState<DeviceGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    fetchSessions();
    fetchDevices();
  }, []);

  async function fetchSessions() {
    try {
      const res = await fetch("/api/auth/sessions");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function fetchDevices() {
    try {
      const res = await fetch("/api/auth/sessions/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      const data = await res.json();
      setDevices(data.devices || []);
    } catch {
      // Non-critical
    }
  }

  async function revokeSession(sessionId: string) {
    setRevoking(sessionId);
    try {
      const res = await fetch("/api/auth/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (!res.ok) throw new Error("Failed to revoke session");
      await fetchSessions();
      await fetchDevices();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    } finally {
      setRevoking(null);
    }
  }

  async function revokeByDevice(deviceType: string) {
    setRevoking(`device:${deviceType}`);
    try {
      const res = await fetch("/api/auth/sessions/revoke-by-device", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceType }),
      });
      if (!res.ok) throw new Error("Failed to revoke device sessions");
      await fetchSessions();
      await fetchDevices();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to revoke");
    } finally {
      setRevoking(null);
    }
  }

  if (loading) return <div className="p-4">Loading sessions...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  return (
    <div className="p-4 space-y-6">
      <h2 className="text-lg font-semibold">Active Sessions</h2>

      {/* Device Summary */}
      {devices.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-400">Devices</h3>
          <div className="flex flex-wrap gap-2">
            {devices.map((device) => (
              <div
                key={device.deviceType}
                className="flex items-center gap-2 bg-gray-800 rounded-lg px-3 py-2"
              >
                <span className="text-sm font-medium">{device.deviceType}</span>
                <span className="text-xs text-gray-400">
                  ({device.sessionCount} sessions)
                </span>
                {device.deviceType !== "unknown" && (
                  <button
                    onClick={() => revokeByDevice(device.deviceType)}
                    disabled={revoking === `device:${device.deviceType}`}
                    className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
                  >
                    {revoking === `device:${device.deviceType}` ? "..." : "Revoke all"}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session List */}
      <div className="space-y-2">
        {sessions.length === 0 ? (
          <p className="text-gray-500 text-sm">No active sessions</p>
        ) : (
          sessions.map((session) => (
            <div
              key={session.sessionId}
              className={`flex items-center justify-between p-3 rounded-lg ${
                session.current ? "bg-blue-900/30 border border-blue-700" : "bg-gray-800"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {session.device.deviceType}
                    {session.device.label && ` (${session.device.label})`}
                  </span>
                  {session.current && (
                    <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">
                      Current
                    </span>
                  )}
                  {session.connected && (
                    <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">
                      Online
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  {session.device.os && `${session.device.os} • `}
                  {session.device.browser && `${session.device.browser} • `}
                  {session.device.ipAddress && `${session.device.ipAddress} • `}
                  {session.method}
                </div>
                {session.lastConnectedAt && (
                  <div className="text-xs text-gray-500 mt-1">
                    Last connected: {new Date(session.lastConnectedAt).toLocaleString()}
                  </div>
                )}
              </div>
              {!session.current && (
                <button
                  onClick={() => revokeSession(session.sessionId)}
                  disabled={revoking === session.sessionId}
                  className="ml-4 text-sm text-red-400 hover:text-red-300 disabled:opacity-50"
                >
                  {revoking === session.sessionId ? "..." : "Revoke"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
