import { CommandId, ThreadId, type OrchestrationCommand } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { expect } from "vitest";

import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { OrchestrationCommandInvariantError } from "./Errors.ts";
import {
  SchedulerService,
  SchedulerServiceLive,
  parseRepeatIntervalMillis,
} from "./SchedulerService.ts";
import {
  OrchestrationEngineService,
  type OrchestrationEngineShape,
} from "./Services/OrchestrationEngine.ts";

interface DispatchState {
  readonly commands: OrchestrationCommand[];
  readonly failures: OrchestrationCommandInvariantError[];
}

function makeState(): DispatchState {
  return {
    commands: [],
    failures: [],
  };
}

function command(commandId: string): OrchestrationCommand {
  return {
    type: "thread.session.stop",
    commandId: CommandId.make(commandId),
    threadId: ThreadId.make("thread-1"),
    createdAt: "1970-01-01T00:00:00.000Z",
  };
}

function makeEngineLayer(state: DispatchState) {
  const engine: OrchestrationEngineShape = {
    readEvents: () => Stream.empty,
    dispatch: (nextCommand) =>
      Effect.gen(function* () {
        state.commands.push(nextCommand);
        const failure = state.failures.shift();
        if (failure) {
          return yield* failure;
        }
        return { sequence: state.commands.length };
      }),
    streamDomainEvents: Stream.empty,
  };
  return Layer.succeed(OrchestrationEngineService, engine);
}

function schedulerLayer(state: DispatchState, persistenceLayer = SqlitePersistenceMemory) {
  return SchedulerServiceLive.pipe(
    Layer.provide(makeEngineLayer(state)),
    Layer.provideMerge(persistenceLayer),
    Layer.provideMerge(TestClock.layer()),
  );
}

const drain = Effect.gen(function* () {
  yield* Effect.yieldNow;
  yield* Effect.yieldNow;
});

const advance = (duration: Duration.Input) =>
  Effect.gen(function* () {
    yield* drain;
    yield* TestClock.adjust(duration);
    yield* drain;
  });

function getRecordStatus(commandId: CommandId) {
  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    const row = yield* scheduler.get(commandId);
    return Option.match(row, {
      onNone: () => null,
      onSome: (value) => value.status,
    });
  });
}

it.effect("parses fixed, ISO, and cron-like repeat intervals", () =>
  Effect.sync(() => {
    expect(parseRepeatIntervalMillis("100 millis")).toBe(100);
    expect(parseRepeatIntervalMillis("PT2S")).toBe(2_000);
    expect(parseRepeatIntervalMillis("*/5 * * * *")).toBe(300_000);
    expect(parseRepeatIntervalMillis("*/10 * * * * *")).toBe(10_000);
  }),
);

it.effect("runs a one-time scheduled command only after its scheduledAt time", () => {
  const state = makeState();
  const nextCommand = command("cmd-scheduled-once");

  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    yield* scheduler.schedule({
      commandId: nextCommand.commandId,
      command: nextCommand,
      scheduledAt: "1970-01-01T00:00:01.000Z",
      maxRetries: 0,
    });

    yield* advance(Duration.millis(999));
    expect(state.commands).toHaveLength(0);

    yield* advance(Duration.millis(1));
    expect(state.commands.map((dispatched) => dispatched.commandId)).toEqual([
      nextCommand.commandId,
    ]);
    expect(yield* getRecordStatus(nextCommand.commandId)).toBe("completed");
  }).pipe(Effect.provide(schedulerLayer(state)));
});

it.effect("cancels a pending command without dispatching it", () => {
  const state = makeState();
  const nextCommand = command("cmd-cancelled");

  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    yield* scheduler.schedule({
      commandId: nextCommand.commandId,
      command: nextCommand,
      scheduledAt: "1970-01-01T00:00:01.000Z",
      maxRetries: 0,
    });
    yield* scheduler.cancel(nextCommand.commandId);

    yield* advance(Duration.seconds(2));
    expect(state.commands).toHaveLength(0);
    expect(yield* getRecordStatus(nextCommand.commandId)).toBe("cancelled");
  }).pipe(Effect.provide(schedulerLayer(state)));
});

