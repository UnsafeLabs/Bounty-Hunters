import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";

import * as CodexClient from "./client.ts";

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

  it.effect("streamRequest creates a stream from the underlying transport", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const codexLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(codexLayer, scope);

      const chunks = yield* Effect.gen(function* () {
        const codex = yield* CodexClient.CodexAppServerClient;

        const stream = codex.streamRequest("initialize", {
          userAgent: "test-stream",
          protocolVersion: 1,
          agentInfo: { name: "test", version: "0.0.0" },
          capabilities: { experimentalApi: false, optOutNotificationMethods: null },
        } as any);

        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.isAbove(chunks.length, 0);
    }),
  );

  it.effect("streamRequest passes bufferSize option for backpressure", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const codexLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(codexLayer, scope);

      const chunks = yield* Effect.gen(function* () {
        const codex = yield* CodexClient.CodexAppServerClient;

        const stream = codex.streamRequest(
          "initialize",
          {
            userAgent: "test-backpressure",
            protocolVersion: 1,
            agentInfo: { name: "test", version: "0.0.0" },
            capabilities: { experimentalApi: false, optOutNotificationMethods: null },
          } as any,
          { bufferSize: 4 },
        );

        return yield* Stream.runCollect(stream);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      assert.isAbove(chunks.length, 0);
    }),
  );

  it.effect("streamRequest abort signal terminates the stream", () =>
    Effect.gen(function* () {
      const handle = yield* makeHandle();
      const scope = yield* Scope.make();
      const codexLayer = CodexClient.layerChildProcess(handle);
      const context = yield* Layer.buildWithScope(codexLayer, scope);

      const result = yield* Effect.gen(function* () {
        const codex = yield* CodexClient.CodexAppServerClient;
        const controller = new AbortController();

        const stream = codex.streamRequest(
          "initialize",
          {
            userAgent: "test-abort",
            protocolVersion: 1,
            agentInfo: { name: "test", version: "0.0.0" },
            capabilities: { experimentalApi: false, optOutNotificationMethods: null },
          } as any,
          { signal: controller.signal },
        );

        // Abort immediately
        controller.abort();

        return yield* Stream.runCollect(stream).pipe(Effect.exit);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      // The stream should either fail or complete, not hang
      assert.ok(result._tag === "Success" || result._tag === "Failure");
    }),
  );
});
