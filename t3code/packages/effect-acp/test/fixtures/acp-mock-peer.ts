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
let logoutCount = 0;
let promptCount = 0;
let lastRefreshToken: unknown = null;

const authExpired = () =>
  AcpError.AcpRequestError.authRequired("Session authentication expired", {
    status: 401,
    sessionId,
  });

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

  yield* agent.handleAuthenticate((request) =>
    Effect.gen(function* () {
      const meta =
        request._meta && typeof request._meta === "object" && !Array.isArray(request._meta)
          ? request._meta
          : undefined;
      lastRefreshToken = meta?.refreshToken ?? null;
      authenticateCount++;
      if (process.env.ACP_MOCK_REFRESH_FAIL === "1" && authenticateCount > 1) {
        return yield* AcpError.AcpRequestError.authRequired("Refresh failed", {
          status: 401,
          sessionId,
        });
      }

      return {
        _meta: {
          accessToken: `access-token-${authenticateCount}`,
          refreshToken: `refresh-token-${authenticateCount}`,
        },
      };
    }),
  );
  yield* agent.handleLogout(() =>
    Effect.sync(() => {
      logoutCount++;
      return {};
    }),
  );
  yield* agent.handleCreateSession(() =>
    Effect.succeed({
      sessionId,
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
      promptCount++;
      if (process.env.ACP_MOCK_PROMPT_EXPIRES_ONCE === "1" && promptCount === 1) {
        return yield* authExpired();
      }
      if (process.env.ACP_MOCK_CONCURRENT_PROMPT_EXPIRES === "1" && promptCount <= 2) {
        yield* Effect.sleep("50 millis");
        return yield* authExpired();
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

  yield* agent.handleUnknownExtRequest((method, params) => {
    if (method === "x/auth_state") {
      return Effect.succeed({
        authenticateCount,
        logoutCount,
        lastRefreshToken,
        promptCount,
      });
    }
    return Effect.succeed({
      echoedMethod: method,
      echoedParams: params ?? null,
    });
  });

  return yield* Effect.never;
});

program.pipe(
  Effect.provide(Layer.provide(AcpAgent.layerStdio(), NodeServices.layer)),
  NodeRuntime.runMain,
);
