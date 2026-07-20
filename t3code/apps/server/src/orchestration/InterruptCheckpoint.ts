/**
 * Checkpoint partial orchestration state on fiber interrupt (issue #818).
 */

export interface PartialCommandState {
  commandId: string;
  fiberId?: string;
  phase: string;
  partialPayload?: unknown;
  updatedAt: number;
}

export interface InterruptLog {
  commandId: string;
  fiberId?: string;
  reason: string;
  timestamp: number;
}

export interface CheckpointStore {
  saveInterrupted(state: PartialCommandState): void | Promise<void>;
  getInterrupted(commandId: string): PartialCommandState | undefined | Promise<PartialCommandState | undefined>;
  listInterrupted(): PartialCommandState[] | Promise<PartialCommandState[]>;
}

export class MemoryCheckpointStore implements CheckpointStore {
  private rows = new Map<string, PartialCommandState>();
  saveInterrupted(state: PartialCommandState): void {
    this.rows.set(state.commandId, { ...state });
  }
  getInterrupted(commandId: string): PartialCommandState | undefined {
    const r = this.rows.get(commandId);
    return r ? { ...r } : undefined;
  }
  listInterrupted(): PartialCommandState[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

export type LogFn = (event: string, fields: Record<string, unknown>) => void;

/**
 * Wrap a command runner so interruption checkpoints partial state.
 * Mirrors Effect.onInterrupt behavior with AbortSignal / throw.
 */
export async function runWithInterruptCheckpoint<T>(input: {
  commandId: string;
  fiberId?: string;
  getPartial: () => PartialCommandState["partialPayload"];
  phase: () => string;
  store: CheckpointStore;
  log?: LogFn;
  signal?: AbortSignal;
  run: () => Promise<T>;
  now?: () => number;
}): Promise<T> {
  const now = input.now ?? Date.now;
  const onAbort = async (reason: string) => {
    const state: PartialCommandState = {
      commandId: input.commandId,
      fiberId: input.fiberId,
      phase: input.phase(),
      partialPayload: input.getPartial(),
      updatedAt: now(),
    };
    await input.store.saveInterrupted(state);
    input.log?.("orchestration.command.interrupted", {
      commandId: input.commandId,
      fiberId: input.fiberId,
      reason,
      timestamp: state.updatedAt,
      phase: state.phase,
    });
  };

  if (input.signal?.aborted) {
    await onAbort("already-aborted");
    throw new DOMException("Aborted", "AbortError");
  }

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
  };
  input.signal?.addEventListener("abort", abortHandler, { once: true });

  try {
    const result = await input.run();
    if (aborted || input.signal?.aborted) {
      await onAbort(input.signal?.reason ? String(input.signal.reason) : "abort");
      throw new DOMException("Aborted", "AbortError");
    }
    return result;
  } catch (err) {
    const isAbort =
      aborted ||
      input.signal?.aborted ||
      (err instanceof Error && (err.name === "AbortError" || /interrupt/i.test(err.message)));
    if (isAbort) {
      await onAbort(err instanceof Error ? err.message : "interrupt");
    }
    throw err;
  } finally {
    input.signal?.removeEventListener("abort", abortHandler);
  }
}

export async function resumeInterrupted(
  store: CheckpointStore,
  commandId: string,
): Promise<PartialCommandState | undefined> {
  return store.getInterrupted(commandId);
}
