import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stdio from "effect/Stdio";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/unstable/rpc/RpcClient";
import * as RpcServer from "effect/unstable/rpc/RpcServer";
import { ChildProcessSpawner } from "effect/unstable/process";

import * as AcpError from "./errors.ts";
import * as AcpProtocol from "./protocol.ts";
import * as AcpRpcs from "./rpc.ts";
import * as AcpSchema from "./_generated/schema.gen.ts";
import { AGENT_METHODS, CLIENT_METHODS } from "./_generated/meta.gen.ts";
import {
  callRpc,
  decodeExtNotificationRegistration,
  decodeExtRequestRegistration,
  runHandler,
} from "./_internal/shared.ts";
import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";

const isAcpRequestError = Schema.is(AcpError.AcpRequestError);
const isAuthenticationError = Schema.is(AcpError.AuthenticationError);

export interface AcpClientOptions {
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
  readonly onSessionExpired?: (sessionId: string) => Effect.Effect<void, AcpError.AcpError>;
}

type AcpClientRaw = {
  readonly notifications: Stream.Stream<AcpProtocol.AcpIncomingNotification>;
  readonly request: (method: string, payload: unknown) => Effect.Effect<unknown, AcpError.AcpError>;
  readonly notify: (method: string, payload: unknown) => Effect.Effect<void, AcpError.AcpError>;
};

