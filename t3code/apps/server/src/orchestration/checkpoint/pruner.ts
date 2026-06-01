/**
 * Checkpoint snapshot pruning with retention policy.
 * Prevents unbounded growth of checkpoint storage.
 */

interface Checkpoint {
  id: string;
  timestamp: number;
  size: number;
  metadata: Record<string, unknown>;
}

interface RetentionConfig {
  /** Max number of checkpoints to keep (default: 100) */
  maxCheckpoints?: number;
  /** Max total size in bytes (default: 1GB) */
  maxTotalSize?: number;
  /** Max age in ms (default: 30 days) */
  maxAgeMs?: number;
  /** Min checkpoints to always keep (default: 5) */
  minKeep?: number;
}

export class CheckpointPruner {
  private config: Required<RetentionConfig>;

  constructor(config: RetentionConfig = {}) {
    this.config = {
      maxCheckpoints: config.maxCheckpoints || 100,
      maxTotalSize: config.maxTotalSize || 1024 * 1024 * 1024,
      maxAgeMs: config.maxAgeMs || 30 * 24 * 60 * 60 * 1000,
      minKeep: config.minKeep || 5,
    };
  }

  /**
   * Determine which checkpoints to prune.
   */
  prune(checkpoints: Checkpoint[]): Checkpoint[] {
    if (checkpoints.length <= this.config.minKeep) {
      return [];
    }

    const now = Date.now();
    const sorted = [...checkpoints].sort((a, b) => b.timestamp - a.timestamp);
    const toPrune: Checkpoint[] = [];

    // Always keep minKeep most recent
    const keep = sorted.slice(0, this.config.minKeep);
    const candidates = sorted.slice(this.config.minKeep);

    let totalSize = keep.reduce((sum, c) => sum + c.size, 0);

    for (const checkpoint of candidates) {
      const age = now - checkpoint.timestamp;

      // Prune if too old
      if (age > this.config.maxAgeMs) {
        toPrune.push(checkpoint);
        continue;
      }

      // Prune if over count limit
      if (keep.length + candidates.length - toPrune.length > this.config.maxCheckpoints) {
        toPrune.push(checkpoint);
        continue;
      }

      // Prune if over size limit
      if (totalSize + checkpoint.size > this.config.maxTotalSize) {
        toPrune.push(checkpoint);
        continue;
      }

      totalSize += checkpoint.size;
    }

    return toPrune;
  }
}
