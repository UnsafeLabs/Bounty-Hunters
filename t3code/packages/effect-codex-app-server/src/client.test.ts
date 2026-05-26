import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
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

  it.effect("requestStream yields chunks via Effect.Stream with timeout", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerCommand({
        command: "bun",
        args: ["run", yield* mockPeerPath],
        cwd: path.join(import.meta.dirname, ".."),
      });
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const chunks = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.handleServerRequest("item/tool/requestUserInput", () =>
          Effect.succeed({
            answers: { approved: { answers: ["yes"] } },
          }),
        );
        yield* client.handleServerNotification("item/agentMessage/delta", () => Effect.void);

        yield* client.request("initialize", {
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
        yield* client.notify("initialized", undefined);

        // Use requestStream for account/read
        const stream = client.requestStream("account/read", {});
        const collected = yield* Stream.runCollect(stream);
        return Array.from(collected);
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      // The stream should yield at least one result
      assert.ok(chunks.length >= 1, "Stream should yield at least one chunk");
      assert.equal(chunks[0]?.requiresOpenaiAuth, false);
    }),
  );

  it.effect("requestStream and request produce equivalent results", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const scope = yield* Scope.make();
      const clientLayer = CodexClient.layerCommand({
        command: "bun",
        args: ["run", yield* mockPeerPath],
        cwd: path.join(import.meta.dirname, ".."),
      });
      const context = yield* Layer.buildWithScope(clientLayer, scope);

      const [streamResult, requestResult] = yield* Effect.gen(function* () {
        const client = yield* CodexClient.CodexAppServerClient;

        yield* client.handleServerRequest("item/tool/requestUserInput", () =>
          Effect.succeed({
            answers: { approved: { answers: ["yes"] } },
          }),
        );
        yield* client.handleServerNotification("item/agentMessage/delta", () => Effect.void);

        yield* client.request("initialize", {
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
        yield* client.notify("initialized", undefined);

        // Get result via request
        const reqResult = yield* client.request("skills/list", {
          cwds: [process.cwd()],
        });

        // Get result via requestStream
        const streamResult = yield* Stream.runCollect(
          client.requestStream("skills/list", { cwds: [process.cwd()] }),
        );

        return [Array.from(streamResult), reqResult] as const;
      }).pipe(Effect.provide(context), Effect.ensuring(Scope.close(scope, Exit.void)));

      // Both should produce the same data
      assert.equal(streamResult.length, 1);
      assert.equal(streamResult[0]?.data.length, requestResult.data.length);
      assert.equal(streamResult[0]?.data[0]?.cwd, requestResult.data[0]?.cwd);
    }),
  );
});
