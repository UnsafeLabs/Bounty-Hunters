import { Effect, Schema, Schedule, Ref, Layer } from "effect";

export const ScheduledCommand = Schema.Struct({
  commandId: Schema.String,
  scheduledAt: Schema.String, 
  repeatInterval: Schema.optional(Schema.Number), 
  maxRetries: Schema.Number,
  payload: Schema.Unknown,
  status: Schema.Union(
    Schema.Literal("pending"),
    Schema.Literal("running"),
    Schema.Literal("completed"),
    Schema.Literal("failed"),
    Schema.Literal("cancelled")
  ),
  attempts: Schema.Number,
  createdAt: Schema.String,
});

export type ScheduledCommandType = Schema.Schema.Type<typeof ScheduledCommand>;

export interface ScheduleStorage {
  store(cmd: ScheduledCommandType): Effect.Effect<void, never>;
  getNext(): Effect.Effect<ScheduledCommandType | null, never>;
  updateStatus(id: string, status: ScheduledCommandType["status"]): Effect.Effect<void, never>;
  incrementAttempts(id: string): Effect.Effect<void, never>;
  listPending(): Effect.Effect<ReadonlyArray<ScheduledCommandType>, never>;
}

export const SchedulerService = Effect.gen(function* (_) {
  const queue = yield* _(Ref.make<Map<string, ScheduledCommandType>>(new Map()));
  const timers = yield* _(Ref.make<Map<string, ReturnType<typeof setTimeout>>>(new Map()));

  const scheduleCommand = (cmd: Omit<ScheduledCommandType, "status" | "attempts" | "createdAt">) =>
    Effect.gen(function* (_) {
      const now = new Date();
      const record: ScheduledCommandType = {
        ...cmd,
        status: "pending",
        attempts: 0,
        createdAt: now.toISOString(),
      };

      yield* _(Ref.update(queue, (m) => {
        const next = new Map(m);
        next.set(cmd.commandId, record);
        return next;
      }));

      // Calculate delay until scheduled time
      const scheduledTime = new Date(cmd.scheduledAt).getTime();
      const delay = Math.max(0, scheduledTime - now.getTime());

      // Set up one-time or repeating timer
      if (cmd.repeatInterval) {
        const timer = setInterval(() => {
          Effect.runSync(executeCommand(cmd.commandId));
        }, cmd.repeatInterval);
        yield* _(Ref.update(timers, (m) => {
          const next = new Map(m);
          next.set(cmd.commandId, timer);
          return next;
        }));
      } else {
        const timer = setTimeout(() => {
          Effect.runSync(executeCommand(cmd.commandId));
        }, delay);
        yield* _(Ref.update(timers, (m) => {
          const next = new Map(m);
          next.set(cmd.commandId, timer);
          return next;
        }));
      }

      return record;
    });

  const executeCommand = (commandId: string) =>
    Effect.gen(function* (_) {
      const q = yield* _(Ref.get(queue));
      const cmd = q.get(commandId);
      if (!cmd || cmd.status === "cancelled") return;

      yield* _(Ref.update(queue, (m) => {
        const next = new Map(m);
        const existing = next.get(commandId);
        if (existing) {
          next.set(commandId, {
            ...existing,
            status: "running",
            attempts: existing.attempts + 1,
          });
        }
        return next;
      }));

      // Mark as completed (actual execution logic would go here)
      yield* _(Ref.update(queue, (m) => {
        const next = new Map(m);
        const existing = next.get(commandId);
        if (existing && existing.status === "running") {
          next.set(commandId, {
            ...existing,
            status: existing.repeatInterval ? "pending" : "completed",
          });
        }
        return next;
      }));
    });

  const cancelCommand = (commandId: string) =>
    Effect.gen(function* (_) {
      // Clear timer
      const t = yield* _(Ref.get(timers));
      const timer = t.get(commandId);
      if (timer) {
        clearInterval(timer as ReturnType<typeof setInterval>);
        clearTimeout(timer as ReturnType<typeof setTimeout>);
        yield* _(Ref.update(timers, (m) => {
          const next = new Map(m);
          next.delete(commandId);
          return next;
        }));
      }

      yield* _(Ref.update(queue, (m) => {
        const next = new Map(m);
        const existing = next.get(commandId);
        if (existing) next.set(commandId, { ...existing, status: "cancelled" });
        return next;
      }));
    });

  const getPending = Effect.gen(function* (_) {
    const q = yield* _(Ref.get(queue));
    return [...q.values()].filter((c) => c.status === "pending");
  });

  const getCommand = (commandId: string) =>
    Effect.gen(function* (_) {
      const q = yield* _(Ref.get(queue));
      return q.get(commandId) || null;
    });

  return { scheduleCommand, cancelCommand, getPending, getCommand };
});

export const SchedulerServiceLayer = Layer.effect(SchedulerService, SchedulerService);
