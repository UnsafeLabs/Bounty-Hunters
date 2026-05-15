import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import {
  InterruptCheckpointError,
  InterruptCheckpointService,
  type InterruptCheckpointServiceShape,
  type InterruptedCommand,
} from "../Services/InterruptCheckpointService.ts";

const toError = (message: string) => (cause: unknown) =>
  new InterruptCheckpointError(message, cause);

export const makeInterruptCheckpointService = Effect.gen(function* () {
  const storeRef = yield* Ref.make(new Map<string, InterruptedCommand>());

  const saveInterruptedState: InterruptCheckpointServiceShape["saveInterruptedState"] = (
    command,
  ) =>
    Ref.update(storeRef, (store) => {
      const next = new Map(store);
      next.set(command.commandId, command);
      return next;
    }).pipe(
      Effect.tap(() =>
        Effect.logInfo("Saved interrupted command state").pipe(
          Effect.annotateLogs({
            commandId: command.commandId,
            reason: command.reason,
            fiberId: command.fiberId,
          }),
        ),
      ),
      Effect.mapError(toError("Failed to save interrupted state")),
    );

  const getInterruptedCommand: InterruptCheckpointServiceShape["getInterruptedCommand"] = (
    commandId,
  ) =>
    Ref.get(storeRef).pipe(
      Effect.map((store) => store.get(commandId) ?? null),
      Effect.mapError(toError("Failed to get interrupted command")),
    );

  const listInterrupted: InterruptCheckpointServiceShape["listInterrupted"] = (
    aggregateId,
  ) =>
    Ref.get(storeRef).pipe(
      Effect.map((store) =>
        Array.from(store.values()).filter((c) => c.aggregateId === aggregateId),
      ),
      Effect.mapError(toError("Failed to list interrupted commands")),
    );

  const clearInterrupted: InterruptCheckpointServiceShape["clearInterrupted"] = (
    commandId,
  ) =>
    Ref.update(storeRef, (store) => {
      const next = new Map(store);
      next.delete(commandId);
      return next;
    }).pipe(Effect.mapError(toError("Failed to clear interrupted command")));

  return {
    saveInterruptedState,
    getInterruptedCommand,
    listInterrupted,
    clearInterrupted,
  } satisfies InterruptCheckpointServiceShape;
});

export const InterruptCheckpointServiceLive = Layer.effect(
  InterruptCheckpointService,
  makeInterruptCheckpointService,
);
