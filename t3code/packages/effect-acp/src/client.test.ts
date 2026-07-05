import * as Path from "effect/Path";
import { execSync } from "node:child_process";
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
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it, assert } from "@effect/vitest";

import * as AcpClient from "./client.ts";
import * as AcpSchema from "./_generated/schema.gen.ts";
import { AcpRequestError } from "./errors.ts";
import * as AcpError from "./errors.ts";
import { encodeJsonl, jsonRpcRequest, jsonRpcResponse } from "./_internal/shared.ts";
import { makeInMemoryStdio } from "./_internal/stdio.ts";

const textEncoder = new TextEncoder();
const offerString = (queue: Queue.Queue<Uint8Array, any>, value: string | Uint8Array) =>
  Queue.offer(queue, typeof value === "string" ? textEncoder.encode(value) : value);

const InitializeRequest = jsonRpcRequest("initialize", AcpSchema.InitializeRequest);
const InitializeResponse = jsonRpcResponse(AcpSchema.InitializeResponse);
const ExtRequest = jsonRpcRequest("x/test", Schema.Struct({ hello: Schema.String }));
const ExtResponse = jsonRpcResponse(Schema.Struct({ ok: Schema.Boolean }));
const mockPeerPath = Effect.map(Effect.service(Path.Path), (path) =>
  path.join(import.meta.dirname, "../test/fixtures/acp-mock-peer.ts"),
);

