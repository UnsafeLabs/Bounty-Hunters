import * as Path from "effect/Path";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";

import * as AcpClient from "./client.ts";
import * as AcpSchema from "./_generated/schema.gen.ts";
import * as AcpError from "./errors.ts";
import { encodeJsonl, jsonRpcRequest, jsonRpcResponse } from "./_internal/shared.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const InitializeRequest = jsonRpcRequest("initialize", AcpSchema.InitializeRequest);
const InitializeResponse = jsonRpcResponse(AcpSchema.InitializeResponse);
const ExtRequest = jsonRpcRequest("x/test", Schema.Struct({ hello: Schema.String }));
const ExtResponse = jsonRpcResponse(Schema.Struct({ ok: Schema.Boolean }));
const JsonRpcId = Schema.Union([Schema.Number, Schema.String]);
const JsonRpcAnyRequest = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  method: Schema.String,
  params: Schema.Unknown,
  headers: Schema.Array(Schema.Unknown),
});
const JsonRpcAnyResponse = jsonRpcResponse(Schema.Unknown);
const JsonRpcErrorResponse = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: JsonRpcId,
  error: AcpSchema.Error,
});
const isAuthenticationError = Schema.is(AcpError.AuthenticationError);
const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/acp-mock-peer.ts"),
);

type JsonRpcAnyRequest = typeof JsonRpcAnyRequest.Type;

const decodeAnyRequest = Schema.decodeEffect(Schema.fromJsonString(JsonRpcAnyRequest));

const takeRpcRequest = (output: Queue.Dequeue<string>) =>
  Queue.take(output).pipe(Effect.flatMap((message) => decodeAnyRequest(message)));

const respondSuccess = (
  input: Queue.Enqueue<Uint8Array, Cause.Done<void>>,
  request: JsonRpcAnyRequest,
  result: unknown,
) =>
  encodeJsonl(JsonRpcAnyResponse, {
    jsonrpc: "2.0",
    id: request.id,
    result,
  }).pipe(Effect.flatMap((message) => Queue.offer(input, message)));

const respondError = (
  input: Queue.Enqueue<Uint8Array, Cause.Done<void>>,
  request: JsonRpcAnyRequest,
  error: AcpSchema.Error,
) =>
  encodeJsonl(JsonRpcErrorResponse, {
    jsonrpc: "2.0",
    id: request.id,
    error,
  }).pipe(Effect.flatMap((message) => Queue.offer(input, message)));

const respondAuthRequired = (
  input: Queue.Enqueue<Uint8Array, Cause.Done<void>>,
  request: JsonRpcAnyRequest,
) =>
  respondError(
    input,
    request,
    AcpError.AcpRequestError.authRequired("Session expired", { status: 401 }).toProtocolError(),
  );

function requestParam(request: JsonRpcAnyRequest, key: string): unknown {
  if (typeof request.params !== "object" || request.params === null) {
    assert.fail(`Expected ${request.method} params to be an object`);
  }
  return (request.params as Readonly<Record<string, unknown>>)[key];
}

function failureIsAuthenticationError(exit: Exit.Exit<unknown, AcpError.AcpError>) {
  return (
    Exit.isFailure(exit) &&
    exit.cause.reasons.some(
      (reason) => Cause.isFailReason(reason) && isAuthenticationError(reason.error),
    )
  );
}

