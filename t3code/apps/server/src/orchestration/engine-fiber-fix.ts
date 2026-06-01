/**
 * Fix orchestration engine fiber interrupt handling.
 * Properly checks and handles fiber interrupts in sequential processing.
 */

import { Effect, Fiber, Runtime } from "effect";

interface Command {
  id: string;
  type: string;
  payload: unknown;
}

interface CommandResult {
  id: string;
  status: "completed" | "failed" | "interrupted";
  result?: unknown;
  error?: string;
}

export class OrchestrationEngine {
  private runningFibers: Map<string, Fiber.Fiber<unknown, Error>> = new Map();

  /**
   * Process commands with proper fiber interrupt checking.
   */
  async processCommands(commands: Command[]): Promise<CommandResult[]> {
    const results: CommandResult[] = [];

    for (const cmd of commands) {
      // Check if this command's fiber was interrupted
      const existing = this.runningFibers.get(cmd.id);
      if (existing) {
        const status = await Fiber.status(existing);
        if (status._tag === "Done") {
          // Already completed, skip
          results.push({ id: cmd.id, status: "completed" });
          continue;
        }
      }

      try {
        const fiber = await Effect.runFork(
          this.executeCommand(cmd)
        );
        this.runningFibers.set(cmd.id, fiber);

        const result = await Effect.runPromise(
          Fiber.join(fiber)
        );

        results.push({ id: cmd.id, status: "completed", result });
      } catch (error) {
        // Check if it was an interrupt
        if (error instanceof Error && error.message.includes("interrupted")) {
          results.push({ id: cmd.id, status: "interrupted" });
        } else {
          results.push({
            id: cmd.id,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } finally {
        this.runningFibers.delete(cmd.id);
      }
    }

    return results;
  }

  /**
   * Interrupt a running command.
   */
  async interruptCommand(commandId: string): Promise<boolean> {
    const fiber = this.runningFibers.get(commandId);
    if (!fiber) return false;

    await Effect.runPromise(Fiber.interrupt(fiber));
    this.runningFibers.delete(commandId);
    return true;
  }

  private executeCommand(cmd: Command): Effect.Effect<unknown, Error> {
    return Effect.tryPromise({
      try: async () => {
        // Command execution logic
        return { executed: true, type: cmd.type };
      },
      catch: (error) => error instanceof Error ? error : new Error(String(error)),
    });
  }
}
