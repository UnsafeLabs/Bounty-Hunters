/**
 * Tailscale peer diagnostics with latency graph.
 * Monitors VPN connectivity and peer health.
 */

interface PeerInfo {
  id: string;
  hostname: string;
  ip: string;
  os: string;
  online: boolean;
  latencyMs: number;
  lastSeen: number;
  relayNode?: string;
  exitNode?: boolean;
}

interface LatencyPoint {
  timestamp: number;
  latencyMs: number;
}

interface DiagnosticsResult {
  status: "healthy" | "degraded" | "disconnected";
  peers: PeerInfo[];
  latencyHistory: Map<string, LatencyPoint[]>;
  issues: string[];
}

/**
 * Tailscale diagnostics manager.
 */
export class TailscaleDiagnostics {
  private latencyHistory: Map<string, LatencyPoint[]> = new Map();
  private maxHistorySize: number;

  constructor(maxHistorySize: number = 100) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Run full diagnostics check.
   */
  async runDiagnostics(): Promise<DiagnosticsResult> {
    const peers = await this.getPeers();
    const issues: string[] = [];

    // Check each peer
    for (const peer of peers) {
      // Record latency
      this.recordLatency(peer.id, peer.latencyMs);

      // Check for issues
      if (!peer.online) {
        issues.push(`Peer ${peer.hostname} (${peer.ip}) is offline`);
      }
      if (peer.latencyMs > 200) {
        issues.push(`High latency to ${peer.hostname}: ${peer.latencyMs}ms`);
      }
      if (peer.relayNode) {
        issues.push(`Peer ${peer.hostname} using relay (direct connection unavailable)`);
      }
    }

    // Determine overall status
    const offlineCount = peers.filter((p) => !p.online).length;
    const highLatencyCount = peers.filter((p) => p.latencyMs > 200).length;

    let status: DiagnosticsResult["status"] = "healthy";
    if (offlineCount > peers.length / 2) {
      status = "disconnected";
    } else if (offlineCount > 0 || highLatencyCount > 0) {
      status = "degraded";
    }

    return {
      status,
      peers,
      latencyHistory: this.latencyHistory,
      issues,
    };
  }

  /**
   * Get latency graph data for a specific peer.
   */
  getLatencyGraph(peerId: string, points?: number): LatencyPoint[] {
    const history = this.latencyHistory.get(peerId) || [];
    return history.slice(-(points || 50));
  }

  /**
   * Get average latency for a peer over recent history.
   */
  getAverageLatency(peerId: string, windowMs: number = 60000): number {
    const history = this.latencyHistory.get(peerId) || [];
    const cutoff = Date.now() - windowMs;
    const recent = history.filter((p) => p.timestamp > cutoff);

    if (recent.length === 0) return 0;
    return recent.reduce((sum, p) => sum + p.latencyMs, 0) / recent.length;
  }

  /**
   * Record a latency measurement.
   */
  private recordLatency(peerId: string, latencyMs: number): void {
    if (!this.latencyHistory.has(peerId)) {
      this.latencyHistory.set(peerId, []);
    }

    const history = this.latencyHistory.get(peerId)!;
    history.push({ timestamp: Date.now(), latencyMs });

    // Trim to max size
    if (history.length > this.maxHistorySize) {
      history.splice(0, history.length - this.maxHistorySize);
    }
  }

  /**
   * Get peers from Tailscale status.
   */
  private async getPeers(): Promise<PeerInfo[]> {
    // In production, call tailscale status --json
    // Stub implementation
    return [];
  }
}
