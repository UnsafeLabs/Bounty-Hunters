import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as TestClock from "effect/testing/TestClock";

import * as CodexError from "./errors.ts";
import * as CodexClient from "./client.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const encodeUnknownJsonString = Schema.encodeUnknownSync(Schema.UnknownFromJsonString);
const encoder = new TextEncoder();

const encodeJsonl = (value: unknown) => encoder.encode(`${encodeUnknownJsonString(value)}\n`);

const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/codex-app-server-mock-peer.ts"),
);

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

  it.effect("streams request notifications in order before the final response", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        Layer.effect(CodexClient.CodexAppServerClient, CodexClient.make(stdio)),
        scope,
      );

      const eventsFiber = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return yield* client
          .requestStream("initialize", {
            clientInfo: {
              name: "effect-codex-app-server-test",
              title: "Effect Codex App Server Test",
              version: "0.0.0",
            },
            capabilities: {
              experimentalApi: true,
              optOutNotificationMethods: null,
            },
          })
          .pipe(Stream.runCollect);
      }).pipe(Effect.provide(context), Effect.forkScoped);

      const requestLine = yield* Queue.take(output);
      assert.include(requestLine, '"method":"initialize"');

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
      yield* Queue.offer(
        input,
        encodeJsonl({
          id: 1,
          result: {
            userAgent: "mock-codex-app-server",
            codexHome: "/tmp/codex-home",
            platformFamily: "unix",
            platformOs: "macos",
          },
        }),
      );

      const events = yield* Fiber.join(eventsFiber);
      assert.deepEqual(
        events.map((event) =>
          event.type === "chunk"
            ? {
                type: event.type,
                method: event.notification.method,
                delta: (event.notification.params as { readonly delta?: string }).delta,
              }
            : {
                type: event.type,
                userAgent: event.type === "response" ? event.response.userAgent : undefined,
              },
        ),
        [
          { type: "chunk", method: "item/agentMessage/delta", delta: "one" },
          { type: "chunk", method: "item/agentMessage/delta", delta: "two" },
          { type: "response", userAgent: "mock-codex-app-server" },
        ],
      );

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("emits an idle warning before failing a stalled stream", () =>
    Effect.gen(function* () {
      const { stdio, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        Layer.effect(CodexClient.CodexAppServerClient, CodexClient.make(stdio)),
        scope,
      );

      const stream = Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return client.requestStream(
          "initialize",
          {
            clientInfo: {
              name: "effect-codex-app-server-test",
              title: "Effect Codex App Server Test",
              version: "0.0.0",
            },
            capabilities: {
              experimentalApi: true,
              optOutNotificationMethods: null,
            },
          },
          { warningAfterMillis: 30, failAfterMillis: 120 },
        );
      }).pipe(Effect.provide(context));

      const firstEventFiber = yield* stream.pipe(
        Effect.flatMap((requestStream) => requestStream.pipe(Stream.take(1), Stream.runCollect)),
        Effect.forkScoped,
      );
      yield* Queue.take(output);
      yield* TestClock.adjust("30 millis");
      const firstEvent = (yield* Fiber.join(firstEventFiber))[0];
      assert.deepEqual(firstEvent, {
        type: "warning",
        reason: "chunk_timeout",
        idleMillis: 30,
      });

      const failureFiber = yield* stream.pipe(
        Effect.flatMap((requestStream) => requestStream.pipe(Stream.runCollect)),
        Effect.flip,
        Effect.forkScoped,
      );
      yield* Queue.take(output);
      yield* TestClock.adjust("120 millis");
      const error = yield* Fiber.join(failureFiber);
      assert.instanceOf(error, CodexError.CodexAppServerStreamTimeoutError);
      assert.equal(error.idleMillis, 120);

      yield* Scope.close(scope, Exit.void);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("aborts a streaming request cleanly", () =>
    Effect.gen(function* () {
      const { stdio, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(
        Layer.effect(CodexClient.CodexAppServerClient, CodexClient.make(stdio)),
        scope,
      );
      const abortController = new AbortController();

      const eventsFiber = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;
        return yield* client
          .requestStream(
            "initialize",
            {
              clientInfo: {
                name: "effect-codex-app-server-test",
                title: "Effect Codex App Server Test",
                version: "0.0.0",
              },
              capabilities: {
                experimentalApi: true,
                optOutNotificationMethods: null,
              },
            },
            { abortSignal: abortController.signal },
          )
          .pipe(Stream.runCollect);
      }).pipe(Effect.provide(context), Effect.forkScoped);

      yield* Queue.take(output);
      abortController.abort();
      const events = yield* Fiber.join(eventsFiber);
      assert.deepEqual(events, []);

      yield* Scope.close(scope, Exit.void);
    }),
  );
});
