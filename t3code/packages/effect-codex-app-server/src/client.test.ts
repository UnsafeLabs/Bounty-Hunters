import * as Exit from "effect/Exit";
import * as Duration from "effect/Duration";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexClient from "./client.ts";
import * as CodexError from "./errors.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/codex-app-server-mock-peer.ts"),
);
const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const decodeJson = Schema.decodeEffect(Schema.UnknownFromJsonString);
const encoder = new TextEncoder();

const encodeJsonl = (value: unknown) => encoder.encode(`${encodeUnknownJsonString(value)}\n`);

const turnStartParams = {
  threadId: "thread-1",
  input: [
    {
      type: "text" as const,
      text: "Generate a concise answer.",
    },
  ],
};

const turn = (status: "completed" | "interrupted" | "failed" | "inProgress") => ({
  id: "turn-1",
  items: [],
  status,
});

const turnStartResponse = {
  turn: turn("completed"),
};

const takeJsonOutput = (output: Queue.Dequeue<string>) =>
  Queue.take(output).pipe(Effect.flatMap(decodeJson));

it.layer(NodeServices.layer)("effect-codex-app-server client", (it) => {
  const makeHandle = () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const command = ChildProcess.make("bun", ["run", yield* mockPeerPath], {
        cwd: path.join(import.meta.dirname, ".."),
        shell: process.platform === "win32",
      });
      return yield* spawner.spawn(command);
    });

  it.effect("initializes, handles typed server requests, and reads account and skills data", () =>
    Effect.gen(function* () {
      const userInputRequests = yield* Ref.make<Array<unknown>>([]);
      const messageDeltas = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const result = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.handleServerRequest("item/tool/requestUserInput", (payload) =>
          Ref.update(userInputRequests, (current) => [...current, payload]).pipe(
            Effect.as({
              answers: {
                approved: {
                  answers: ["yes"],
                },
              },
            }),
          ),
        );

        yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
          Ref.update(messageDeltas, (current) => [...current, payload]),
        );

        const initialized = yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
        assert.equal(initialized.userAgent, "mock-codex-app-server");

        yield* client.notify("initialized", undefined);

        const account = yield* client.request("account/read", {});
        assert.equal(account.requiresOpenaiAuth, false);
        assert.deepEqual(account.account, {
          type: "chatgpt",
          email: "mock@example.com",
          planType: "plus",
        });

        const skills = yield* client.request("skills/list", {
          cwds: [process.cwd()],
        });
        assert.equal(skills.data.length, 1);
        assert.equal(skills.data[0]?.cwd, process.cwd());

        return {
          account,
          skills,
        };
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.equal(result.skills.data[0]?.skills.length, 0);
      assert.deepEqual(yield* Ref.get(userInputRequests), [
        {
          itemId: "item-approval-1",
          threadId: "thread-1",
          turnId: "turn-1",
          questions: [
            {
              id: "approved",
              header: "Approve",
              question: "Continue with the mock skills request?",
              options: [
                {
                  label: "yes",
                  description: "Approve the request",
                },
              ],
            },
          ],
        },
      ]);
      assert.deepEqual(yield* Ref.get(messageDeltas), [
        {
          delta: "Mock server is ready.",
          itemId: "item-1",
          threadId: "thread-1",
          turnId: "turn-1",
        },
      ]);
    }),
  );

  it.effect("initializes a command-backed app-server client", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerCommand({
        command: "bun",
        args: ["run", yield* mockPeerPath],
        cwd: path.join(import.meta.dirname, ".."),
      });
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const initialized = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return yield* client.request("initialize", {
          clientInfo: {
            name: "effect-codex-app-server-test",
            title: "Effect Codex App Server Test",
            version: "0.0.0",
          },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: null,
          },
        });
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.equal(initialized.userAgent, "mock-codex-app-server");
    }),
  );

  it.effect("streams turn events in order and preserves the non-streaming response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const client = yield* CodexClient.make(stdio);

        const streamFiber = yield* client
          .streamTurn(turnStartParams, {
            chunkTimeoutAfter: "5 seconds",
            chunkWarningAfter: "1 second",
            queueCapacity: 2,
          })
          .pipe(Stream.runCollect, Effect.forkScoped);

        const startRequest = (yield* takeJsonOutput(output)) as {
          readonly id: number;
          readonly method: string;
          readonly params: unknown;
        };
        assert.deepEqual(startRequest, {
          id: 1,
          method: "turn/start",
          params: turnStartParams,
        });

        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "turn/started",
            params: {
              threadId: "thread-1",
              turn: turn("inProgress"),
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "item/agentMessage/delta",
            params: {
              delta: "Hello",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "item/agentMessage/delta",
            params: {
              delta: " world",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "turn/completed",
            params: {
              threadId: "thread-1",
              turn: turn("completed"),
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: startRequest.id,
            result: turnStartResponse,
          }),
        );

        const events = yield* Fiber.join(streamFiber);
        assert.deepEqual(
          events.map((event) => event._tag),
          [
            "TurnStarted",
            "AgentMessageDelta",
            "AgentMessageDelta",
            "TurnCompleted",
            "TurnStartResponse",
          ],
        );
        assert.deepEqual(
          events
            .filter((event) => event._tag === "AgentMessageDelta")
            .map((event) => event.textDelta),
          ["Hello", " world"],
        );
        assert.deepEqual(events.at(-1), {
          _tag: "TurnStartResponse",
          method: "turn/start",
          response: turnStartResponse,
        });

        const nonStreamingFiber = yield* client
          .request("turn/start", turnStartParams)
          .pipe(Effect.forkScoped);
        const nonStreamingRequest = (yield* takeJsonOutput(output)) as { readonly id: number };
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: nonStreamingRequest.id,
            result: turnStartResponse,
          }),
        );
        assert.deepEqual(yield* Fiber.join(nonStreamingFiber), turnStartResponse);
      }),
    ),
  );

  it.effect("applies backpressure through a bounded stream queue", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const client = yield* CodexClient.make(stdio);
        const observedDeltas = yield* Ref.make<Array<string>>([]);

        const streamFiber = yield* client
          .streamTurn(turnStartParams, {
            chunkTimeoutAfter: "5 seconds",
            chunkWarningAfter: "1 second",
            queueCapacity: 1,
          })
          .pipe(
            Stream.runForEach(() => Effect.sleep(Duration.millis(1_000))),
            Effect.forkScoped,
          );

        yield* client.handleServerNotification("item/agentMessage/delta", (payload) =>
          Ref.update(observedDeltas, (current) => [...current, payload.delta]),
        );

        const startRequest = (yield* takeJsonOutput(output)) as { readonly id: number };
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "turn/started",
            params: {
              threadId: "thread-1",
              turn: turn("inProgress"),
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "item/agentMessage/delta",
            params: {
              delta: "one",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "item/agentMessage/delta",
            params: {
              delta: "two",
              itemId: "item-1",
              threadId: "thread-1",
              turnId: "turn-1",
            },
          }),
        );
        yield* Effect.yieldNow;
        assert.deepEqual(yield* Ref.get(observedDeltas), ["one"]);

        yield* TestClock.adjust(Duration.millis(1_000));
        yield* Effect.yieldNow;
        assert.deepEqual(yield* Ref.get(observedDeltas), ["one", "two"]);

        yield* Queue.offer(
          input,
          encodeJsonl({
            id: startRequest.id,
            result: turnStartResponse,
          }),
        );
        yield* TestClock.adjust(Duration.millis(3_000));
        yield* Fiber.join(streamFiber);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );

  it.effect("emits a warning event before failing an idle stream", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stdio, output } = yield* makeInMemoryStdio();
        const client = yield* CodexClient.make(stdio);

        const streamFiber = yield* client
          .streamTurn(turnStartParams, {
            chunkTimeoutAfter: "4 seconds",
            chunkWarningAfter: "1 second",
          })
          .pipe(Stream.runCollect, Effect.forkScoped);

        yield* takeJsonOutput(output);
        yield* TestClock.adjust(Duration.millis(1_000));
        yield* TestClock.adjust(Duration.millis(3_000));

        const error = yield* Fiber.join(streamFiber).pipe(Effect.flip);
        assert.instanceOf(error, CodexError.CodexAppServerStreamTimeoutError);
        assert.equal(error.threadId, "thread-1");

        const warningFiber = yield* client
          .streamTurn(turnStartParams, {
            chunkTimeoutAfter: "4 seconds",
            chunkWarningAfter: "1 second",
          })
          .pipe(Stream.take(1), Stream.runCollect, Effect.forkScoped);

        yield* takeJsonOutput(output);
        yield* TestClock.adjust(Duration.millis(1_000));
        const warnings = yield* Fiber.join(warningFiber);
        assert.deepEqual(warnings, [
          {
            _tag: "ChunkTimeoutWarning",
            idleForMillis: 1_000,
            method: "turn/start",
            message:
              "No Codex stream chunk received for 1000ms; continuing to wait up to 4000ms total.",
            threadId: "thread-1",
            timeoutMillis: 4_000,
            turnId: undefined,
          },
        ]);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );

  it.effect("interrupts the upstream turn when the stream aborts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { stdio, input, output } = yield* makeInMemoryStdio();
        const client = yield* CodexClient.make(stdio);
        const abortController = new AbortController();

        const streamFiber = yield* client
          .streamTurn(turnStartParams, {
            abortSignal: abortController.signal,
            chunkTimeoutAfter: "5 seconds",
            chunkWarningAfter: "1 second",
          })
          .pipe(Stream.runCollect, Effect.forkScoped);

        yield* takeJsonOutput(output);
        yield* Queue.offer(
          input,
          encodeJsonl({
            method: "turn/started",
            params: {
              threadId: "thread-1",
              turn: turn("inProgress"),
            },
          }),
        );
        yield* Effect.yieldNow;
        abortController.abort();

        const interruptRequest = (yield* takeJsonOutput(output)) as {
          readonly id: number;
          readonly method: string;
          readonly params: unknown;
        };
        assert.deepEqual(interruptRequest, {
          id: 2,
          method: "turn/interrupt",
          params: {
            threadId: "thread-1",
            turnId: "turn-1",
          },
        });
        yield* Queue.offer(
          input,
          encodeJsonl({
            id: interruptRequest.id,
            result: {},
          }),
        );

        const events = yield* Fiber.join(streamFiber);
        assert.deepEqual(
          events.map((event) => event._tag),
          ["TurnStarted"],
        );
      }),
    ),
  );
});
