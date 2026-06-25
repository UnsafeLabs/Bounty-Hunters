/**
 * OrchestrationEngineService - Service interface for orchestration command handling.
 *
 * Owns command validation/dispatch and in-memory read-model updates backed by
 * `OrchestrationEventStore` persistence. It does not own provider process
 * management or transport concerns (e.g. websocket request parsing).
 *
 * Uses Effect `Context.Service` for dependency injection. Command dispatch,
 * replay, and unknown-input decoding all return typed domain errors.
 *
 * @module OrchestrationEngineService
 */
import type { CommandId, OrchestrationCommand, OrchestrationEvent } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Stream from "effect/Stream";

import type { InterruptedCommandCheckpoint } from "../commandCheckpoint.ts";
import type { OrchestrationDispatchError } from "../Errors.ts";
import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";

/**
 * OrchestrationEngineShape - Service API for orchestration command and event flow.
 */
export interface OrchestrationEngineShape {
  /**
   * Replay persisted orchestration events from an exclusive sequence cursor.
   *
   * @param fromSequenceExclusive - Sequence cursor (exclusive).
   * @returns Stream containing ordered events.
   */
  readonly readEvents: (
    fromSequenceExclusive: number,
  ) => Stream.Stream<OrchestrationEvent, OrchestrationEventStoreError, never>;

  /**
   * Dispatch a validated orchestration command.
   *
   * @param command - Valid orchestration command.
   * @returns Effect containing the sequence of the persisted event.
   *
   * Dispatch is serialized through an internal queue and deduplicated via
   * command receipts.
   */
  readonly dispatch: (
    command: OrchestrationCommand,
  ) => Effect.Effect<{ sequence: number }, OrchestrationDispatchError, never>;

  /**
   * Stream persisted domain events in dispatch order.
   *
   * This is a hot runtime stream (new events only), not a historical replay.
   */
  readonly streamDomainEvents: Stream.Stream<OrchestrationEvent>;

  /**
   * Resume query: list commands whose processing fiber was interrupted before
   * completion, with the partial state captured at interruption time.
   *
   * A command appears here after its in-flight processing was interrupted (e.g.
   * shutdown or supervised cancellation) and disappears once it is successfully
   * resumed or otherwise re-dispatched.
   */
  readonly interruptedCommandCheckpoints: Effect.Effect<
    ReadonlyArray<InterruptedCommandCheckpoint>
  >;

  /**
   * Re-dispatch every checkpointed interrupted command, oldest-first. Replay is
   * idempotent via command receipts. Returns the command ids that completed and
   * those still pending (re-dispatch failed and the checkpoint was retained).
   */
  readonly resumeInterruptedCommands: Effect.Effect<{
    readonly resumed: ReadonlyArray<CommandId>;
    readonly remaining: ReadonlyArray<CommandId>;
  }>;
}

/**
 * OrchestrationEngineService - Service tag for orchestration engine access.
 *
 * @example
 * ```ts
 * const program = Effect.gen(function* () {
 *   const engine = yield* OrchestrationEngineService
 *   return yield* engine.dispatch(command)
 * })
 * ```
 */
export class OrchestrationEngineService extends Context.Service<
  OrchestrationEngineService,
  OrchestrationEngineShape
>()("t3/orchestration/Services/OrchestrationEngine/OrchestrationEngineService") {}
