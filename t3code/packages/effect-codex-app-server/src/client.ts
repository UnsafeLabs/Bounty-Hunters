import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stdio from "effect/Stdio";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import * as CodexRpc from "./_generated/meta.gen.ts";
import * as CodexError from "./errors.ts";
import * as CodexProtocol from "./protocol.ts";
import {
  decodeNotificationPayload,
  decodeOptionalPayload,
  encodeOptionalPayload,
  runHandler,
} from "./_internal/shared.ts";
import { makeChildStdio, makeTerminationError } from "./_internal/stdio.ts";

const DEFAULT_APP_SERVER_FORCE_KILL_AFTER = "2 seconds" as const;
const DEFAULT_TURN_STREAM_QUEUE_CAPACITY = 16;
const DEFAULT_TURN_STREAM_CHUNK_WARNING_AFTER = "30 seconds" as const;
const DEFAULT_TURN_STREAM_CHUNK_TIMEOUT_AFTER = "120 seconds" as const;

export interface CodexAppServerClientOptions {
  readonly logIncoming?: boolean;
  readonly logOutgoing?: boolean;
  readonly logger?: (
    event: CodexProtocol.CodexAppServerProtocolLogEvent,
  ) => Effect.Effect<void, never>;
}

interface CodexAppServerClientRaw {
  readonly notifications: CodexProtocol.CodexAppServerPatchedProtocol["incomingNotifications"];
  readonly requests: CodexProtocol.CodexAppServerPatchedProtocol["incomingRequests"];
  readonly request: CodexProtocol.CodexAppServerPatchedProtocol["request"];
  readonly notify: CodexProtocol.CodexAppServerPatchedProtocol["notify"];
  readonly respond: CodexProtocol.CodexAppServerPatchedProtocol["respond"];
  readonly respondError: CodexProtocol.CodexAppServerPatchedProtocol["respondError"];
}

export type CodexAppServerTurnStreamEvent =
  | {
      readonly _tag: "TurnStarted";
      readonly method: "turn/started";
      readonly payload: CodexRpc.ServerNotificationParamsByMethod["turn/started"];
    }
  | {
      readonly _tag: "AgentMessageDelta";
      readonly method: "item/agentMessage/delta";
      readonly payload: CodexRpc.ServerNotificationParamsByMethod["item/agentMessage/delta"];
      readonly textDelta: string;
    }
  | {
      readonly _tag: "TurnCompleted";
      readonly method: "turn/completed";
      readonly payload: CodexRpc.ServerNotificationParamsByMethod["turn/completed"];
    }
  | {
      readonly _tag: "ChunkTimeoutWarning";
      readonly idleForMillis: number;
      readonly method: "turn/start";
      readonly message: string;
      readonly threadId: string;
      readonly timeoutMillis: number;
      readonly turnId: string | undefined;
    }
  | {
      readonly _tag: "TurnStartResponse";
      readonly method: "turn/start";
      readonly response: CodexRpc.ClientRequestResponsesByMethod["turn/start"];
    };

export interface CodexAppServerTurnStreamOptions {
  readonly abortSignal?: AbortSignal;
  readonly chunkTimeoutAfter?: Duration.Input;
  readonly chunkWarningAfter?: Duration.Input;
  readonly queueCapacity?: number;
}

