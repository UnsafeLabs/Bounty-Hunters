import os

os.chdir("C:\\Users\\25936\\workspace\\bounty-hunters")

with open("t3code/packages/effect-acp/src/client.test.ts") as f:
    test_content = f.read()

# Add import
test_content = test_content.replace(
    'import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";',
    'import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";\nimport * as RpcSerialization from "effect/unstable/rpc/RpcSerialization";'
)

# Add constants
test_content = test_content.replace(
    "const ExtResponse = jsonRpcResponse(Schema.Struct({ ok: Schema.Boolean }));",
    "const ExtResponse = jsonRpcResponse(Schema.Struct({ ok: Schema.Boolean }));\n"
    "const AuthenticateRequest = jsonRpcRequest(\"authenticate\", AcpSchema.AuthenticateRequest);\n"
    "const AuthenticateResponse = jsonRpcResponse(AcpSchema.AuthenticateResponse);\n"
    "const PromptRequest = jsonRpcRequest(\"session/prompt\", AcpSchema.PromptRequest);\n"
    "const PromptResponse = jsonRpcResponse(AcpSchema.PromptResponse);\n"
    "const encoder = new TextEncoder();\n"
    "const rpcParser = RpcSerialization.ndJsonRpc().makeUnsafe();\n"
    "const encodeRpcMessage = (message: unknown) => {\n"
    "  const encoded = (\n"
    "    rpcParser as { encode: (message: unknown) => string | Uint8Array | undefined }\n"
    "  ).encode(message);\n"
    '  return typeof encoded === "string" ? encoder.encode(encoded) : (encoded ?? encoder.encode(""));\n'
    "};"
)

# Add test at end
test_tail = """

  it.effect("refreshes authentication once and replays a request after 401", () =>
    Effect.gen(function* () {
      const expiredSessions = yield* Ref.make<Array<string>>([]);
      const { stdio, input, output } = yield* makeInMemoryStdio();
      const scope = yield* Scope.make();
      const acp = yield* AcpClient.make(stdio, {
        onSessionExpired: (sessionId) =>
          Ref.update(expiredSessions, (sessions) => [...sessions, sessionId]),
      }).pipe(Effect.provideService(Scope.Scope, scope));

      const authFiber = yield* acp.agent
        .authenticate({ methodId: "cursor_login" })
        .pipe(Effect.forkScoped);
      const initialAuth = yield* Schema.decodeEffect(Schema.fromJsonString(AuthenticateRequest))(
        yield* Queue.take(output),
      );
      yield* Queue.offer(
        input,
        yield* encodeJsonl(AuthenticateResponse, {
          jsonrpc: "2.0",
          id: initialAuth.id,
          result: { _meta: { refreshToken: "refresh-1" } },
        }),
      );
      yield* Fiber.join(authFiber);

      const promptPayload: AcpSchema.PromptRequest = {
        sessionId: "expired-session",
        prompt: [{ type: "text", text: "hello" }],
      };
      const promptFiber = yield* acp.agent.prompt(promptPayload).pipe(Effect.forkScoped);

      const firstPrompt = yield* Schema.decodeEffect(Schema.fromJsonString(PromptRequest))(
        yield* Queue.take(output),
      );
      yield* Queue.offer(
        input,
        encodeRpcMessage({
          _tag: "Exit",
          requestId: String(firstPrompt.id),
          exit: {
            _tag: "Failure",
            cause: [
              {
                _tag: "Fail",
                error: { code: -32000, message: "401 Unauthorized" },
              },
            ],
          },
        }),
      );

      const refreshAuth = yield* Schema.decodeEffect(Schema.fromJsonString(AuthenticateRequest))(
        yield* Queue.take(output),
      );
      assert.deepEqual(refreshAuth.params, {
        methodId: "cursor_login",
        _meta: { refreshToken: "refresh-1" },
      });
      yield* Queue.offer(
        input,
        yield* encodeJsonl(AuthenticateResponse, {
          jsonrpc: "2.0",
          id: refreshAuth.id,
          result: { _meta: { refreshToken: "refresh-2" } },
        }),
      );

      const replayedPrompt = yield* Schema.decodeEffect(Schema.fromJsonString(PromptRequest))(
        yield* Queue.take(output),
      );
      assert.deepEqual(replayedPrompt.params, firstPrompt.params);
      yield* Queue.offer(
        input,
        yield* encodeJsonl(PromptResponse, {
          jsonrpc: "2.0",
          id: replayedPrompt.id,
          result: { stopReason: "end_turn" },
        }),
      );

      assert.deepEqual(yield* Fiber.join(promptFiber), { stopReason: "end_turn" });
      assert.deepEqual(yield* Ref.get(expiredSessions), ["unknown"]);
      yield* Scope.close(scope, Exit.void);
    }),
  );
});"""

# Remove the last }); and add our content
if test_content.rstrip().endswith("});"):
    test_content = test_content.rstrip()[:-3].rstrip() + test_tail + "\n"

with open("t3code/packages/effect-acp/src/client.test.ts", "w") as f:
    f.write(test_content)

print("Done!")