it.layer(NodeServices.layer)("effect-acp client", (it) => {
  const makeHandle = (env?: Record<string, string>) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const command = ChildProcess.make("bun", ["run", yield* mockPeerPath], {
        cwd: path.join(import.meta.dirname, ".."),
        shell: process.platform === "win32",
        ...(env ? { env: { ...process.env, ...env } } : {}),
      });
      return yield* spawner.spawn(command);
    });

  it.effect("initializes, prompts, receives updates, and handles permission requests", () =>
    Effect.gen(function* () {
      const updates = yield* Ref.make<Array<unknown>>([]);
      const elicitationCompletions = yield* Ref.make<Array<unknown>>([]);
      const typedRequests = yield* Ref.make<Array<unknown>>([]);
      const typedNotifications = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const acpLayer = AcpClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(acpLayer, scope);

      const ext = yield* Effect.gen(function* () {
        const acp = yield* AcpClient.AcpClient;

        yield* acp.handleRequestPermission(() =>
          Effect.succeed({
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          }),
        );
        yield* acp.handleElicitation(() =>
          Effect.succeed({
            action: {
              action: "accept",
              content: {
                approved: true,
              },
            },
          }),
        );
        yield* acp.handleSessionUpdate((notification) =>
          Ref.update(updates, (current) => [...current, notification]),
        );
        yield* acp.handleElicitationComplete((notification) =>
          Ref.update(elicitationCompletions, (current) => [...current, notification]),
        );
        yield* acp.handleExtRequest(
          "x/typed_request",
          Schema.Struct({ message: Schema.String }),
          (payload) =>
            Ref.update(typedRequests, (current) => [...current, payload]).pipe(
              Effect.as({
                ok: true,
                echoedMessage: payload.message,
              }),
            ),
        );
        yield* acp.handleExtNotification(
          "x/typed_notification",
          Schema.Struct({ count: Schema.Number }),
          (payload) => Ref.update(typedNotifications, (current) => [...current, payload]),
        );

        const init = yield* acp.agent.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "effect-acp-test",
            version: "0.0.0",
          },
        });
        assert.equal(init.protocolVersion, 1);

        yield* acp.agent.authenticate({ methodId: "cursor_login" });

        const session = yield* acp.agent.createSession({
          cwd: process.cwd(),
          mcpServers: [],
        });
        assert.equal(session.sessionId, "mock-session-1");

        const prompt = yield* acp.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "hello" }],
        });
        assert.equal(prompt.stopReason, "end_turn");

        const streamed = yield* Stream.runCollect(Stream.take(acp.raw.notifications, 2));
        assert.equal(streamed.length, 2);
        assert.equal(streamed[0]?._tag, "SessionUpdate");
        assert.equal(streamed[1]?._tag, "ElicitationComplete");
        assert.equal((yield* Ref.get(updates)).length, 1);
        assert.equal((yield* Ref.get(elicitationCompletions)).length, 1);
        assert.deepEqual(yield* Ref.get(typedRequests), [{ message: "hello from typed request" }]);
        assert.deepEqual(yield* Ref.get(typedNotifications), [{ count: 2 }]);

        return yield* acp.raw.request("x/echo", {
          hello: "world",
        });
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.deepEqual(ext, {
        echoedMethod: "x/echo",
        echoedParams: {
          hello: "world",
        },
      });
    }),
  );

  it.effect(
    "returns formatted invalid params when a typed extension request payload is wrong",
    () =>
      Effect.gen(function* () {
        const handle = yield* makeHandle({ ACP_MOCK_BAD_TYPED_REQUEST: "1" });
        const scope = yield* Scope.make();
        const acpLayer = AcpClient.layerChildProcess(handle);
        const context = yield* Layer.buildWithScope(acpLayer, scope);

        const result = yield* Effect.gen(function* () {
          const acp = yield* AcpClient.AcpClient;

          yield* acp.handleRequestPermission(() =>
            Effect.succeed({
              outcome: {
                outcome: "selected",
                optionId: "allow",
              },
            }),
          );
          yield* acp.handleElicitation(() =>
            Effect.succeed({
              action: {
                action: "accept",
                content: {
                  approved: true,
                },
              },
            }),
          );
          yield* acp.handleExtRequest(
            "x/typed_request",
            Schema.Struct({ message: Schema.String }),
            () => Effect.succeed({ ok: true }),
          );

          yield* acp.agent.initialize({
            protocolVersion: 1,
            clientCapabilities: {
              fs: { readTextFile: false, writeTextFile: false },
              terminal: false,
            },
            clientInfo: {
              name: "effect-acp-test",
              version: "0.0.0",
            },
          });

          yield* acp.agent.authenticate({ methodId: "cursor_login" });

          const session = yield* acp.agent.createSession({
            cwd: process.cwd(),
            mcpServers: [],
          });

          return yield* Effect.exit(
            acp.agent.prompt({
              sessionId: session.sessionId,
              prompt: [{ type: "text", text: "hello" }],
            }),
          );
        }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

        if (result._tag !== "Failure") {
          assert.fail("Expected prompt to fail for invalid typed extension payload");
        }
        const rendered = Cause.pretty(result.cause);
        assert.include(rendered, "Invalid x/typed_request payload:");
        assert.include(rendered, "Expected string, got 123");
      }),
  );

  it.effect("replays buffered notifications to handlers registered after they arrive", () =>
    Effect.gen(function* () {
      const updates = yield* Ref.make<Array<unknown>>([]);
      const elicitationCompletions = yield* Ref.make<Array<unknown>>([]);
      const typedRequests = yield* Ref.make<Array<unknown>>([]);
      const typedNotifications = yield* Ref.make<Array<unknown>>([]);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const acpLayer = AcpClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(acpLayer, scope);

      yield* Effect.gen(function* () {
        const acp = yield* AcpClient.AcpClient;

        yield* acp.handleRequestPermission(() =>
          Effect.succeed({
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          }),
        );
        yield* acp.handleElicitation(() =>
          Effect.succeed({
            action: {
              action: "accept",
              content: {
                approved: true,
              },
            },
          }),
        );
        yield* acp.handleExtRequest(
          "x/typed_request",
          Schema.Struct({ message: Schema.String }),
          (payload) =>
            Ref.update(typedRequests, (current) => [...current, payload]).pipe(
              Effect.as({
                ok: true,
                echoedMessage: payload.message,
              }),
            ),
        );
        yield* acp.handleExtNotification(
          "x/typed_notification",
          Schema.Struct({ count: Schema.Number }),
          (payload) => Ref.update(typedNotifications, (current) => [...current, payload]),
        );

        yield* acp.agent.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "effect-acp-test",
            version: "0.0.0",
          },
        });
        yield* acp.agent.authenticate({ methodId: "cursor_login" });

        const session = yield* acp.agent.createSession({
          cwd: process.cwd(),
          mcpServers: [],
        });
        yield* acp.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "hello" }],
        });

        yield* acp.handleSessionUpdate((notification) =>
          Ref.update(updates, (current) => [...current, notification]),
        );
        yield* acp.handleElicitationComplete((notification) =>
          Ref.update(elicitationCompletions, (current) => [...current, notification]),
        );

        assert.equal((yield* Ref.get(updates)).length, 1);
        assert.equal((yield* Ref.get(elicitationCompletions)).length, 1);
        assert.deepEqual(yield* Ref.get(typedRequests), [{ message: "hello from typed request" }]);
        assert.deepEqual(yield* Ref.get(typedNotifications), [{ count: 2 }]);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));
    }),
  );

  it.effect("continues dispatching session updates after one handler fails", () =>
    Effect.gen(function* () {
      const successfulHandlers = yield* Ref.make(0);
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const acpLayer = AcpClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(acpLayer, scope);

      yield* Effect.gen(function* () {
        const acp = yield* AcpClient.AcpClient;

        yield* acp.handleRequestPermission(() =>
          Effect.succeed({
            outcome: {
              outcome: "selected",
              optionId: "allow",
            },
          }),
        );
        yield* acp.handleElicitation(() =>
          Effect.succeed({
            action: {
              action: "accept",
              content: {
                approved: true,
              },
            },
          }),
        );
        yield* acp.handleExtRequest(
          "x/typed_request",
          Schema.Struct({ message: Schema.String }),
          () => Effect.succeed({ ok: true }),
        );
        yield* acp.handleExtNotification(
          "x/typed_notification",
          Schema.Struct({ count: Schema.Number }),
          () => Effect.void,
        );
        yield* acp.handleSessionUpdate(() =>
          Effect.fail(AcpError.AcpRequestError.internalError("session update handler failed")),
        );
        yield* acp.handleSessionUpdate(() => Ref.update(successfulHandlers, (count) => count + 1));

        yield* acp.agent.initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "effect-acp-test",
            version: "0.0.0",
          },
        });
        yield* acp.agent.authenticate({ methodId: "cursor_login" });

        const session = yield* acp.agent.createSession({
          cwd: process.cwd(),
          mcpServers: [],
        });
        yield* acp.agent.prompt({
          sessionId: session.sessionId,
          prompt: [{ type: "text", text: "hello" }],
        });

        assert.equal(yield* Ref.get(successfulHandlers), 1);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));
    }),
  );

  it.effect("uses distinct ids for RPC calls and extension requests", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const acp = yield* AcpClient.make(stdio).pipe(Effect.provideService(Scope.Scope, scope));

      const initializeFiber = yield* acp.agent
        .initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: {
            name: "effect-acp-test",
            version: "0.0.0",
          },
        })
        .pipe(Effect.forkScoped);
      const extFiber = yield* acp.raw.request("x/test", { hello: "world" }).pipe(Effect.forkScoped);

      const firstOutbound = yield* Queue.take(output);
      const secondOutbound = yield* Queue.take(output);

      const decodedInitialize = Schema.decodeEffect(Schema.fromJsonString(InitializeRequest));
      const decodedExt = Schema.decodeEffect(Schema.fromJsonString(ExtRequest));
      const firstIsInitialize = yield* decodedInitialize(firstOutbound).pipe(
        Effect.match({
          onFailure: () => false,
          onSuccess: () => true,
        }),
      );

      const initializeRequest = firstIsInitialize
        ? yield* decodedInitialize(firstOutbound)
        : yield* decodedInitialize(secondOutbound);
      const extRequest = firstIsInitialize
        ? yield* decodedExt(secondOutbound)
        : yield* decodedExt(firstOutbound);

      assert.notEqual(initializeRequest.id, extRequest.id);

      yield* Queue.offer(
        input,
        yield* encodeJsonl(InitializeResponse, {
          jsonrpc: "2.0",
          id: initializeRequest.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            agentInfo: {
              name: "mock-agent",
              version: "0.0.0",
            },
          },
        }),
      );
      yield* Queue.offer(
        input,
        yield* encodeJsonl(ExtResponse, {
          jsonrpc: "2.0",
          id: extRequest.id,
          result: { ok: true },
        }),
      );

      yield* Fiber.join(initializeFiber);
      assert.deepEqual(yield* Fiber.join(extFiber), { ok: true });
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("refreshes authentication once and replays queued requests on the new session", () =>
    Effect.gen(function* () {
      const expiredSessions = yield* Ref.make<Array<string>>([]);
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      yield* Effect.gen(function* () {
        const acp = yield* AcpClient.make(stdio, {
          onSessionExpired: (sessionId) =>
            Ref.update(expiredSessions, (current) => [...current, sessionId]),
        }).pipe(Effect.provideService(Scope.Scope, scope));

        const authFiber = yield* acp.agent
          .authenticate({ methodId: "cursor_login" })
          .pipe(Effect.forkScoped);
        const authRequest = yield* takeRpcRequest(output);
        assert.equal(authRequest.method, "authenticate");
        assert.equal(requestParam(authRequest, "methodId"), "cursor_login");
        yield* respondSuccess(input, authRequest, {
          _meta: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
          },
        });
        yield* Fiber.join(authFiber);

        const sessionFiber = yield* acp.agent
          .createSession({ cwd: process.cwd(), mcpServers: [] })
          .pipe(Effect.forkScoped);
        const sessionRequest = yield* takeRpcRequest(output);
        assert.equal(sessionRequest.method, "session/new");
        yield* respondSuccess(input, sessionRequest, { sessionId: "session-1" });
        assert.equal((yield* Fiber.join(sessionFiber)).sessionId, "session-1");

        const firstPromptFiber = yield* acp.agent
          .prompt({
            sessionId: "session-1",
            prompt: [{ type: "text", text: "first" }],
          })
          .pipe(Effect.forkScoped);
        const secondPromptFiber = yield* acp.agent
          .prompt({
            sessionId: "session-1",
            prompt: [{ type: "text", text: "second" }],
          })
          .pipe(Effect.forkScoped);

        const firstPromptRequest = yield* takeRpcRequest(output);
        const secondPromptRequest = yield* takeRpcRequest(output);
        assert.equal(firstPromptRequest.method, "session/prompt");
        assert.equal(secondPromptRequest.method, "session/prompt");
        assert.equal(requestParam(firstPromptRequest, "sessionId"), "session-1");
        assert.equal(requestParam(secondPromptRequest, "sessionId"), "session-1");

        yield* Effect.all(
          [
            respondAuthRequired(input, firstPromptRequest),
            respondAuthRequired(input, secondPromptRequest),
          ],
          { discard: true },
        );

        const refreshAuthRequest = yield* takeRpcRequest(output);
        assert.equal(refreshAuthRequest.method, "authenticate");
        assert.deepEqual(yield* Ref.get(expiredSessions), ["session-1"]);
        const refreshMeta = requestParam(refreshAuthRequest, "_meta");
        assert.equal(
          typeof refreshMeta === "object" && refreshMeta !== null
            ? (refreshMeta as Readonly<Record<string, unknown>>).refreshToken
            : undefined,
          "refresh-1",
        );
        yield* respondSuccess(input, refreshAuthRequest, {
          _meta: {
            accessToken: "access-2",
            refreshToken: "refresh-2",
          },
        });

        const closeRequest = yield* takeRpcRequest(output);
        assert.equal(closeRequest.method, "session/close");
        assert.equal(requestParam(closeRequest, "sessionId"), "session-1");
        yield* respondSuccess(input, closeRequest, {});

        const recreatedSessionRequest = yield* takeRpcRequest(output);
        assert.equal(recreatedSessionRequest.method, "session/new");
        yield* respondSuccess(input, recreatedSessionRequest, { sessionId: "session-2" });

        const firstRetryRequest = yield* takeRpcRequest(output);
        const secondRetryRequest = yield* takeRpcRequest(output);
        assert.equal(firstRetryRequest.method, "session/prompt");
        assert.equal(secondRetryRequest.method, "session/prompt");
        assert.equal(requestParam(firstRetryRequest, "sessionId"), "session-2");
        assert.equal(requestParam(secondRetryRequest, "sessionId"), "session-2");
        yield* respondSuccess(input, firstRetryRequest, { stopReason: "end_turn" });
        yield* respondSuccess(input, secondRetryRequest, { stopReason: "end_turn" });

        assert.equal((yield* Fiber.join(firstPromptFiber)).stopReason, "end_turn");
        assert.equal((yield* Fiber.join(secondPromptFiber)).stopReason, "end_turn");

        yield* TestClock.adjust("0 millis").pipe(Effect.provide(TestClock.layer()));
      }).pipe(Effect.ensuring(Scope.close(scope, Exit.void)));
    }),
  );

  it.effect("fails all queued requests with AuthenticationError when refresh fails", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      yield* Effect.gen(function* () {
        const acp = yield* AcpClient.make(stdio).pipe(Effect.provideService(Scope.Scope, scope));

        const authFiber = yield* acp.agent
          .authenticate({ methodId: "cursor_login" })
          .pipe(Effect.forkScoped);
        const authRequest = yield* takeRpcRequest(output);
        yield* respondSuccess(input, authRequest, {
          _meta: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
          },
        });
        yield* Fiber.join(authFiber);

        const sessionFiber = yield* acp.agent
          .createSession({ cwd: process.cwd(), mcpServers: [] })
          .pipe(Effect.forkScoped);
        const sessionRequest = yield* takeRpcRequest(output);
        yield* respondSuccess(input, sessionRequest, { sessionId: "session-1" });
        yield* Fiber.join(sessionFiber);

        const firstPromptFiber = yield* Effect.exit(
          acp.agent.prompt({
            sessionId: "session-1",
            prompt: [{ type: "text", text: "first" }],
          }),
        ).pipe(Effect.forkScoped);
        const secondPromptFiber = yield* Effect.exit(
          acp.agent.prompt({
            sessionId: "session-1",
            prompt: [{ type: "text", text: "second" }],
          }),
        ).pipe(Effect.forkScoped);

        const firstPromptRequest = yield* takeRpcRequest(output);
        const secondPromptRequest = yield* takeRpcRequest(output);
        yield* Effect.all(
          [
            respondAuthRequired(input, firstPromptRequest),
            respondAuthRequired(input, secondPromptRequest),
          ],
          { discard: true },
        );

        const refreshAuthRequest = yield* takeRpcRequest(output);
        assert.equal(refreshAuthRequest.method, "authenticate");
        yield* respondError(
          input,
          refreshAuthRequest,
          AcpError.AcpRequestError.authRequired("Refresh rejected", {
            status: 401,
          }).toProtocolError(),
        );

        assert.equal(failureIsAuthenticationError(yield* Fiber.join(firstPromptFiber)), true);
        assert.equal(failureIsAuthenticationError(yield* Fiber.join(secondPromptFiber)), true);

        yield* TestClock.adjust("0 millis").pipe(Effect.provide(TestClock.layer()));
      }).pipe(Effect.ensuring(Scope.close(scope, Exit.void)));
    }),
  );
});