it.effect("reschedules without inserting a duplicate row", () => {
  const state = makeState();
  const nextCommand = command("cmd-rescheduled");

  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    const sql = yield* SqlClient.SqlClient;
    yield* scheduler.schedule({
      commandId: nextCommand.commandId,
      command: nextCommand,
      scheduledAt: "1970-01-01T00:00:01.000Z",
      maxRetries: 0,
    });
    yield* scheduler.reschedule({
      commandId: nextCommand.commandId,
      scheduledAt: "1970-01-01T00:00:02.000Z",
    });

    yield* advance(Duration.millis(1_500));
    expect(state.commands).toHaveLength(0);

    const rows = yield* sql`
      SELECT COUNT(*) AS count
      FROM scheduled_commands
      WHERE command_id = ${nextCommand.commandId}
    `;
    expect((rows[0] as { readonly count: number } | undefined)?.count).toBe(1);

    yield* advance(Duration.millis(500));
    expect(state.commands.map((dispatched) => dispatched.commandId)).toEqual([
      nextCommand.commandId,
    ]);
  }).pipe(Effect.provide(schedulerLayer(state)));
});

it.effect("retries failed dispatches with exponential backoff up to maxRetries", () => {
  const state = makeState();
  const nextCommand = command("cmd-retry");
  state.failures.push(
    new OrchestrationCommandInvariantError({
      commandType: nextCommand.type,
      detail: "first transient failure",
    }),
    new OrchestrationCommandInvariantError({
      commandType: nextCommand.type,
      detail: "second transient failure",
    }),
  );

  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    yield* scheduler.schedule({
      commandId: nextCommand.commandId,
      command: nextCommand,
      scheduledAt: "1970-01-01T00:00:00.000Z",
      maxRetries: 2,
    });

    yield* drain;
    expect(state.commands).toHaveLength(1);

    yield* advance(Duration.millis(100));
    expect(state.commands).toHaveLength(2);

    yield* advance(Duration.millis(200));
    expect(state.commands).toHaveLength(3);
    expect(yield* getRecordStatus(nextCommand.commandId)).toBe("completed");
  }).pipe(Effect.provide(schedulerLayer(state)));
});

it.effect("runs recurring commands on the configured interval with unique dispatch ids", () => {
  const state = makeState();
  const nextCommand = command("cmd-recurring");

  return Effect.gen(function* () {
    const scheduler = yield* SchedulerService;
    yield* scheduler.schedule({
      commandId: nextCommand.commandId,
      command: nextCommand,
      scheduledAt: "1970-01-01T00:00:01.000Z",
      repeatInterval: "100 millis",
      maxRetries: 0,
    });

    yield* advance(Duration.seconds(1));
    expect(state.commands.map((dispatched) => dispatched.commandId)).toEqual([
      CommandId.make("cmd-recurring"),
    ]);

    yield* advance(Duration.millis(100));
    expect(state.commands.map((dispatched) => dispatched.commandId)).toEqual([
      CommandId.make("cmd-recurring"),
      CommandId.make("cmd-recurring:run:2"),
    ]);

    yield* scheduler.cancel(nextCommand.commandId);
  }).pipe(Effect.provide(schedulerLayer(state)));
});

it.effect("bootstraps pending commands from SQLite when the service starts", () => {
  const state = makeState();
  const nextCommand = command("cmd-bootstrap");
  const seedPersistence = Layer.effectDiscard(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // @effect-diagnostics-next-line preferSchemaOverJson:off
      const commandJson = JSON.stringify(nextCommand);
      yield* sql`
        INSERT INTO scheduled_commands (
          command_id,
          command_json,
          scheduled_at,
          repeat_interval,
          max_retries,
          retry_count,
          run_count,
          status,
          last_error,
          created_at,
          updated_at
        )
        VALUES (
          ${nextCommand.commandId},
          ${commandJson},
          '1970-01-01T00:00:01.000Z',
          NULL,
          0,
          0,
          0,
          'pending',
          NULL,
          '1970-01-01T00:00:00.000Z',
          '1970-01-01T00:00:00.000Z'
        )
      `;
    }),
  ).pipe(Layer.provideMerge(SqlitePersistenceMemory));

  return Effect.gen(function* () {
    yield* SchedulerService;
    yield* advance(Duration.seconds(1));
    expect(state.commands.map((dispatched) => dispatched.commandId)).toEqual([
      nextCommand.commandId,
    ]);
  }).pipe(Effect.provide(schedulerLayer(state, seedPersistence)));
});