it.layer(NodeServices.layer)("effect-acp client", (it) => {
  const makeHandle = (env?: Record<string, string>) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const hasBun = yield* Effect.sync(() => {
        try {
          execSync(process.platform === "win32" ? "where.exe bun" : "which bun", {
            stdio: "ignore",
          });
          return true;
        } catch {
          return false;
        }
      });
      const command = hasBun
        ? ChildProcess.make("bun", ["run", yield* mockPeerPath], {
            cwd: path.join(import.meta.dirname, ".."),
            shell: process.platform === "win32",
            ...(env ? { env: { ...process.env, ...env } } : {}),
          })
        : ChildProcess.make(
            "node",
            ["--no-warnings", "--experimental-strip-types", yield* mockPeerPath],
            {
              cwd: path.join(import.meta.dirname, ".."),
              shell: false,
              ...(env ? { env: { ...process.env, ...env } } : {}),
            },
          );
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

      yield* offerString(
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
      yield* offerString(
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

  it.effect("captures tokens on authentication", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const acp = yield* AcpClient.make(stdio).pipe(Effect.provideService(Scope.Scope, scope));

      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);

      const request = yield* Queue.take(output);
      const decodedRequest = JSON.parse(request);

      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: decodedRequest.id,
          result: {
            _meta: {
              accessToken: "new-access-token",
              refreshToken: "new-refresh-token",
            },
          },
        }) + "\n",
      );

      const authResult = yield* Fiber.join(authFiber);
      assert.deepEqual(authResult, {
        _meta: {
          accessToken: "new-access-token",
          refreshToken: "new-refresh-token",
        },
      });

      // Verify that access token is stored and injected in subsequent requests
      const initFiber = yield* acp.agent
        .initialize({
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: false, writeTextFile: false },
            terminal: false,
          },
          clientInfo: { name: "test", version: "0" },
        })
        .pipe(Effect.forkScoped);

      const initRequestJson = yield* Queue.take(output);
      const initRequest = JSON.parse(initRequestJson);
      assert.equal(initRequest.params._meta?.accessToken, "new-access-token");

      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: initRequest.id,
          result: {
            protocolVersion: 1,
            agentCapabilities: {},
            agentInfo: { name: "mock", version: "0" },
          },
        }) + "\n",
      );

      yield* Fiber.join(initFiber);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("handles basic transparent re-auth", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      const onSessionExpired = () =>
        Effect.succeed({
          accessToken: "refreshed-access-token",
          refreshToken: "refreshed-refresh-token",
        });

      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired,
        initialAccessToken: "expired-access-token",
      }).pipe(Effect.provideService(Scope.Scope, scope));

      // 1. Initial login / session establishment to populate history
      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const authReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: authReq.id,
          result: {
            _meta: { accessToken: "expired-access-token" },
          },
        }) + "\n",
      );
      yield* Fiber.join(authFiber);

      const sessionFiber = yield* acp.agent
        .createSession({ cwd: "/", mcpServers: [] })
        .pipe(Effect.forkScoped);
      const sessionReq = JSON.parse(yield* Queue.take(output));
      assert.equal(sessionReq.params._meta?.accessToken, "expired-access-token");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: sessionReq.id,
          result: { sessionId: "old-session-id" },
        }) + "\n",
      );
      yield* Fiber.join(sessionFiber);

      // 2. Make a request that will fail with 401
      const promptFiber = yield* acp.agent
        .prompt({ sessionId: "old-session-id", prompt: [] })
        .pipe(Effect.forkScoped);

      const promptReq = JSON.parse(yield* Queue.take(output));
      assert.equal(promptReq.params._meta?.accessToken, "expired-access-token");

      // Reply with 401 Error
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: promptReq.id,
          error: {
            code: 401,
            message: "Unauthorized",
          },
        }) + "\n",
      );

      // 3. Client should now perform reauth:
      // a. Close old session
      const closeReq = JSON.parse(yield* Queue.take(output));
      assert.equal(closeReq.method, "session/close");
      assert.equal(closeReq.params.sessionId, "old-session-id");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: closeReq.id,
          result: {},
        }) + "\n",
      );

      // b. Replay authenticate with new token
      const replayAuthReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replayAuthReq.method, "authenticate");
      assert.equal(replayAuthReq.params._meta?.accessToken, "refreshed-access-token");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replayAuthReq.id,
          result: {},
        }) + "\n",
      );

      // c. Replay session setup (createSession)
      const replaySessionReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replaySessionReq.method, "session/new");
      assert.equal(replaySessionReq.params._meta?.accessToken, "refreshed-access-token");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replaySessionReq.id,
          result: { sessionId: "new-session-id" },
        }) + "\n",
      );

      // d. Replay original prompt request with new token and new session ID
      const retriedPromptReq = JSON.parse(yield* Queue.take(output));
      assert.equal(retriedPromptReq.method, "session/prompt");
      assert.equal(retriedPromptReq.params.sessionId, "new-session-id");
      assert.equal(retriedPromptReq.params._meta?.accessToken, "refreshed-access-token");

      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: retriedPromptReq.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      );

      const promptResult = yield* Fiber.join(promptFiber);
      assert.equal(promptResult.stopReason, "end_turn");

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("queues concurrent requests during re-authentication", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      const onSessionExpired = () =>
        Effect.succeed({
          accessToken: "refreshed-access-token",
        });

      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired,
        initialAccessToken: "expired-access-token",
      }).pipe(Effect.provideService(Scope.Scope, scope));

      // Populating authentication history
      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const authReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: authReq.id,
          result: { _meta: { accessToken: "expired-access-token" } },
        }) + "\n",
      );
      yield* Fiber.join(authFiber);

      // Start request 1 (which will trigger reauth)
      const p1Fiber = yield* acp.agent
        .prompt({ sessionId: "session-1", prompt: [] })
        .pipe(Effect.forkScoped);

      const p1Req = JSON.parse(yield* Queue.take(output));

      // Trigger 401 error
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: p1Req.id,
          error: { code: 401, message: "Unauthorized" },
        }) + "\n",
      );

      // Give client fiber time to transition to "reauthenticating"
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      // The client state is now "reauthenticating".
      // Fire request 2 concurrently.
      const p2Fiber = yield* acp.agent
        .prompt({ sessionId: "session-1", prompt: [] })
        .pipe(Effect.forkScoped);

      // We handle the reauthentication steps:
      // a. Replay authenticate
      const replayAuthReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replayAuthReq.id,
          result: {},
        }) + "\n",
      );

      // b. Prompt 1 retry
      const p1RetryReq = JSON.parse(yield* Queue.take(output));
      assert.equal(p1RetryReq.params._meta?.accessToken, "refreshed-access-token");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: p1RetryReq.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      );

      // c. Prompt 2 execution (should execute after reauth is complete)
      const p2Req = JSON.parse(yield* Queue.take(output));
      assert.equal(p2Req.params._meta?.accessToken, "refreshed-access-token");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: p2Req.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      );

      yield* Fiber.join(p1Fiber);
      yield* Fiber.join(p2Fiber);
      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("propagates re-auth failure to outstanding requests", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      const onSessionExpired = (error: AcpError.AuthenticationError) =>
        Effect.fail(
          new AcpError.AuthenticationError({
            message: "Failed to fetch new token",
            cause: error,
          }),
        );

      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired,
        initialAccessToken: "expired-access-token",
      }).pipe(Effect.provideService(Scope.Scope, scope));

      // Populating authentication history
      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const authReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: authReq.id,
          result: { _meta: { accessToken: "expired-access-token" } },
        }) + "\n",
      );
      yield* Fiber.join(authFiber);

      // Start prompt
      const promptFiber = yield* acp.agent
        .prompt({ sessionId: "session-1", prompt: [] })
        .pipe(Effect.forkScoped);

      const promptReq = JSON.parse(yield* Queue.take(output));

      // Send 401
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: promptReq.id,
          error: { code: 401, message: "Unauthorized" },
        }) + "\n",
      );

      // Wait for re-auth failure propagation. Since onSessionExpired fails, the prompt should fail with AuthenticationError.
      const result = yield* Effect.exit(Fiber.join(promptFiber));
      assert.isFalse(Exit.isSuccess(result));
      if (Exit.isFailure(result)) {
        const error = Cause.squash(result.cause);
        assert.instanceOf(error, AcpError.AuthenticationError);
        assert.include(error.message, "Failed to fetch new token");
      }

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("prevents infinite 401 loops when refreshed token is also unauthorized", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const expiredCalls = yield* Ref.make(0);

      const onSessionExpired = () =>
        Ref.update(expiredCalls, (c) => c + 1).pipe(
          Effect.as({
            accessToken: "refreshed-access-token",
          }),
        );

      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired,
        initialAccessToken: "expired-access-token",
      }).pipe(Effect.provideService(Scope.Scope, scope));

      // Populating authentication history
      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const authReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: authReq.id,
          result: { _meta: { accessToken: "expired-access-token" } },
        }) + "\n",
      );
      yield* Fiber.join(authFiber);

      const sessionFiber = yield* acp.agent
        .createSession({ cwd: "/", mcpServers: [] })
        .pipe(Effect.forkScoped);
      const sessionReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: sessionReq.id,
          result: { sessionId: "old-session-id" },
        }) + "\n",
      );
      yield* Fiber.join(sessionFiber);

      // Start prompt
      const promptFiber = yield* acp.agent
        .prompt({ sessionId: "old-session-id", prompt: [] })
        .pipe(Effect.forkScoped);

      const promptReq = JSON.parse(yield* Queue.take(output));

      // Reply with 401 Error
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: promptReq.id,
          error: { code: 401, message: "Unauthorized" },
        }) + "\n",
      );

      // Client perform reauth. First step: close old session
      const closeReq = JSON.parse(yield* Queue.take(output));
      assert.equal(closeReq.method, "session/close");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: closeReq.id,
          result: {},
        }) + "\n",
      );

      // Client should proceed to replay authenticate
      const replayAuthReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replayAuthReq.method, "authenticate");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replayAuthReq.id,
          result: {},
        }) + "\n",
      );

      // Replay session setup
      const replaySessionReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replaySessionReq.method, "session/new");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replaySessionReq.id,
          result: { sessionId: "new-session-id" },
        }) + "\n",
      );

      // Replay prompt
      const retriedPromptReq = JSON.parse(yield* Queue.take(output));
      assert.equal(retriedPromptReq.method, "session/prompt");

      // Reply with 401 Error again
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: retriedPromptReq.id,
          error: { code: 401, message: "Unauthorized again" },
        }) + "\n",
      );

      const result = yield* Effect.exit(Fiber.join(promptFiber));
      assert.isFalse(Exit.isSuccess(result));
      if (Exit.isFailure(result)) {
        const error = Cause.squash(result.cause);
        assert.instanceOf(error, AcpRequestError);
        assert.equal((error as any).code, 401);
      }

      const calls = yield* Ref.get(expiredCalls);
      assert.equal(calls, 1);

      yield* Scope.close(scope, Exit.void);
    }),
  );

  it.effect("proceeds with re-auth even if session close fails", () =>
    Effect.gen(function* () {
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();

      const onSessionExpired = () =>
        Effect.succeed({
          accessToken: "refreshed-access-token",
        });

      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired,
        initialAccessToken: "expired-access-token",
      }).pipe(Effect.provideService(Scope.Scope, scope));

      // Populating authentication history
      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const authReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: authReq.id,
          result: { _meta: { accessToken: "expired-access-token" } },
        }) + "\n",
      );
      yield* Fiber.join(authFiber);

      const sessionFiber = yield* acp.agent
        .createSession({ cwd: "/", mcpServers: [] })
        .pipe(Effect.forkScoped);
      const sessionReq = JSON.parse(yield* Queue.take(output));
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: sessionReq.id,
          result: { sessionId: "old-session-id" },
        }) + "\n",
      );
      yield* Fiber.join(sessionFiber);

      // Start prompt
      const promptFiber = yield* acp.agent
        .prompt({ sessionId: "old-session-id", prompt: [] })
        .pipe(Effect.forkScoped);

      const promptReq = JSON.parse(yield* Queue.take(output));

      // Reply with 401 Error
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: promptReq.id,
          error: { code: 401, message: "Unauthorized" },
        }) + "\n",
      );

      // Client should perform reauth. First step: close old session
      const closeReq = JSON.parse(yield* Queue.take(output));
      assert.equal(closeReq.method, "session/close");

      // Reply with an error to session/close
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: closeReq.id,
          error: { code: -32603, message: "Internal error closing session" },
        }) + "\n",
      );

      // Client should proceed to replay authenticate
      const replayAuthReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replayAuthReq.method, "authenticate");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replayAuthReq.id,
          result: {},
        }) + "\n",
      );

      // Replay session setup
      const replaySessionReq = JSON.parse(yield* Queue.take(output));
      assert.equal(replaySessionReq.method, "session/new");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: replaySessionReq.id,
          result: { sessionId: "new-session-id" },
        }) + "\n",
      );

      // Replay prompt
      const retriedPromptReq = JSON.parse(yield* Queue.take(output));
      assert.equal(retriedPromptReq.method, "session/prompt");
      yield* offerString(
        input,
        JSON.stringify({
          jsonrpc: "2.0",
          id: retriedPromptReq.id,
          result: { stopReason: "end_turn" },
        }) + "\n",
      );

      const promptResult = yield* Fiber.join(promptFiber);
      assert.equal(promptResult.stopReason, "end_turn");

      yield* Scope.close(scope, Exit.void);
    }),
  );
});
