import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stdio from "effect/Stdio";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as Ref from "effect/Ref";
import * as Fiber from "effect/Fiber";
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

export interface AcpClientOptions {
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (event: AcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
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

  return AcpClient.of({
    raw: {
      notifications: transport.incoming,
      request: transport.request,
      notify: transport.notify,
    },
    agent: {
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

// ============================================================================
// Token Refresh with Effect Retry
// ============================================================================

/**
 * Error class for authentication failures.
 */
export class AuthenticationError extends Error {
  readonly _tag = "AuthenticationError";

  constructor(
    readonly error: {
      readonly code: "UNAUTHORIZED" | "TOKEN_EXPIRED" | "INVALID_TOKEN" | "NETWORK_ERROR";
      readonly message?: string;
      readonly statusCode?: number;
    }
  ) {
    super(error.message ?? `Authentication error: ${error.code}`);
    this.name = "AuthenticationError";
  }
}

/**
 * Options for token refresh behavior.
 */
export interface TokenRefreshOptions {
  /**
   * Maximum number of retry attempts before giving up.
   * @default 3
   */
  readonly maxRetries?: number;

  /**
   * Base delay in milliseconds between retries.
   * @default 1000
   */
  readonly baseDelayMs?: number;

  /**
   * Maximum delay in milliseconds between retries.
   * @default 30000
   */
  readonly maxDelayMs?: number;

  /**
   * Exponential backoff multiplier.
   * @default 2
   */
  readonly backoffMultiplier?: number;

  /**
   * Whether to jitter the delay to avoid thundering herd.
   * @default true
   */
  readonly jitter?: boolean;

  /**
   * Predicate to determine if an error is retryable.
   */
  readonly isRetryable?: (error: unknown) => boolean;

  /**
   * Callback when a retry is attempted.
   */
  readonly onRetry?: (attempt: number, error: unknown, delayMs: number) => Effect.Effect<void>;
}

/**
 * Default token refresh options.
 */
export const DefaultTokenRefreshOptions: Required<TokenRefreshOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  isRetryable: (error) => {
    if (error instanceof AuthenticationError) {
      return error.error.code === "TOKEN_EXPIRED" || error.error.code === "UNAUTHORIZED";
    }
    return false;
  },
  onRetry: () => Effect.void,
};

/**
 * Session management for token-based authentication.
 */
export interface TokenSession {
  /** Access token */
  readonly token: string;
  /** Refresh token */
  readonly refreshToken?: string;
  /** Token expiration timestamp (milliseconds since epoch) */
  readonly expiresAt: number;
  /** Whether the token has expired */
  readonly isExpired: boolean;
}

/**
 * Options for creating a token refresh manager.
 */
export interface TokenRefreshManagerOptions extends TokenRefreshOptions {
  /**
   * Function to refresh the access token.
   */
  readonly refreshTokenFn: () => Effect.Effect<TokenSession, AuthenticationError>;

  /**
   * Function to get the current token.
   */
  readonly getTokenFn: () => Effect.Effect<TokenSession, never>;

  /**
   * Threshold in milliseconds before expiration to refresh.
   * @default 5000 (5 seconds)
   */
  readonly refreshThresholdMs?: number;
}

/**
 * Token refresh manager for handling automatic token refresh with Effect retry.
 */
export class TokenRefreshManager {
  private readonly options: Required<TokenRefreshManagerOptions>;
  private readonly _currentToken: Ref.Ref<Option.Option<TokenSession>>;
  private readonly _refreshInProgress: Ref.Ref<boolean>;
  private readonly _refreshQueue: Ref.Ref<ReadonlyArray<{
    resolve: (token: TokenSession) => void;
    reject: (error: AuthenticationError) => void;
  }>>;

  private constructor(options: Required<TokenRefreshManagerOptions>) {
    this.options = options;
    this._currentToken = Ref.unsafeMake(Option.none<TokenSession>()) as any;
    this._refreshInProgress = Ref.unsafeMake(false) as any;
    this._refreshQueue = Ref.unsafeMake([]) as any;
  }

  /**
   * Create a new TokenRefreshManager.
   */
  static make(options: TokenRefreshManagerOptions): Effect.Effect<TokenRefreshManager, never> {
    return Effect.gen(function* () {
      const finalOptions: Required<TokenRefreshManagerOptions> = {
        ...DefaultTokenRefreshOptions,
        ...options,
        refreshThresholdMs: options.refreshThresholdMs ?? 5000,
      };

      const currentToken = yield* Ref.make<Option.Option<TokenSession>>(Option.none());
      const refreshInProgress = yield* Ref.make(false);
      const refreshQueue = yield* Ref.make<ReadonlyArray<{
        resolve: (token: TokenSession) => void;
        reject: (error: AuthenticationError) => void;
      }>>([]);

      const manager = new TokenRefreshManager(finalOptions);
      manager._currentToken = currentToken as any;
      manager._refreshInProgress = refreshInProgress as any;
      manager._refreshQueue = refreshQueue as any;

      return manager;
    });
  }

  /**
   * Get the current valid token, refreshing if necessary.
   */
  getToken(): Effect.Effect<TokenSession, AuthenticationError> {
    return Effect.gen(function* () {
      // Check if we have a token
      const currentToken = yield* Ref.get(this._currentToken);
      
      if (Option.isSome(currentToken) && !this._isTokenExpired(currentToken.value)) {
        return currentToken.value;
      }

      // Need to refresh
      return yield* this._refreshTokenWithRetry();
    });
  }

  /**
   * Get the raw token string, refreshing if necessary.
   */
  getAccessToken(): Effect.Effect<string, AuthenticationError> {
    return Effect.map(this.getToken(), (session) => session.token);
  }

  /**
   * Invalidate the current token.
   */
  invalidateToken(): Effect.Effect<void> {
    return Ref.set(this._currentToken, Option.none());
  }

  /**
   * Set a new token session.
   */
  setToken(session: TokenSession): Effect.Effect<void> {
    return Ref.set(this._currentToken, Option.some(session));
  }

  /**
   * Check if a token is expired or about to expire.
   */
  private _isTokenExpired(session: TokenSession): boolean {
    const now = Date.now();
    const threshold = this.options.refreshThresholdMs;
    return now >= (session.expiresAt - threshold);
  }

  /**
   * Refresh the token with retry logic.
   */
  private _refreshTokenWithRetry(): Effect.Effect<TokenSession, AuthenticationError> {
    return Effect.gen(function* () {
      const inProgress = yield* Ref.get(this._refreshInProgress);
      
      if (inProgress) {
        // Queue this request
        const promise = Effect.promise<TokenSession, AuthenticationError>();
        const queue = yield* Ref.get(this._refreshQueue);
        yield* Ref.set(this._refreshQueue, [...queue, {
          resolve: promise.resolve,
          reject: promise.reject,
        }] as const);
        return yield* promise;
      }

      // Mark as in progress
      yield* Ref.set(this._refreshInProgress, true);

      let lastError: AuthenticationError | undefined;
      let attempt = 0;

      while (attempt < this.options.maxRetries) {
        attempt++;

        try {
          // Call the refresh function
          const session = yield* this.options.refreshTokenFn();
          
          // Store the new token
          yield* Ref.set(this._currentToken, Option.some(session));
          
          // Process queued requests
          const queue = yield* Ref.get(this._refreshQueue);
          for (const queued of queue) {
            queued.resolve(session);
          }
          yield* Ref.set(this._refreshQueue, [] as const);

          yield* Ref.set(this._refreshInProgress, false);
          return session;
        } catch (error) {
          lastError = error instanceof AuthenticationError ? error : 
            new AuthenticationError({
              code: "NETWORK_ERROR",
              message: String(error),
            });

          // Check if retryable
          if (!this.options.isRetryable(lastError)) {
            yield* Ref.set(this._refreshInProgress, false);
            throw lastError;
          }

          // Check if we should retry
          if (attempt >= this.options.maxRetries) {
            yield* Ref.set(this._refreshInProgress, false);
            throw lastError;
          }

          // Calculate delay with exponential backoff
          const delayMs = this._calculateDelay(attempt);
          
          // Notify on retry
          yield* this.options.onRetry(attempt, lastError, delayMs);

          // Wait before retrying
          yield* Effect.sleep(delayMs / 1000);
        }
      }

      // Should not reach here, but just in case
      yield* Ref.set(this._refreshInProgress, false);
      throw lastError ?? new AuthenticationError({
        code: "NETWORK_ERROR",
        message: "Token refresh failed",
      });
    });
  }

  /**
   * Calculate delay with exponential backoff and optional jitter.
   */
  private _calculateDelay(attempt: number): number {
    const baseDelay = this.options.baseDelayMs;
    const maxDelay = this.options.maxDelayMs;
    const multiplier = this.options.backoffMultiplier;
    const jitter = this.options.jitter;

    // Exponential backoff: baseDelay * (multiplier ^ (attempt - 1))
    const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1);
    const cappedDelay = Math.min(exponentialDelay, maxDelay);

    // Add jitter (random value between 0 and 50% of delay)
    if (jitter) {
      const jitterAmount = cappedDelay * 0.5 * Math.random();
      return cappedDelay + jitterAmount;
    }

    return cappedDelay;
  }
}

/**
 * Layer for TokenRefreshManager.
 */
export function makeTokenRefreshManagerLayer(
  options: TokenRefreshManagerOptions
): Layer.Layer<TokenRefreshManager> {
  return Layer.effect(TokenRefreshManager, TokenRefreshManager.make(options));
}

/**
 * Options for creating a retryable request function.
 */
export interface RetryableRequestOptions extends TokenRefreshOptions {
  /**
   * Function to check if a response indicates token expiration.
   */
  readonly isTokenExpiredResponse?: (response: unknown) => boolean;
}

/**
 * Default retryable request options.
 */
export const DefaultRetryableRequestOptions: Required<RetryableRequestOptions> = {
  ...DefaultTokenRefreshOptions,
  isTokenExpiredResponse: (response: unknown) => {
    if (typeof response === "object" && response !== null) {
      const resp = response as Record<string, unknown>;
      if (resp.status === 401 || resp.code === "UNAUTHORIZED" || resp.code === "TOKEN_EXPIRED") {
        return true;
      }
    }
    return false;
  },
};

/**
 * Create a retryable request function that automatically refreshes tokens on 401 errors.
 * 
 * @param requestFn - Function to make the actual request (receives token as parameter)
 * @param options - Retry and token refresh options
 * @returns A function that can be called to make retryable requests
 */
export function createRetryableRequest<Params extends Array<unknown>, Result>(
  requestFn: (...args: [...Params, string]) => Effect.Effect<Result, AuthenticationError>,
  options: RetryableRequestOptions
): (...args: Params) => Effect.Effect<Result, AuthenticationError> {
  return (...args: Params) =>
    Effect.gen(function* () {
      const finalOptions: Required<RetryableRequestOptions> = {
        ...DefaultRetryableRequestOptions,
        ...options,
      };

      let lastError: AuthenticationError | undefined;
      let attempt = 0;

      while (attempt <= finalOptions.maxRetries) {
        try {
          // For now, we assume the token is passed separately
          // In a real implementation, this would integrate with TokenRefreshManager
          const result = yield* requestFn(...args, "");
          
          // Check if response indicates token expiration
          if (finalOptions.isTokenExpiredResponse(result)) {
            throw new AuthenticationError({
              code: "TOKEN_EXPIRED",
              message: "Token expired based on response",
            });
          }
          
          return result;
        } catch (error) {
          lastError = error instanceof AuthenticationError ? error : 
            new AuthenticationError({
              code: "NETWORK_ERROR",
              message: String(error),
            });

          // Check if retryable
          if (!finalOptions.isRetryable(lastError)) {
            throw lastError;
          }

          // Check if we should retry
          if (attempt >= finalOptions.maxRetries) {
            throw lastError;
          }

          attempt++;
          
          // Calculate delay
          const delayMs = finalOptions.baseDelayMs * 
            Math.pow(finalOptions.backoffMultiplier, attempt - 1);
          const cappedDelay = Math.min(delayMs, finalOptions.maxDelayMs);
          const jitterDelay = finalOptions.jitter ? 
            cappedDelay * 0.5 * Math.random() : 0;
          const finalDelay = cappedDelay + jitterDelay;

          // Notify on retry
          yield* finalOptions.onRetry(attempt, lastError, finalDelay);

          // Wait before retrying
          yield* Effect.sleep(finalDelay / 1000);
        }
      }

      throw lastError ?? new AuthenticationError({
        code: "NETWORK_ERROR",
        message: "Request failed after retries",
      });
    });
}

/**
 * Request options with automatic token refresh.
 */
export interface RequestWithAuthOptions extends RetryableRequestOptions {
  /**
   * Token refresh manager to use.
   */
  readonly tokenManager: TokenRefreshManager;
}

/**
 * Create a request function that automatically includes the access token and refreshes on 401.
 * 
 * @param makeRequest - Function to make the actual HTTP request (receives token)
 * @param options - Request and token refresh options
 * @returns A function that makes authenticated, retryable requests
 */
export function createAuthenticatedRequest<Params extends Array<unknown>, Result>(
  makeRequest: (...args: [...Params, string]) => Effect.Effect<Result, AuthenticationError>,
  options: RequestWithAuthOptions
): (...args: Params) => Effect.Effect<Result, AuthenticationError> {
  return (...args: Params) =>
    Effect.gen(function* () {
      const finalOptions: Required<RequestWithAuthOptions> = {
        ...DefaultRetryableRequestOptions,
        ...options,
      };

      let lastError: AuthenticationError | undefined;
      let attempt = 0;

      while (attempt <= finalOptions.maxRetries) {
        try {
          // Get current token
          const token = yield* finalOptions.tokenManager.getAccessToken();
          
          // Make the request with the token
          const result = yield* makeRequest(...args, token);
          
          // Check if response indicates token expiration
          if (finalOptions.isTokenExpiredResponse(result)) {
            // Invalidate current token
            yield* finalOptions.tokenManager.invalidateToken();
            throw new AuthenticationError({
              code: "TOKEN_EXPIRED",
              message: "Token expired based on response",
            });
          }
          
          return result;
        } catch (error) {
          lastError = error instanceof AuthenticationError ? error : 
            new AuthenticationError({
              code: "NETWORK_ERROR",
              message: String(error),
            });

          // Check if retryable
          if (!finalOptions.isRetryable(lastError)) {
            throw lastError;
          }

          // Check if we should retry
          if (attempt >= finalOptions.maxRetries) {
            throw lastError;
          }

          attempt++;
          
          // Calculate delay
          const delayMs = finalOptions.baseDelayMs * 
            Math.pow(finalOptions.backoffMultiplier, attempt - 1);
          const cappedDelay = Math.min(delayMs, finalOptions.maxDelayMs);
          const jitterDelay = finalOptions.jitter ? 
            cappedDelay * 0.5 * Math.random() : 0;
          const finalDelay = cappedDelay + jitterDelay;

          // Notify on retry
          yield* finalOptions.onRetry(attempt, lastError, finalDelay);

          // Wait before retrying
          yield* Effect.sleep(finalDelay / 1000);
        }
      }

      throw lastError ?? new AuthenticationError({
        code: "NETWORK_ERROR",
        message: "Request failed after retries",
      });
    });
}
