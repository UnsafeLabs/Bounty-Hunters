/**
 * Snapshot pruning with retention window and per-session keep-N (issue #838).
 */

export const DEFAULT_RETENTION_DAYS = 7;
export const DEFAULT_KEEP_PER_SESSION = 3;
export const DEFAULT_SCHEDULE_MS = 60 * 60 * 1000; // 1 hour

export interface SnapshotMeta {
  id: string;
  sessionId: string;
  createdAt: number; // epoch ms
  sizeBytes: number;
}

export interface PruneOptions {
  retentionDays?: number;
  keepPerSession?: number;
  now?: number;
}

export interface PruneResult {
  snapshots_deleted: number;
  bytes_freed: number;
  duration_ms: number;
  deletedIds: string[];
  keptIds: string[];
}

/**
 * Decide which snapshots to delete.
 * - Always keep the newest `keepPerSession` per sessionId.
 * - Among the rest, delete those older than retentionDays.
 */
export function selectSnapshotsToPrune(
  snapshots: readonly SnapshotMeta[],
  options: PruneOptions = {},
): { deleteIds: Set<string>; keepIds: Set<string> } {
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const keepPerSession = options.keepPerSession ?? DEFAULT_KEEP_PER_SESSION;
  const now = options.now ?? Date.now();
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;

  const bySession = new Map<string, SnapshotMeta[]>();
  for (const s of snapshots) {
    const list = bySession.get(s.sessionId) ?? [];
    list.push(s);
    bySession.set(s.sessionId, list);
  }

  const protectedIds = new Set<string>();
  for (const list of bySession.values()) {
    list
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, keepPerSession)
      .forEach((s) => protectedIds.add(s.id));
  }

  const deleteIds = new Set<string>();
  const keepIds = new Set<string>();
  for (const s of snapshots) {
    if (protectedIds.has(s.id)) {
      keepIds.add(s.id);
      continue;
    }
    if (s.createdAt < cutoff) {
      deleteIds.add(s.id);
    } else {
      keepIds.add(s.id);
    }
  }
  return { deleteIds, keepIds };
}

export class CheckpointPruner {
  constructor(
    private readonly store: {
      list(): SnapshotMeta[] | Promise<SnapshotMeta[]>;
      deleteMany(ids: string[]): number | Promise<number>;
      sizeOf?(id: string): number;
    },
  ) {}

  async prune(options: PruneOptions = {}): Promise<PruneResult> {
    const started = Date.now();
    const snapshots = await this.store.list();
    const { deleteIds, keepIds } = selectSnapshotsToPrune(snapshots, options);
    const sizeMap = new Map(snapshots.map((s) => [s.id, s.sizeBytes]));
    let bytes = 0;
    for (const id of deleteIds) {
      bytes += sizeMap.get(id) ?? this.store.sizeOf?.(id) ?? 0;
    }
    const deleted = deleteIds.size
      ? await this.store.deleteMany([...deleteIds])
      : 0;
    return {
      snapshots_deleted: typeof deleted === "number" ? deleted : deleteIds.size,
      bytes_freed: bytes,
      duration_ms: Date.now() - started,
      deletedIds: [...deleteIds],
      keptIds: [...keepIds],
    };
  }
}

/** CLI-shaped helper: parse --days and run prune. */
export function parsePruneDays(argv: string[], fallback = DEFAULT_RETENTION_DAYS): number {
  const idx = argv.findIndex((a) => a === "--days" || a === "-d");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error("--days must be a non-negative number");
    }
    return n;
  }
  return fallback;
}

export function formatPruneReport(result: PruneResult): string {
  return [
    `snapshots_deleted=${result.snapshots_deleted}`,
    `bytes_freed=${result.bytes_freed}`,
    `duration_ms=${result.duration_ms}`,
  ].join(" ");
}
