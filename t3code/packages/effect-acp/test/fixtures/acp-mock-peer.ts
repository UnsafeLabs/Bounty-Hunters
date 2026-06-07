import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";

import * as AcpAgent from "../../src/agent.ts";
import * as AcpError from "../../src/errors.ts";

if (process.env.ACP_MOCK_MALFORMED_OUTPUT === "1") {
  process.stdout.write("{not-json}\n");
  process.exit(Number(process.env.ACP_MOCK_MALFORMED_OUTPUT_EXIT_CODE ?? "0"));
}

if (process.env.ACP_MOCK_EXIT_IMMEDIATELY_CODE !== undefined) {
  process.exit(Number(process.env.ACP_MOCK_EXIT_IMMEDIATELY_CODE));
}

const sessionId = "mock-session-1";
let authenticateCount = 0;
let closeSessionCount = 0;
let promptCount = 0;

const program = Effect.gen(function* () {
  const agent = yield* AcpAgent.AcpAgent;

  yield* agent.handleInitialize(() =>
    Effect.succeed({
      protocolVersion: 1,
      agentCapabilities: {
        sessionCapabilities: {
          list: {},
        },
      },
      agentInfo: {
        name: "mock-agent",
        version: "0.0.0",
      },
    }),
  );

  yield* agent.handleAuthenticate((payload) =>
    Effect.gen(function* () {
      authenticateCount += 1;
      const meta = payload._meta as { refreshToken?: unknown } | undefined;
      if (process.env.ACP_MOCK_REAUTH_FAIL === "1" && meta?.refreshToken) {
        return yield* Effect.fail(
          AcpError.AcpRequestError.authRequired("401 Unauthorized", { status: 401 }),
        );
      }
      if (meta?.refreshToken && process.env.ACP_MOCK_REAUTH_DELAY_MS) {
        yield* Effect.sleep(Duration.millis(Number.parseInt(process.env.ACP_MOCK_REAUTH_DELAY_MS, 10)));
      }
      return {
        _meta: {
          refreshToken: "mock-refresh-token",
        },
      };
    }),
  );
  yield* agent.handleLogout(() => Effect.succeed({}));
  yield* agent.handleCreateSession(() =>
    Effect.succeed({
      sessionId,
    }),
  );
  yield* agent.handleCloseSession(() =>
    Effect.sync(() => {
      closeSessionCount += 1;
      return {};
    }),
  );
  yield* agent.handleLoadSession(() => Effect.succeed({}));
  yield* agent.handleListSessions(() =>
    Effect.succeed({
      sessions: [
        {
          sessionId,
          cwd: process.cwd(),
        },
      ],
    }),
  );

  yield* agent.handlePrompt(() =>
    Effect.gen(function* () {
      promptCount += 1;
      const expirePromptCount = Number.parseInt(
        process.env.ACP_MOCK_EXPIRE_PROMPT_COUNT ??
          (process.env.ACP_MOCK_EXPIRE_PROMPT_ONCE === "1" ? "1" : "0"),
        10,
      );
      if (promptCount <= expirePromptCount) {
        return yield* Effect.fail(
          AcpError.AcpRequestError.authRequired("401 Unauthorized", { status: 401 }),
        );
      }

      yield* agent.client.requestPermission({
        sessionId,
        options: [
          {
            optionId: "allow",
            name: "Allow",
            kind: "allow_once",
          },
        ],
        toolCall: {
          toolCallId: "tool-1",
          title: "Read project files",
        },
      });

      yield* agent.client.elicit({
        sessionId,
        message: "Need confirmation before continuing.",
        mode: "form",
        requestedSchema: {
          type: "object",
          title: "Need confirmation",
          properties: {
            approved: {
              type: "boolean",
              title: "Approved",
            },
          },
          required: ["approved"],
        },
      });

      yield* agent.client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "plan",
          entries: [
            {
              content: "Inspect the repository",
              priority: "high",
              status: "in_progress",
            },
          ],
        },
      });

      yield* agent.client.elicitationComplete({
        elicitationId: "elicitation-1",
      });

      yield* agent.client.extRequest("x/typed_request", {
        message: process.env.ACP_MOCK_BAD_TYPED_REQUEST === "1" ? 123 : "hello from typed request",
      });

      yield* agent.client.extNotification("x/typed_notification", {
        count: 2,
      });

      return {
        stopReason: "end_turn" as const,
      };
    }),
  );

  yield* agent.handleUnknownExtRequest((method, params) =>
    method === "x/auth_state"
      ? Effect.succeed({
          authenticateCount,
          closeSessionCount,
          promptCount,
        })
      : Effect.succeed({
          echoedMethod: method,
          echoedParams: params ?? null,
        }),
  );

  return yield* Effect.never;
});

program.pipe(
  Effect.provide(Layer.provide(AcpAgent.layerStdio(), NodeServices.layer)),
  NodeRuntime.runMain,
);
