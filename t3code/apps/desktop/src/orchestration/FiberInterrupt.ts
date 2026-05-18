import { Effect, Fiber, Ref, Schedule } from "effect";

/**
 * Fix: Orchestration engine fiber interrupt not checking cancellation (#818)
 *
 * Problem: When a fiber is interrupted, the orchestration engine
 * continues running dependent steps instead of propagating cancellation.
 *
 * Solution: Cancellation-aware fiber supervisor with interrupt
 * propagation and cleanup.
 */

export interface FiberTask {
  id: string;
  fiber: Fiber.RuntimeFiber<unknown, unknown>;
  dependencies: string[];
  cancelOnDepFailure: boolean;
}

export class FiberInterruptSupervisor implements Effect.Effect {
  readonly _tag = "FiberInterruptSupervisor";

  constructor(
    private readonly tasksRef: Ref.Ref<Map<string, FiberTask>>,
    private readonly cancelledRef: Ref.Ref<Set<string>>
  ) {}

  static make = Effect.gen(function* (_) {
    const tasksRef = yield* _(Ref.make(new Map<string, FiberTask>()));
    const cancelledRef = yield* _(Ref.make(new Set<string>()));
    return new FiberInterruptSupervisor(tasksRef, cancelledRef);
  });

  spawn = <A, E>(
    id: string,
    effect: Effect.Effect<A, E>,
    options: { dependencies?: string[]; cancelOnDepFailure?: boolean } = {}
  ) =>
    Effect.gen(function* (_) {
      // Check cancellation before starting
      const cancelled = yield* _(Ref.get(cancelledRef));
      if (cancelled.has(id)) {
        return yield* _(Effect.fail(new Error(`Task ${id} was cancelled before start`)));
      }

      // Check if dependencies were cancelled
      const deps = options.dependencies || [];
      for (const dep of deps) {
        if (cancelled.has(dep)) {
          yield* _(Ref.update(cancelledRef, (s) => new Set([...s, id])));
          return yield* _(Effect.fail(new Error(`Dependency ${dep} was cancelled`)));
        }
      }

      const fiber = yield* _(
        Effect.fork(
          effect.pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* (_) {
                yield* _(Ref.update(cancelledRef, (s) => new Set([...s, id])));
                yield* _(cancelDependents(id));
              })
            )
          )
        )
      );

      yield* _(
        Ref.update(tasksRef, (m) =>
          new Map(m).set(id, {
            id,
            fiber,
            dependencies: deps,
            cancelOnDepFailure: options.cancelOnDepFailure ?? true,
          })
        )
      );

      return fiber;
    });

  cancel = (id: string) =>
    Effect.gen(function* (_) {
      const tasks = yield* _(Ref.get(tasksRef));
      const task = tasks.get(id);

      if (task) {
        yield* _(Fiber.interrupt(task.fiber));
        yield* _(Ref.update(cancelledRef, (s) => new Set([...s, id])));
        yield* _(this.cancelDependents(id));
      }
    });

  private cancelDependents = (parentId: string) =>
    Effect.gen(function* (_) {
      const tasks = yield* _(Ref.get(tasksRef));
      for (const [id, task] of tasks) {
        if (task.dependencies.includes(parentId) && task.cancelOnDepFailure) {
          yield* _(this.cancel(id));
        }
      }
    });

  isCancelled = (id: string) =>
    Effect.gen(function* (_) {
      const cancelled = yield* _(Ref.get(cancelledRef));
      return cancelled.has(id);
    });
}