export interface CodexAppServerClientShape {
  readonly raw: CodexAppServerClientRaw;
  readonly request: <M extends CodexRpc.ClientRequestMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ) => Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexError.CodexAppServerError>;
  readonly notify: <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
    payload: CodexRpc.ClientNotificationParamsByMethod[M],
  ) => Effect.Effect<void, CodexError.CodexAppServerError>;
  readonly streamTurn: (
    payload: CodexRpc.ClientRequestParamsByMethod["turn/start"],
    options?: CodexAppServerTurnStreamOptions,
  ) => Stream.Stream<CodexAppServerTurnStreamEvent, CodexError.CodexAppServerError>;
  readonly handleServerRequest: <M extends CodexRpc.ServerRequestMethod>(
    method: M,
    handler: (
      payload: CodexRpc.ServerRequestParamsByMethod[M],
    ) => Effect.Effect<CodexRpc.ServerRequestResponsesByMethod[M], CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleServerNotification: <M extends CodexRpc.ServerNotificationMethod>(
    method: M,
    handler: (
      payload: CodexRpc.ServerNotificationParamsByMethod[M],
    ) => Effect.Effect<void, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleUnknownServerRequest: (
    handler: (
      method: string,
      params: unknown,
    ) => Effect.Effect<unknown, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
  readonly handleUnknownServerNotification: (
    handler: (
      method: string,
      params: unknown,
    ) => Effect.Effect<void, CodexError.CodexAppServerError>,
  ) => Effect.Effect<void>;
}

export class CodexAppServerClient extends Context.Service<
  CodexAppServerClient,
  CodexAppServerClientShape
>()("effect-codex-app-server/CodexAppServerClient") {}

type ServerRequestHandler = (
  payload: unknown,
) => Effect.Effect<unknown, CodexError.CodexAppServerError>;
type ServerNotificationHandler = (
  payload: unknown,
) => Effect.Effect<void, CodexError.CodexAppServerError>;

const durationMillis = (input: Duration.Input): number =>
  Duration.toMillis(Duration.fromInputUnsafe(input));

const awaitAbortSignal = (signal: AbortSignal): Effect.Effect<void> =>
  signal.aborted
    ? Effect.void
    : Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }),
      );

