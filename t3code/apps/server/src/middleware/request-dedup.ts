/**
 * Request-scoped deduplication for identical concurrent requests.
 * Prevents multiple identical API calls from executing simultaneously.
 */

import { createHash } from "crypto";

interface DedupEntry {
  promise: Promise<unknown>;
  timestamp: number;
  hitCount: number;
}

interface DedupConfig {
  /** Window in ms to consider requests identical (default: 5000) */
  windowMs?: number;
  /** Max entries before cleanup (default: 1000) */
  maxEntries?: number;
  /** Cleanup interval in ms (default: 60000) */
  cleanupIntervalMs?: number;
}

export class RequestDeduplicator {
  private pending: Map<string, DedupEntry> = new Map();
  private config: Required<DedupConfig>;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DedupConfig = {}) {
    this.config = {
      windowMs: config.windowMs || 5000,
      maxEntries: config.maxEntries || 1000,
      cleanupIntervalMs: config.cleanupIntervalMs || 60000,
    };
    this.startCleanup();
  }

  /**
   * Execute a request with deduplication.
   * If an identical request is already in-flight, return its result.
   */
  async deduplicate<T>(
    key: string,
    executor: () => Promise<T>
  ): Promise<T> {
    const hash = this.hashKey(key);
    const now = Date.now();

    // Check for existing in-flight request
    const existing = this.pending.get(hash);
    if (existing && now - existing.timestamp < this.config.windowMs) {
      existing.hitCount++;
      return existing.promise as Promise<T>;
    }

    // Execute new request
    const promise = executor().finally(() => {
      // Clean up after completion
      setTimeout(() => {
        this.pending.delete(hash);
      }, this.config.windowMs);
    });

    this.pending.set(hash, {
      promise,
      timestamp: now,
      hitCount: 0,
    });

    return promise;
  }

  /**
   * Generate dedup key from request parameters.
   */
  static makeKey(method: string, url: string, body?: unknown): string {
    const parts = [method, url];
    if (body) {
      parts.push(JSON.stringify(body));
    }
    return parts.join("|");
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  }

  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.pending.entries()) {
        if (now - entry.timestamp > this.config.windowMs * 2) {
          this.pending.delete(key);
        }
      }
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Get stats for monitoring.
   */
  stats(): { pending: number; totalHits: number } {
    let totalHits = 0;
    for (const entry of this.pending.values()) {
      totalHits += entry.hitCount;
    }
    return { pending: this.pending.size, totalHits };
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.pending.clear();
  }
}
