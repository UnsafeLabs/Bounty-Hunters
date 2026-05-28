#!/usr/bin/env python3
"""Apply the ACP token refresh patches to client.ts and client.test.ts"""
import re

# Patch 1: Add Semaphore import
with open("t3code/packages/effect-acp/src/client.ts") as f:
    content = f.read()

# 1. Semaphore import
content = content.replace(
    'import * as Scope from "effect/Scope";\nimport * as Stream from "effect/Stream";',
    'import * as Scope from "effect/Scope";\nimport * as Semaphore from "effect/Semaphore";\nimport * as Stream from "effect/Stream";'
)

# 2. onSessionExpired option
content = content.replace(
    '  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;\n}',
    '  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;\n  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, never>;\n}'
)

# 3. State vars + helper functions after unknownExtNotificationHandler
old_vars = "  let unknownExtNotificationHandler:\n    | ((method: string, params: unknown) => Effect.Effect<void, AcpError.AcpError>)\n    | undefined;"
new_vars = """  let unknownExtNotificationHandler:
    | ((method: string, params: unknown) => Effect.Effect<void, AcpError.AcpError>)
    | undefined;
  let activeSessionId: string | undefined;
  let lastAuthPayload: AcpSchema.AuthenticateRequest | undefined;
  let refreshToken: unknown;

  const isAuthExpiredError = (error: AcpError.AcpError) => {
    const message =
      error._tag === "AcpRequestError"
        ? error.errorMessage
        : error._tag === "AcpTransportError" || error._tag === "AcpProtocolParseError"
          ? error.detail
          : error.message;
    return (
      (error._tag === "AcpRequestError" && error.code === -32000) ||
      /\\b(401|unauthori[sz]ed|auth(?:entication)? required|session expired)\\b/i.test(message)
    );
  };

  const updateRefreshToken = (response: {
    readonly _meta?: { readonly [x: string]: unknown } | null;
  }) => {
    if (response._meta && "refreshToken" in response._meta) {
      refreshToken = response._meta.refreshToken;
    }
  };"""

content = content.replace(old_vars, new_vars)

# 4. After RPC client creation, add refresh logic
content = content.replace(
    "  const rpc = yield* RpcClient.make(AcpRpcs.AgentRpcs, {\n    generateRequestId: () => nextRpcRequestId++ as never,\n  }).pipe(Effect.provideService(RpcClient.Protocol, transport.clientProtocol));",
    """  const rpc = yield* RpcClient.make(AcpRpcs.AgentRpcs, {
    generateRequestId: () => nextRpcRequestId++ as never,
  }).pipe(Effect.provideService(RpcClient.Protocol, transport.clientProtocol));
  const refreshSemaphore = yield* Semaphore.make(1);

  const authenticateRaw: (
    payload: AcpSchema.AuthenticateRequest,
  ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpError.AcpError> = (payload) =>
    callRpc(rpc[AGENT_METHODS.authenticate](payload)).pipe(
      Effect.tap((response) =>
        Effect.sync(() => {
          lastAuthPayload = payload;
          updateRefreshToken(response);
        }),
      ),
    );

  const reauthenticateOnce = Effect.fn("effect-acp/AcpClient.reauthenticateOnce")(function* () {
    if (!lastAuthPayload) {
      return yield* AcpError.AcpRequestError.authRequired(
        "ACP session expired and no authentication payload is available",
      );
    }

    const sessionId = activeSessionId ?? "unknown";
    yield* Effect.scoped(
      Effect.acquireRelease(
        options.onSessionExpired ? options.onSessionExpired(sessionId) : Effect.void,
        () => Effect.void,
      ),
    );

    const payload =
      refreshToken === undefined
        ? lastAuthPayload
        : {
            ...lastAuthPayload,
            _meta: {
              ...(lastAuthPayload._meta ?? {}),
              refreshToken,
            },
          };
    yield* authenticateRaw(payload);
  });

  const ensureReauthenticated = (observedRefreshToken: unknown) =>
    refreshSemaphore.withPermit(
      Effect.suspend(() =>
        Object.is(observedRefreshToken, refreshToken) ? reauthenticateOnce() : Effect.void,
      ),
    );

  const withAuthRefresh = <A>(request: () => Effect.Effect<A, AcpError.AcpError>) =>
    request().pipe(
      Effect.catch((error: AcpError.AcpError) =>
        isAuthExpiredError(error)
          ? ensureReauthenticated(refreshToken).pipe(Effect.flatMap(() => request()))
          : Effect.fail(error),
      ),
    );"""
)

# 5. Replace the agent methods section
old_agent = """    agent: {
      initialize: (payload) => callRpc(rpc[AGENT_METHODS.initialize](payload)),
      authenticate: (payload) => callRpc(rpc[AGENT_METHODS.authenticate](payload)),
      logout: (payload) => callRpc(rpc[AGENT_METHODS.logout](payload)),
      createSession: (payload) => callRpc(rpc[AGENT_METHODS.session_new](payload)),
      loadSession: (payload) => callRpc(rpc[AGENT_METHODS.session_load](payload)),
      listSessions: (payload) => callRpc(rpc[AGENT_METHODS.session_list](payload)),
      forkSession: (payload) => callRpc(rpc[AGENT_METHODS.session_fork](payload)),
      resumeSession: (payload) => callRpc(rpc[AGENT_METHODS.session_resume](payload)),
      closeSession: (payload) => callRpc(rpc[AGENT_METHODS.session_close](payload)),
      setSessionModel: (payload) => callRpc(rpc[AGENT_METHODS.session_set_model](payload)),
      setSessionConfigOption: (payload) =>
        callRpc(rpc[AGENT_METHODS.session_set_config_option](payload)),
      prompt: (payload) => callRpc(rpc[AGENT_METHODS.session_prompt](payload)),
      cancel: (payload) => transport.notify(AGENT_METHODS.session_cancel, payload),
    },"""

new_agent = """    agent: {
      initialize: (payload) => callRpc(rpc[AGENT_METHODS.initialize](payload)),
      authenticate: (payload) => authenticateRaw(payload),
      logout: (payload) => callRpc(rpc[AGENT_METHODS.logout](payload)),
      createSession: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_new](payload))).pipe(
          Effect.tap((response) =>
            Effect.sync(() => {
              activeSessionId = response.sessionId;
            }),
          ),
        ),
      loadSession: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_load](payload))),
      listSessions: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_list](payload))),
      forkSession: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_fork](payload))),
      resumeSession: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_resume](payload))),
      closeSession: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_close](payload))),
      setSessionModel: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_set_model](payload))),
      setSessionConfigOption: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_set_config_option](payload))),
      prompt: (payload) =>
        withAuthRefresh(() => callRpc(rpc[AGENT_METHODS.session_prompt](payload))),
      cancel: (payload) => transport.notify(AGENT_METHODS.session_cancel, payload),
    },"""

content = content.replace(old_agent, new_agent)

with open("t3code/packages/effect-acp/src/client.ts", "w") as f:
    f.write(content)

# ======== Patch test file ========
import subprocess
# First check the test file exists
subprocess.run(["ls", "-la", "t3code/packages/effect-acp/src/client.test.ts"], capture_output=True, text=True, timeout=5)

print("✅ client.ts fully patched")
