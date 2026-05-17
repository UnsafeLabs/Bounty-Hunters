export class OrchestrationEngine {
  private fibers = new Map<string, Fiber>();
  private checkpoints = new Map<string, FiberState>();
  interrupt(fiberId: string): boolean {
    const f = this.fibers.get(fiberId);
    if (!f || f.state === "completed") return false;
    this.checkpoints.set(fiberId, { ...f.state, interruptedAt: Date.now() });
    f.state = "interrupted"; this.fibers.delete(fiberId); return true;
  }
  async restore(fiberId: string): Promise<boolean> {
    const cp = this.checkpoints.get(fiberId); if (!cp) return false;
    this.fibers.set(fiberId, { id: fiberId, state: cp.state, data: cp });
    this.checkpoints.delete(fiberId); return true;
  }
  getCheckpoint(fiberId: string): FiberState | undefined { return this.checkpoints.get(fiberId); }
  isInterrupted(fiberId: string): boolean { return !!this.checkpoints.get(fiberId) || this.fibers.get(fiberId)?.state === "interrupted"; }
}
interface Fiber { id: string; state: string; data?: any; }
interface FiberState { state: string; interruptedAt: number; [key: string]: any; }