export const make = Effect.fn("effect-codex-app-server/CodexAppServerClient.make")(function* (
  stdio: Stdio.Stdio,
  options: CodexAppServerClientOptions = {},
  terminationError?: Effect.Effect<CodexError.CodexAppServerError>,
): Effect.fn.Return<CodexAppServerClientShape, never, Scope.Scope> {
  const requestHandlers = new Map<string, ServerRequestHandler>();
  const notificationHandlers = new Map<string, Array<ServerNotificationHandler>>();
  let unknownRequestHandler:
    | ((method: string, params: unknown) => Effect.Effect<unknown, CodexError.CodexAppServerError>)
    | undefined;
  let unknownNotificationHandler:
    | ((method: string, params: unknown) => Effect.Effect<void, CodexError.CodexAppServerError>)
    | undefined;

  const getServerRequestParamSchema = <M extends CodexRpc.ServerRequestMethod>(
    method: M,
  ):
    | Schema.Codec<CodexRpc.ServerRequestParamsByMethod[M], CodexRpc.ServerRequestParamsByMethod[M]>
    | undefined => CodexRpc.SERVER_REQUEST_PARAMS[method] as never;

  const getServerRequestResponseSchema = <M extends CodexRpc.ServerRequestMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ServerRequestResponsesByMethod[M],
        CodexRpc.ServerRequestResponsesByMethod[M]
      >
    | undefined => CodexRpc.SERVER_REQUEST_RESPONSES[method] as never;

  const getClientRequestParamSchema = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
  ):
    | Schema.Codec<CodexRpc.ClientRequestParamsByMethod[M], CodexRpc.ClientRequestParamsByMethod[M]>
    | undefined => CodexRpc.CLIENT_REQUEST_PARAMS[method] as never;

  const getClientRequestResponseSchema = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ClientRequestResponsesByMethod[M],
        CodexRpc.ClientRequestResponsesByMethod[M]
      >
    | undefined => CodexRpc.CLIENT_REQUEST_RESPONSES[method] as never;

  const getClientNotificationParamSchema = <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
  ):
    | Schema.Codec<
        CodexRpc.ClientNotificationParamsByMethod[M],
        CodexRpc.ClientNotificationParamsByMethod[M]
      >
    | undefined => CodexRpc.CLIENT_NOTIFICATION_PARAMS[method] as never;

  const registerServerNotificationHandler = <M extends CodexRpc.ServerNotificationMethod>(
    method: M,
    handler: (
      payload: CodexRpc.ServerNotificationParamsByMethod[M],
    ) => Effect.Effect<void, CodexError.CodexAppServerError>,
  ): Effect.Effect<Effect.Effect<void>> =>
    Effect.sync(() => {
      const registered = handler as ServerNotificationHandler;
      const current = notificationHandlers.get(method) ?? [];
      notificationHandlers.set(method, [...current, registered]);
      return Effect.sync(() => {
        const handlers = notificationHandlers.get(method) ?? [];
        const next = handlers.filter((candidate) => candidate !== registered);
        if (next.length === 0) {
          notificationHandlers.delete(method);
          return;
        }
        notificationHandlers.set(method, next);
      });
    });

  const dispatchNotification = (
    notification: CodexProtocol.CodexAppServerIncomingNotification,
  ): Effect.Effect<void, never> => {
    const schema =
      notification.method in CodexRpc.SERVER_NOTIFICATION_PARAMS
        ? CodexRpc.SERVER_NOTIFICATION_PARAMS[
            notification.method as CodexRpc.ServerNotificationMethod
          ]
        : undefined;
    const handlers = notificationHandlers.get(notification.method) ?? [];

    if (schema) {
      return decodeNotificationPayload(notification.method, schema, notification.params).pipe(
        Effect.flatMap((decoded) =>
          Effect.forEach(handlers, (handler) => handler(decoded), { discard: true }),
        ),
        Effect.catch(() => Effect.void),
      );
    }

    return unknownNotificationHandler
      ? unknownNotificationHandler(notification.method, notification.params).pipe(
          Effect.catch(() => Effect.void),
        )
      : Effect.void;
  };

  const dispatchRequest = (
    request: CodexProtocol.CodexAppServerIncomingRequest,
  ): Effect.Effect<unknown, CodexError.CodexAppServerError> => {
    if (request.method in CodexRpc.SERVER_REQUEST_PARAMS) {
      const method = request.method as CodexRpc.ServerRequestMethod;
      const payloadSchema = getServerRequestParamSchema(method);
      const responseSchema = getServerRequestResponseSchema(method);
      const handler = requestHandlers.get(method);

      return decodeOptionalPayload(method, payloadSchema, request.params).pipe(
        Effect.flatMap((decoded) => runHandler(handler, decoded, method)),
        Effect.flatMap((result) => encodeOptionalPayload(method, responseSchema, result)),
      );
    }

    return unknownRequestHandler
      ? unknownRequestHandler(request.method, request.params)
      : Effect.fail(CodexError.CodexAppServerRequestError.methodNotFound(request.method));
  };

  const transport = yield* CodexProtocol.makeCodexAppServerPatchedProtocol({
    stdio,
    ...(terminationError ? { terminationError } : {}),
    ...(options.logIncoming !== undefined ? { logIncoming: options.logIncoming } : {}),
    ...(options.logOutgoing !== undefined ? { logOutgoing: options.logOutgoing } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
    onNotification: dispatchNotification,
    onRequest: dispatchRequest,
  });

  const request = <M extends CodexRpc.ClientRequestMethod>(
    method: M,
    payload: CodexRpc.ClientRequestParamsByMethod[M],
  ): Effect.Effect<CodexRpc.ClientRequestResponsesByMethod[M], CodexError.CodexAppServerError> =>
    encodeOptionalPayload(method, getClientRequestParamSchema(method), payload).pipe(
      Effect.flatMap((encoded) => transport.request(method, encoded)),
      Effect.flatMap(
        (
          raw,
        ): Effect.Effect<
          CodexRpc.ClientRequestResponsesByMethod[M],
          CodexError.CodexAppServerError
        > => decodeOptionalPayload(method, getClientRequestResponseSchema(method), raw),
      ),
    );

  const notify = <M extends CodexRpc.ClientNotificationMethod>(
    method: M,
    payload: CodexRpc.ClientNotificationParamsByMethod[M],
  ) =>
    encodeOptionalPayload(method, getClientNotificationParamSchema(method), payload).pipe(
      Effect.flatMap((encoded) => transport.notify(method, encoded)),
    );

  const streamTurn = (
    payload: CodexRpc.ClientRequestParamsByMethod["turn/start"],
    streamOptions: CodexAppServerTurnStreamOptions = {},
  ): Stream.Stream<CodexAppServerTurnStreamEvent, CodexError.CodexAppServerError> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const chunkWarningMillis = durationMillis(
          streamOptions.chunkWarningAfter ?? DEFAULT_TURN_STREAM_CHUNK_WARNING_AFTER,
        );
        const chunkTimeoutMillis = durationMillis(
          streamOptions.chunkTimeoutAfter ?? DEFAULT_TURN_STREAM_CHUNK_TIMEOUT_AFTER,
        );
        const afterWarningTimeoutMillis = Math.max(0, chunkTimeoutMillis - chunkWarningMillis);
        const queueCapacity = Math.max(
          1,
          Math.trunc(streamOptions.queueCapacity ?? DEFAULT_TURN_STREAM_QUEUE_CAPACITY),
        );
        const streamQueue = yield* Queue.bounded<
          CodexAppServerTurnStreamEvent,
          CodexError.CodexAppServerError | Cause.Done
        >(queueCapacity);
        const turnIdRef = yield* Ref.make<string | undefined>(undefined);
        const warnedRef = yield* Ref.make(false);
        const doneRef = yield* Ref.make(false);

        const endStream = Ref.set(doneRef, true).pipe(
          Effect.andThen(Queue.end(streamQueue)),
          Effect.asVoid,
        );

        const failStream = (error: CodexError.CodexAppServerError) =>
          Ref.set(doneRef, true).pipe(
            Effect.andThen(Queue.fail(streamQueue, error)),
            Effect.asVoid,
          );

        const offerEvent = (event: CodexAppServerTurnStreamEvent) =>
          Queue.offer(streamQueue, event).pipe(Effect.asVoid);

        const matchesTurn = (threadId: string, turnId: string) =>
          Effect.map(Ref.get(turnIdRef), (currentTurnId) => {
            if (threadId !== payload.threadId) {
              return false;
            }
            return currentTurnId === undefined || currentTurnId === turnId;
          });

        const rememberTurnId = (turnId: string) =>
          Ref.update(turnIdRef, (current) => current ?? turnId);

        const interruptActiveTurn = Effect.gen(function* () {
          const turnId = yield* Ref.get(turnIdRef);
          if (!turnId) {
            return;
          }
          yield* request("turn/interrupt", {
            threadId: payload.threadId,
            turnId,
          }).pipe(Effect.ignore, Effect.forkDetach({ startImmediately: true }));
        });

        const unregisterStarted = yield* registerServerNotificationHandler(
          "turn/started",
          (started) =>
            Effect.gen(function* () {
              if (!(yield* matchesTurn(started.threadId, started.turn.id))) {
                return;
              }
              yield* rememberTurnId(started.turn.id);
              yield* offerEvent({
                _tag: "TurnStarted",
                method: "turn/started",
                payload: started,
              });
            }),
        );

        const unregisterDelta = yield* registerServerNotificationHandler(
          "item/agentMessage/delta",
          (delta) =>
            Effect.gen(function* () {
              if (!(yield* matchesTurn(delta.threadId, delta.turnId))) {
                return;
              }
              yield* rememberTurnId(delta.turnId);
              yield* offerEvent({
                _tag: "AgentMessageDelta",
                method: "item/agentMessage/delta",
                payload: delta,
                textDelta: delta.delta,
              });
            }),
        );

        const unregisterCompleted = yield* registerServerNotificationHandler(
          "turn/completed",
          (completed) =>
            Effect.gen(function* () {
              if (!(yield* matchesTurn(completed.threadId, completed.turn.id))) {
                return;
              }
              yield* rememberTurnId(completed.turn.id);
              yield* offerEvent({
                _tag: "TurnCompleted",
                method: "turn/completed",
                payload: completed,
              });
            }),
        );

        const requestFiber = yield* request("turn/start", payload).pipe(
          Effect.flatMap((response) =>
            rememberTurnId(response.turn.id).pipe(
              Effect.andThen(
                offerEvent({
                  _tag: "TurnStartResponse",
                  method: "turn/start",
                  response,
                }),
              ),
            ),
          ),
          Effect.andThen(endStream),
          Effect.catch(failStream),
          Effect.forkScoped,
        );

        if (streamOptions.abortSignal) {
          yield* awaitAbortSignal(streamOptions.abortSignal).pipe(
            Effect.andThen(interruptActiveTurn),
            Effect.andThen(endStream),
            Effect.forkScoped,
          );
        }

        const cleanup = Effect.gen(function* () {
          yield* unregisterStarted;
          yield* unregisterDelta;
          yield* unregisterCompleted;
          const done = yield* Ref.get(doneRef);
          if (!done) {
            yield* interruptActiveTurn;
          }
          yield* Fiber.interrupt(requestFiber).pipe(Effect.ignore);
          yield* Queue.shutdown(streamQueue).pipe(Effect.ignore);
        });

        const takeNext = Effect.gen(function* () {
          const alreadyWarned = yield* Ref.get(warnedRef);
          const timeoutMillis = alreadyWarned ? afterWarningTimeoutMillis : chunkWarningMillis;
          const maybeEvent = yield* Queue.take(streamQueue).pipe(
            Effect.timeoutOption(Duration.millis(timeoutMillis)),
          );

          if (Option.isSome(maybeEvent)) {
            yield* Ref.set(warnedRef, false);
            return maybeEvent.value;
          }

          const turnId = yield* Ref.get(turnIdRef);
          if (!alreadyWarned) {
            yield* Ref.set(warnedRef, true);
            return {
              _tag: "ChunkTimeoutWarning",
              idleForMillis: chunkWarningMillis,
              method: "turn/start",
              message: `No Codex stream chunk received for ${chunkWarningMillis}ms; continuing to wait up to ${chunkTimeoutMillis}ms total.`,
              threadId: payload.threadId,
              timeoutMillis: chunkTimeoutMillis,
              turnId,
            } satisfies CodexAppServerTurnStreamEvent;
          }

          return yield* new CodexError.CodexAppServerStreamTimeoutError({
            idleForMillis: chunkTimeoutMillis,
            method: "turn/start",
            threadId: payload.threadId,
            timeoutMillis: chunkTimeoutMillis,
            ...(turnId ? { turnId } : {}),
          });
        });

        return Stream.fromEffectRepeat(takeNext).pipe(Stream.ensuring(cleanup));
      }),
    );

  return CodexAppServerClient.of({
    raw: {
      notifications: transport.incomingNotifications,
      requests: transport.incomingRequests,
      request: transport.request,
      notify: transport.notify,
      respond: transport.respond,
      respondError: transport.respondError,
    },
    request,
    notify,
    streamTurn,
    handleServerRequest: (method, handler) =>
      Effect.sync(() => {
        requestHandlers.set(method, handler as ServerRequestHandler);
      }),
    handleServerNotification: (method, handler) =>
      registerServerNotificationHandler(method, handler).pipe(Effect.asVoid),
    handleUnknownServerRequest: (handler) =>
      Effect.sync(() => {
        unknownRequestHandler = handler;
      }),
    handleUnknownServerNotification: (handler) =>
      Effect.sync(() => {
        unknownNotificationHandler = handler;
      }),
  });
});