export interface AcpClientShape {
  readonly raw: AcpClientRaw;
  readonly agent: {
    /**
     * Initializes the ACP session and negotiates capabilities.
     * @see https://agentclientprotocol.com/protocol/schema#initialize
     */
    readonly initialize: (
      payload: AcpSchema.InitializeRequest,
    ) => Effect.Effect<AcpSchema.InitializeResponse, AcpError.AcpError>;
    /**
     * Performs ACP authentication when the agent requires it.
     * @see https://agentclientprotocol.com/protocol/schema#authenticate
     */
    readonly authenticate: (
      payload: AcpSchema.AuthenticateRequest,
    ) => Effect.Effect<AcpSchema.AuthenticateResponse, AcpError.AcpError>;
    /**
     * Logs out the current ACP identity.
     * @see https://agentclientprotocol.com/protocol/schema#logout
     */
    readonly logout: (
      payload: AcpSchema.LogoutRequest,
    ) => Effect.Effect<AcpSchema.LogoutResponse, AcpError.AcpError>;
    /**
     * Starts a new ACP session.
     * @see https://agentclientprotocol.com/protocol/schema#session/new
     */
    readonly createSession: (
      payload: AcpSchema.NewSessionRequest,
    ) => Effect.Effect<AcpSchema.NewSessionResponse, AcpError.AcpError>;
    /**
     * Loads a previously saved ACP session.
     * @see https://agentclientprotocol.com/protocol/schema#session/load
     */
    readonly loadSession: (
      payload: AcpSchema.LoadSessionRequest,
    ) => Effect.Effect<AcpSchema.LoadSessionResponse, AcpError.AcpError>;
    /**
     * Lists available ACP sessions.
     * @see https://agentclientprotocol.com/protocol/schema#session/list
     */
    readonly listSessions: (
      payload: AcpSchema.ListSessionsRequest,
    ) => Effect.Effect<AcpSchema.ListSessionsResponse, AcpError.AcpError>;
    /**
     * Forks an ACP session.
     * @see https://agentclientprotocol.com/protocol/schema#session/fork
     */
    readonly forkSession: (
      payload: AcpSchema.ForkSessionRequest,
    ) => Effect.Effect<AcpSchema.ForkSessionResponse, AcpError.AcpError>;
    /**
     * Resumes an ACP session.
     * @see https://agentclientprotocol.com/protocol/schema#session/resume
     */
    readonly resumeSession: (
      payload: AcpSchema.ResumeSessionRequest,
    ) => Effect.Effect<AcpSchema.ResumeSessionResponse, AcpError.AcpError>;
    /**
     * Closes an ACP session.
     * @see https://agentclientprotocol.com/protocol/schema#session/close
     */
    readonly closeSession: (
      payload: AcpSchema.CloseSessionRequest,
    ) => Effect.Effect<AcpSchema.CloseSessionResponse, AcpError.AcpError>;
    /**
     * Selects the active model for a session.
     * @see https://agentclientprotocol.com/protocol/schema#session/set_model
     */
    readonly setSessionModel: (
      payload: AcpSchema.SetSessionModelRequest,
    ) => Effect.Effect<AcpSchema.SetSessionModelResponse, AcpError.AcpError>;
    /**
     * Updates a session configuration option.
     * @see https://agentclientprotocol.com/protocol/schema#session/set_config_option
     */
    readonly setSessionConfigOption: (
      payload: AcpSchema.SetSessionConfigOptionRequest,
    ) => Effect.Effect<AcpSchema.SetSessionConfigOptionResponse, AcpError.AcpError>;
    /**
     * Sends a prompt turn to the agent.
     * @see https://agentclientprotocol.com/protocol/schema#session/prompt
     */
    readonly prompt: (
      payload: AcpSchema.PromptRequest,
    ) => Effect.Effect<AcpSchema.PromptResponse, AcpError.AcpError>;
    /**
     * Sends a real ACP `session/cancel` notification.
     * @see https://agentclientprotocol.com/protocol/schema#session/cancel
     */
    readonly cancel: (
      payload: AcpSchema.CancelNotification,
    ) => Effect.Effect<void, AcpError.AcpError>;
  };
  /**
   * Registers a handler for `session/request_permission`.
   * @see https://agentclientprotocol.com/protocol/schema#session/request_permission
   */
  readonly handleRequestPermission: (
    handler: (
      request: AcpSchema.RequestPermissionRequest,
    ) => Effect.Effect<AcpSchema.RequestPermissionResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `session/elicitation`.
   * @see https://agentclientprotocol.com/protocol/schema#session/elicitation
   */
  readonly handleElicitation: (
    handler: (
      request: AcpSchema.ElicitationRequest,
    ) => Effect.Effect<AcpSchema.ElicitationResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `fs/read_text_file`.
   * @see https://agentclientprotocol.com/protocol/schema#fs/read_text_file
   */
  readonly handleReadTextFile: (
    handler: (
      request: AcpSchema.ReadTextFileRequest,
    ) => Effect.Effect<AcpSchema.ReadTextFileResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `fs/write_text_file`.
   * @see https://agentclientprotocol.com/protocol/schema#fs/write_text_file
   */
  readonly handleWriteTextFile: (
    handler: (
      request: AcpSchema.WriteTextFileRequest,
    ) => Effect.Effect<AcpSchema.WriteTextFileResponse | void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `terminal/create`.
   * @see https://agentclientprotocol.com/protocol/schema#terminal/create
   */
  readonly handleCreateTerminal: (
    handler: (
      request: AcpSchema.CreateTerminalRequest,
    ) => Effect.Effect<AcpSchema.CreateTerminalResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `terminal/output`.
   * @see https://agentclientprotocol.com/protocol/schema#terminal/output
   */
  readonly handleTerminalOutput: (
    handler: (
      request: AcpSchema.TerminalOutputRequest,
    ) => Effect.Effect<AcpSchema.TerminalOutputResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `terminal/wait_for_exit`.
   * @see https://agentclientprotocol.com/protocol/schema#terminal/wait_for_exit
   */
  readonly handleTerminalWaitForExit: (
    handler: (
      request: AcpSchema.WaitForTerminalExitRequest,
    ) => Effect.Effect<AcpSchema.WaitForTerminalExitResponse, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `terminal/kill`.
   * @see https://agentclientprotocol.com/protocol/schema#terminal/kill
   */
  readonly handleTerminalKill: (
    handler: (
      request: AcpSchema.KillTerminalRequest,
    ) => Effect.Effect<AcpSchema.KillTerminalResponse | void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `terminal/release`.
   * @see https://agentclientprotocol.com/protocol/schema#terminal/release
   */
  readonly handleTerminalRelease: (
    handler: (
      request: AcpSchema.ReleaseTerminalRequest,
    ) => Effect.Effect<AcpSchema.ReleaseTerminalResponse | void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `session/update`.
   * @see https://agentclientprotocol.com/protocol/schema#session/update
   */
  readonly handleSessionUpdate: (
    handler: (
      notification: AcpSchema.SessionNotification,
    ) => Effect.Effect<void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a handler for `session/elicitation/complete`.
   * @see https://agentclientprotocol.com/protocol/schema#session/elicitation/complete
   */
  readonly handleElicitationComplete: (
    handler: (
      notification: AcpSchema.ElicitationCompleteNotification,
    ) => Effect.Effect<void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a fallback extension request handler.
   * @see https://agentclientprotocol.com/protocol/extensibility
   */
  readonly handleUnknownExtRequest: (
    handler: (method: string, params: unknown) => Effect.Effect<unknown, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a fallback extension notification handler.
   * @see https://agentclientprotocol.com/protocol/extensibility
   */
  readonly handleUnknownExtNotification: (
    handler: (method: string, params: unknown) => Effect.Effect<void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a typed extension request handler.
   * @see https://agentclientprotocol.com/protocol/extensibility
   */
  readonly handleExtRequest: <A, I>(
    method: string,
    payload: Schema.Codec<A, I>,
    handler: (payload: A) => Effect.Effect<unknown, AcpError.AcpError>,
  ) => Effect.Effect<void>;
  /**
   * Registers a typed extension notification handler.
   * @see https://agentclientprotocol.com/protocol/extensibility
   */
  readonly handleExtNotification: <A, I>(
    method: string,
    payload: Schema.Codec<A, I>,
    handler: (payload: A) => Effect.Effect<void, AcpError.AcpError>,
  ) => Effect.Effect<void>;
}

export class AcpClient extends Context.Service<AcpClient, AcpClientShape>()(
  "effect-acp/AcpClient",
) {}

interface AcpCoreRequestHandlers {
  requestPermission?: (
    request: AcpSchema.RequestPermissionRequest,
  ) => Effect.Effect<AcpSchema.RequestPermissionResponse, AcpError.AcpError>;
  elicitation?: (
    request: AcpSchema.ElicitationRequest,
  ) => Effect.Effect<AcpSchema.ElicitationResponse, AcpError.AcpError>;
  readTextFile?: (
    request: AcpSchema.ReadTextFileRequest,
  ) => Effect.Effect<AcpSchema.ReadTextFileResponse, AcpError.AcpError>;
  writeTextFile?: (
    request: AcpSchema.WriteTextFileRequest,
  ) => Effect.Effect<AcpSchema.WriteTextFileResponse | void, AcpError.AcpError>;
  createTerminal?: (
    request: AcpSchema.CreateTerminalRequest,
  ) => Effect.Effect<AcpSchema.CreateTerminalResponse, AcpError.AcpError>;
  terminalOutput?: (
    request: AcpSchema.TerminalOutputRequest,
  ) => Effect.Effect<AcpSchema.TerminalOutputResponse, AcpError.AcpError>;
  terminalWaitForExit?: (
    request: AcpSchema.WaitForTerminalExitRequest,
  ) => Effect.Effect<AcpSchema.WaitForTerminalExitResponse, AcpError.AcpError>;
  terminalKill?: (
    request: AcpSchema.KillTerminalRequest,
  ) => Effect.Effect<AcpSchema.KillTerminalResponse | void, AcpError.AcpError>;
  terminalRelease?: (
    request: AcpSchema.ReleaseTerminalRequest,
  ) => Effect.Effect<AcpSchema.ReleaseTerminalResponse | void, AcpError.AcpError>;
}

interface AcpNotificationHandlers {
  readonly sessionUpdate: BufferedNotificationHandler<AcpSchema.SessionNotification>;
  readonly elicitationComplete: BufferedNotificationHandler<AcpSchema.ElicitationCompleteNotification>;
}

interface BufferedNotificationHandler<A> {
  readonly handlers: Array<(notification: A) => Effect.Effect<void, AcpError.AcpError>>;
  readonly pending: Array<A>;
}

interface AcpAuthState {
  readonly authenticatePayload?: AcpSchema.AuthenticateRequest;
  readonly accessToken?: string;
  readonly refreshToken?: string;
}

type AcpSessionSetupState =
  | {
      readonly _tag: "create";
      readonly payload: AcpSchema.NewSessionRequest;
      readonly sessionId: string;
    }
  | {
      readonly _tag: "load";
      readonly payload: AcpSchema.LoadSessionRequest;
      readonly sessionId: string;
    }
  | {
      readonly _tag: "resume";
      readonly payload: AcpSchema.ResumeSessionRequest;
      readonly sessionId: string;
    };

type AcpRefreshState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Refreshing";
      readonly deferred: Deferred.Deferred<void, AcpError.AuthenticationError>;
    };

const tokenRefreshRetrySchedule = Schedule.recurs(1);

export const make = Effect.fn("effect-acp/AcpClient.make")(function* (
  stdio: Stdio.Stdio,
  options: AcpClientOptions = {},
  terminationError?: Effect.Effect<AcpError.AcpError>,
): Effect.fn.Return<AcpClientShape, never, Scope.Scope> {
  const coreHandlers: AcpCoreRequestHandlers = {};
  const notificationHandlers: AcpNotificationHandlers = {
    sessionUpdate: { handlers: [], pending: [] },
    elicitationComplete: { handlers: [], pending: [] },
  };
  const extRequestHandlers = new Map<
    string,
    (params: unknown) => Effect.Effect<unknown, AcpError.AcpError>
  >();
  const extNotificationHandlers = new Map<
    string,
    (params: unknown) => Effect.Effect<void, AcpError.AcpError>
  >();
  let unknownExtRequestHandler:
    | ((method: string, params: unknown) => Effect.Effect<unknown, AcpError.AcpError>)
    | undefined;
  let unknownExtNotificationHandler:
    | ((method: string, params: unknown) => Effect.Effect<void, AcpError.AcpError>)
    | undefined;
  const authStateRef = yield* Ref.make<AcpAuthState>({});
  const sessionStateRef = yield* Ref.make<AcpSessionSetupState | undefined>(undefined);
  const refreshStateRef = yield* Ref.make<AcpRefreshState>({ _tag: "Idle" });

  const runNotificationHandlers = <A>(
    registration: BufferedNotificationHandler<A>,
    notification: A,
  ) =>
    Effect.forEach(
      registration.handlers,
      (handler) => handler(notification).pipe(Effect.catch(() => Effect.void)),
      { discard: true },
    );

  const flushBufferedNotifications = <A>(registration: BufferedNotificationHandler<A>) =>
    Effect.suspend(() => {
      if (registration.handlers.length === 0 || registration.pending.length === 0) {
        return Effect.void;
      }
      const pending = registration.pending.splice(0, registration.pending.length);
      return Effect.forEach(
        pending,
        (notification) => runNotificationHandlers(registration, notification),
        {
          discard: true,
        },
      );
    });

  const dispatchNotification = (notification: AcpProtocol.AcpIncomingNotification) => {
    switch (notification._tag) {
      case "SessionUpdate": {
        if (notificationHandlers.sessionUpdate.handlers.length === 0) {
          notificationHandlers.sessionUpdate.pending.push(notification.params);
          return Effect.void;
        }
        return runNotificationHandlers(notificationHandlers.sessionUpdate, notification.params);
      }
      case "ElicitationComplete": {
        if (notificationHandlers.elicitationComplete.handlers.length === 0) {
          notificationHandlers.elicitationComplete.pending.push(notification.params);
          return Effect.void;
        }
        return runNotificationHandlers(
          notificationHandlers.elicitationComplete,
          notification.params,
        );
      }
      case "ExtNotification": {
        const handler = extNotificationHandlers.get(notification.method);
        if (handler) {
          return handler(notification.params);
        }
        return unknownExtNotificationHandler
          ? unknownExtNotificationHandler(notification.method, notification.params)
          : Effect.void;
      }
    }
  };

  const dispatchExtRequest = (method: string, params: unknown) => {
    const handler = extRequestHandlers.get(method);
    if (handler) {
      return handler(params);
    }
    return unknownExtRequestHandler
      ? unknownExtRequestHandler(method, params)
      : Effect.fail(AcpError.AcpRequestError.methodNotFound(method));
  };

  const transport = yield* AcpProtocol.makeAcpPatchedProtocol({
    stdio: stdio,
    ...(terminationError ? { terminationError } : {}),
    serverRequestMethods: new Set(AcpRpcs.ClientRpcs.requests.keys()),
    ...(options.logIncoming !== undefined ? { logIncoming: options.logIncoming } : {}),
    ...(options.logOutgoing !== undefined ? { logOutgoing: options.logOutgoing } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    onNotification: dispatchNotification,
    onExtRequest: dispatchExtRequest,
  });

  const clientHandlerLayer = AcpRpcs.ClientRpcs.toLayer(
    AcpRpcs.ClientRpcs.of({
      [CLIENT_METHODS.session_request_permission]: (payload) =>
        runHandler(
          coreHandlers.requestPermission,
          payload,
          CLIENT_METHODS.session_request_permission,
        ),
      [CLIENT_METHODS.session_elicitation]: (payload) =>
        runHandler(coreHandlers.elicitation, payload, CLIENT_METHODS.session_elicitation),
      [CLIENT_METHODS.fs_read_text_file]: (payload) =>
        runHandler(coreHandlers.readTextFile, payload, CLIENT_METHODS.fs_read_text_file),
      [CLIENT_METHODS.fs_write_text_file]: (payload) =>
        runHandler(coreHandlers.writeTextFile, payload, CLIENT_METHODS.fs_write_text_file).pipe(
          Effect.map((result) => result ?? {}),
        ),
      [CLIENT_METHODS.terminal_create]: (payload) =>
        runHandler(coreHandlers.createTerminal, payload, CLIENT_METHODS.terminal_create),
      [CLIENT_METHODS.terminal_output]: (payload) =>
        runHandler(coreHandlers.terminalOutput, payload, CLIENT_METHODS.terminal_output),
      [CLIENT_METHODS.terminal_wait_for_exit]: (payload) =>
        runHandler(
          coreHandlers.terminalWaitForExit,
          payload,
          CLIENT_METHODS.terminal_wait_for_exit,
        ),
      [CLIENT_METHODS.terminal_kill]: (payload) =>
        runHandler(coreHandlers.terminalKill, payload, CLIENT_METHODS.terminal_kill).pipe(
          Effect.map((result) => result ?? {}),
        ),
      [CLIENT_METHODS.terminal_release]: (payload) =>
        runHandler(coreHandlers.terminalRelease, payload, CLIENT_METHODS.terminal_release).pipe(
          Effect.map((result) => result ?? {}),
        ),
    }),
  );

  yield* RpcServer.make(AcpRpcs.ClientRpcs).pipe(
    Effect.provideService(RpcServer.Protocol, transport.serverProtocol),
    Effect.provide(clientHandlerLayer),
    Effect.forkScoped,
  );

  let nextRpcRequestId = 1n << 32n;
  const rpc = yield* RpcClient.make(AcpRpcs.AgentRpcs, {
    generateRequestId: () => nextRpcRequestId++ as never,
  }).pipe(Effect.provideService(RpcClient.Protocol, transport.clientProtocol));

  const rememberAuthState = (
    payload: AcpSchema.AuthenticateRequest,
    response: AcpSchema.AuthenticateResponse,
  ) =>
    Ref.update(authStateRef, (current) => {
      const tokens = extractAuthTokens(response);
      return {
        authenticatePayload: payload,
        ...(tokens.accessToken !== undefined
          ? { accessToken: tokens.accessToken }
          : current.accessToken !== undefined
            ? { accessToken: current.accessToken }
            : {}),
        ...(tokens.refreshToken !== undefined
          ? { refreshToken: tokens.refreshToken }
          : current.refreshToken !== undefined
            ? { refreshToken: current.refreshToken }
            : {}),
      } satisfies AcpAuthState;
    });

  const rememberCreatedSession = (
    payload: AcpSchema.NewSessionRequest,
    response: AcpSchema.NewSessionResponse,
  ) =>
    Ref.set(sessionStateRef, {
      _tag: "create",
      payload,
      sessionId: response.sessionId,
    });

  const rememberLoadedSession = (payload: AcpSchema.LoadSessionRequest) =>
    Ref.set(sessionStateRef, {
      _tag: "load",
      payload,
      sessionId: payload.sessionId,
    });

  const rememberResumedSession = (payload: AcpSchema.ResumeSessionRequest) =>
    Ref.set(sessionStateRef, {
      _tag: "resume",
      payload,
      sessionId: payload.sessionId,
    });

  const authenticateDirect = (payload: AcpSchema.AuthenticateRequest) =>
    callRpc(rpc[AGENT_METHODS.authenticate](payload)).pipe(
      Effect.tap((response) => rememberAuthState(payload, response)),
    );

  const closeSessionDirect = (payload: AcpSchema.CloseSessionRequest) =>
    callRpc(rpc[AGENT_METHODS.session_close](payload));

  const createSessionDirect = (payload: AcpSchema.NewSessionRequest) =>
    callRpc(rpc[AGENT_METHODS.session_new](payload)).pipe(
      Effect.tap((response) => rememberCreatedSession(payload, response)),
    );

  const loadSessionDirect = (payload: AcpSchema.LoadSessionRequest) =>
    callRpc(rpc[AGENT_METHODS.session_load](payload)).pipe(
      Effect.tap(() => rememberLoadedSession(payload)),
    );

  const resumeSessionDirect = (payload: AcpSchema.ResumeSessionRequest) =>
    callRpc(rpc[AGENT_METHODS.session_resume](payload)).pipe(
      Effect.tap(() => rememberResumedSession(payload)),
    );

  const closeSessionTracked = (payload: AcpSchema.CloseSessionRequest) =>
    closeSessionDirect(payload).pipe(
      Effect.tap(() =>
        Ref.update(sessionStateRef, (state) =>
          state?.sessionId === payload.sessionId ? undefined : state,
        ),
      ),
    );

  const refreshAuth = (expiredSessionId: string | undefined) =>
    Effect.gen(function* () {
      const currentSession = yield* Ref.get(sessionStateRef);
      if (
        expiredSessionId !== undefined &&
        currentSession !== undefined &&
        currentSession.sessionId !== expiredSessionId
      ) {
        return;
      }

      if (expiredSessionId !== undefined && options.onSessionExpired) {
        yield* options.onSessionExpired(expiredSessionId);
      }

      const authState = yield* Ref.get(authStateRef);
      if (!authState.authenticatePayload) {
        return yield* makeAuthenticationError(
          "Cannot refresh ACP authentication without a previous authenticate request",
          expiredSessionId,
        );
      }

      const refreshPayload = withRefreshToken(authState.authenticatePayload, authState);
      yield* authenticateDirect(refreshPayload);

      yield* Effect.scoped(
        Effect.acquireRelease(cleanupExpiredSession(expiredSessionId), () => Effect.void).pipe(
          Effect.flatMap(() => restartSession()),
        ),
      );
    }).pipe(
      Effect.mapError((error) =>
        isAuthenticationError(error)
          ? error
          : makeAuthenticationError("ACP re-authentication failed", expiredSessionId, error),
      ),
    );

  const requestRefresh = (expiredSessionId: string | undefined) =>
    Effect.gen(function* () {
      const deferred = yield* Deferred.make<void, AcpError.AuthenticationError>();
      const effect = yield* Ref.modify(refreshStateRef, (state) => {
        if (state._tag === "Refreshing") {
          return [Deferred.await(state.deferred), state] as const;
        }
        return [
          refreshAuth(expiredSessionId).pipe(
            Effect.matchEffect({
              onFailure: (error) =>
                Deferred.fail(deferred, error).pipe(Effect.andThen(Effect.fail(error))),
              onSuccess: () => Deferred.succeed(deferred, undefined).pipe(Effect.asVoid),
            }),
            Effect.onInterrupt(() => Deferred.interrupt(deferred).pipe(Effect.asVoid)),
            Effect.ensuring(Ref.set(refreshStateRef, { _tag: "Idle" })),
          ),
          { _tag: "Refreshing", deferred } satisfies AcpRefreshState,
        ] as const;
      });
      return yield* effect;
    });

  const cleanupExpiredSession = (expiredSessionId: string | undefined) =>
    expiredSessionId === undefined
      ? Effect.void
      : closeSessionDirect({ sessionId: expiredSessionId }).pipe(Effect.asVoid);

  const restartSession = () =>
    Ref.get(sessionStateRef).pipe(
      Effect.flatMap((state) => {
        switch (state?._tag) {
          case "create":
            return createSessionDirect(state.payload).pipe(Effect.asVoid);
          case "load":
            return loadSessionDirect(state.payload).pipe(Effect.asVoid);
          case "resume":
            return resumeSessionDirect(state.payload).pipe(Effect.asVoid);
          case undefined:
            return Effect.void;
        }
      }),
    );

  const withAuthRetry = <Payload, Result>(
    payload: Payload,
    run: (payload: Payload) => Effect.Effect<Result, AcpError.AcpError>,
  ) =>
    Effect.suspend(() => {
      let refreshed = false;
      let expiredSessionId: string | undefined;
      const operation = Effect.gen(function* () {
        const requestPayload = refreshed
          ? yield* payloadWithCurrentSession(payload, expiredSessionId, sessionStateRef)
          : payload;
        return yield* run(requestPayload).pipe(
          Effect.catchIf(isUnauthorizedError, (error) =>
            Effect.gen(function* () {
              if (refreshed) {
                return yield* error;
              }
              refreshed = true;
              expiredSessionId =
                sessionIdFromPayload(payload) ?? (yield* activeSessionId(sessionStateRef));
              yield* requestRefresh(expiredSessionId);
              return yield* error;
            }),
          ),
        );
      });
      return operation.pipe(
        Effect.retry({
          schedule: tokenRefreshRetrySchedule,
          while: isUnauthorizedError,
        }),
      );
    });

  return AcpClient.of({
    raw: {
      notifications: transport.incoming,
      request: (method, payload) =>
        withAuthRetry(payload, (nextPayload) => transport.request(method, nextPayload)),
      notify: transport.notify,
    },
    agent: {
      initialize: (payload) => callRpc(rpc[AGENT_METHODS.initialize](payload)),
      authenticate: authenticateDirect,
      logout: (payload) =>
        callRpc(rpc[AGENT_METHODS.logout](payload)).pipe(
          Effect.tap(() =>
            Effect.all(
              [
                Ref.set(authStateRef, {}),
                Ref.set(sessionStateRef, undefined),
                Ref.set(refreshStateRef, { _tag: "Idle" }),
              ],
              { discard: true },
            ),
          ),
        ),
      createSession: (payload) => withAuthRetry(payload, createSessionDirect),
      loadSession: (payload) => withAuthRetry(payload, loadSessionDirect),
      listSessions: (payload) =>
        withAuthRetry(payload, (nextPayload) =>
          callRpc(rpc[AGENT_METHODS.session_list](nextPayload)),
        ),
      forkSession: (payload) =>
        withAuthRetry(payload, (nextPayload) =>
          callRpc(rpc[AGENT_METHODS.session_fork](nextPayload)),
        ),
      resumeSession: (payload) => withAuthRetry(payload, resumeSessionDirect),
      closeSession: closeSessionTracked,
      setSessionModel: (payload) =>
        withAuthRetry(payload, (nextPayload) =>
          callRpc(rpc[AGENT_METHODS.session_set_model](nextPayload)),
        ),
      setSessionConfigOption: (payload) =>
        withAuthRetry(payload, (nextPayload) =>
          callRpc(rpc[AGENT_METHODS.session_set_config_option](nextPayload)),
        ),
      prompt: (payload) =>
        withAuthRetry(payload, (nextPayload) =>
          callRpc(rpc[AGENT_METHODS.session_prompt](nextPayload)),
        ),
      cancel: (payload) => transport.notify(AGENT_METHODS.session_cancel, payload),
    },
    handleRequestPermission: (handler) =>
      Effect.suspend(() => {
        coreHandlers.requestPermission = handler;
        return Effect.void;
      }),
    handleElicitation: (handler) =>
      Effect.suspend(() => {
        coreHandlers.elicitation = handler;
        return Effect.void;
      }),
    handleReadTextFile: (handler) =>
      Effect.suspend(() => {
        coreHandlers.readTextFile = handler;
        return Effect.void;
      }),
    handleWriteTextFile: (handler) =>
      Effect.suspend(() => {
        coreHandlers.writeTextFile = handler;
        return Effect.void;
      }),
    handleCreateTerminal: (handler) =>
      Effect.suspend(() => {
        coreHandlers.createTerminal = handler;
        return Effect.void;
      }),
    handleTerminalOutput: (handler) =>
      Effect.suspend(() => {
        coreHandlers.terminalOutput = handler;
        return Effect.void;
      }),
    handleTerminalWaitForExit: (handler) =>
      Effect.suspend(() => {
        coreHandlers.terminalWaitForExit = handler;
        return Effect.void;
      }),
    handleTerminalKill: (handler) =>
      Effect.suspend(() => {
        coreHandlers.terminalKill = handler;
        return Effect.void;
      }),
    handleTerminalRelease: (handler) =>
      Effect.suspend(() => {
        coreHandlers.terminalRelease = handler;
        return Effect.void;
      }),
    handleSessionUpdate: (handler) =>
      Effect.suspend(() => {
        notificationHandlers.sessionUpdate.handlers.push(handler);
        return flushBufferedNotifications(notificationHandlers.sessionUpdate);
      }),
    handleElicitationComplete: (handler) =>
      Effect.suspend(() => {
        notificationHandlers.elicitationComplete.handlers.push(handler);
        return flushBufferedNotifications(notificationHandlers.elicitationComplete);
      }),
    handleUnknownExtRequest: (handler) =>
      Effect.suspend(() => {
        unknownExtRequestHandler = handler;
        return Effect.void;
      }),
    handleUnknownExtNotification: (handler) =>
      Effect.suspend(() => {
        unknownExtNotificationHandler = handler;
        return Effect.void;
      }),
    handleExtRequest: (method, payload, handler) =>
      Effect.suspend(() => {
        extRequestHandlers.set(method, decodeExtRequestRegistration(method, payload, handler));
        return Effect.void;
      }),
    handleExtNotification: (method, payload, handler) =>
      Effect.suspend(() => {
        extNotificationHandlers.set(
          method,
          decodeExtNotificationRegistration(method, payload, handler),
        );
        return Effect.void;
      }),
  });
});

export const layerChildProcess = (
  handle: ChildProcessSpawner.ChildProcessHandle,
  options: AcpClientOptions = {},
): Layer.Layer<AcpClient> => {
  const stdio = makeChildStdio(handle);
  const terminationError = makeTerminationError(handle);
  return Layer.effect(AcpClient, make(stdio, options, terminationError));
};

function extractAuthTokens(response: AcpSchema.AuthenticateResponse): {
  readonly accessToken?: string;
  readonly refreshToken?: string;
} {
  const meta = response._meta;
  if (!isRecord(meta)) {
    return {};
  }
  const accessToken = readString(meta, "accessToken", "access_token");
  const refreshToken = readString(meta, "refreshToken", "refresh_token");
  return {
    ...(accessToken !== undefined ? { accessToken } : {}),
    ...(refreshToken !== undefined ? { refreshToken } : {}),
  };
}

function withRefreshToken(
  payload: AcpSchema.AuthenticateRequest,
  state: AcpAuthState,
): AcpSchema.AuthenticateRequest {
  if (state.refreshToken === undefined) {
    return payload;
  }
  return {
    ...payload,
    _meta: {
      ...(isRecord(payload._meta) ? payload._meta : {}),
      refreshToken: state.refreshToken,
    },
  };
}

function isUnauthorizedError(error: AcpError.AcpError): error is AcpError.AcpRequestError {
  if (!isAcpRequestError(error)) {
    return false;
  }
  return (
    error.code === -32000 ||
    isUnauthorizedStatus(error.data) ||
    error.errorMessage.includes("401") ||
    error.errorMessage.toLowerCase().includes("unauthorized")
  );
}

function isUnauthorizedStatus(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.status === 401 ||
    value.statusCode === 401 ||
    value.code === 401 ||
    value.status === "401" ||
    value.statusCode === "401" ||
    value.code === "401"
  );
}

function sessionIdFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  return typeof payload.sessionId === "string" ? payload.sessionId : undefined;
}

function activeSessionId(
  sessionStateRef: Ref.Ref<AcpSessionSetupState | undefined>,
): Effect.Effect<string | undefined> {
  return Ref.get(sessionStateRef).pipe(Effect.map((state) => state?.sessionId));
}

function payloadWithCurrentSession<Payload>(
  payload: Payload,
  expiredSessionId: string | undefined,
  sessionStateRef: Ref.Ref<AcpSessionSetupState | undefined>,
): Effect.Effect<Payload> {
  if (expiredSessionId === undefined || !isRecord(payload)) {
    return Effect.succeed(payload);
  }
  if (payload.sessionId !== expiredSessionId) {
    return Effect.succeed(payload);
  }
  return Ref.get(sessionStateRef).pipe(
    Effect.map((state) => {
      if (state === undefined || state.sessionId === expiredSessionId) {
        return payload;
      }
      return Object.assign({}, payload, { sessionId: state.sessionId }) as Payload;
    }),
  );
}

function makeAuthenticationError(
  detail: string,
  sessionId: string | undefined,
  cause?: unknown,
): AcpError.AuthenticationError {
  return new AcpError.AuthenticationError({
    detail,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(cause !== undefined ? { cause } : {}),
  });
}

function readString(
  record: Readonly<Record<string, unknown>>,
  ...keys: ReadonlyArray<string>
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
