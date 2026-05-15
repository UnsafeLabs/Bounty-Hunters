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
import type {
  OrchestrationCommand,
  OrchestrationEvent,
  OrchestrationReadModel,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type * as Stream from "effect/Stream";

import type { OrchestrationDispatchError } from "../Errors.ts";
import type { OrchestrationEventStoreError } from "../../persistence/Errors.ts";

export interface OrchestrationInterruptedCommandCheckpoint {
  readonly commandId: OrchestrationCommand["commandId"];
  readonly commandType: OrchestrationCommand["type"];
  readonly command: OrchestrationCommand;
  readonly aggregateKind: "project" | "thread";
  readonly aggregateId: ProjectId | ThreadId;
  readonly interruptedAt: string;
  readonly fiberId: number;
  readonly interruptingFiberIds: ReadonlyArray<number>;
  readonly reason: "dispatch-interrupted" | "processing-interrupted";
  readonly partialState: {
    readonly snapshotSequence: number;
    readonly readModel: OrchestrationReadModel;
  };
}

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
   * Read the latest interrupt checkpoint for a command, if command handling was
   * interrupted before the caller observed completion.
   */
  readonly getInterruptedCommandCheckpoint?: (
    commandId: OrchestrationCommand["commandId"],
  ) => Effect.Effect<Option.Option<OrchestrationInterruptedCommandCheckpoint>>;

  /**
   * Re-dispatch the command stored in an interrupt checkpoint.
   *
   * Normal command receipt deduplication makes this safe after the original
   * command eventually commits; reconnecting callers receive the accepted
   * sequence instead of duplicating domain events.
   */
  readonly resumeInterruptedCommand?: (
    commandId: OrchestrationCommand["commandId"],
  ) => Effect.Effect<Option.Option<{ sequence: number }>, OrchestrationDispatchError, never>;

  /**
   * Stream persisted domain events in dispatch order.
   *
   * This is a hot runtime stream (new events only), not a historical replay.
   */
  readonly streamDomainEvents: Stream.Stream<OrchestrationEvent>;
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