export const layerChildProcess = (
  handle: ChildProcessSpawner.ChildProcessHandle,
  options: CodexAppServerClientOptions = {},
): Layer.Layer<CodexAppServerClient> => {
  const stdio = makeChildStdio(handle);
  const terminationError = makeTerminationError(handle);
  return Layer.effect(CodexAppServerClient, make(stdio, options, terminationError));
};

export interface CodexAppServerCommandLayerOptions extends CodexAppServerClientOptions {
  readonly command: string;
  readonly args?: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export const layerCommand = (
  options: CodexAppServerCommandLayerOptions,
): Layer.Layer<
  CodexAppServerClient,
  CodexError.CodexAppServerSpawnError,
  ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    CodexAppServerClient,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const command = ChildProcess.make(options.command, [...(options.args ?? [])], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: { ...process.env, ...options.env } } : {}),
        forceKillAfter: DEFAULT_APP_SERVER_FORCE_KILL_AFTER,
        shell: process.platform === "win32",
      });
      return yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (cause) =>
            new CodexError.CodexAppServerSpawnError({
              command: [options.command, ...(options.args ?? [])].join(" "),
              cause,
            }),
        ),
      );
    }).pipe(
      Effect.flatMap((handle) =>
        make(makeChildStdio(handle), options, makeTerminationError(handle)),
      ),
    ),
  );
