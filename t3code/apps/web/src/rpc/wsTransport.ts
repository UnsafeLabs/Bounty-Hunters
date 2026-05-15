import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { RpcClient } from "effect/unstable/rpc";

import { ClientTracingLive } from "../observability/clientTracing";
import { clearAllTrackedRpcRequests } from "./requestLatencyState";
import {
  createWsRpcProtocolLayer,
  makeWsRpcProtocolClient,
  type WsProtocolLifecycleHandlers,
  type WsRpcProtocolClient,
  type WsRpcProtocolSocketUrlProvider,
} from "./protocol";
import { isTransportConnectionErrorMessage } from "./transportError";

interface SubscribeOptions {
  readonly retryDelay?: Duration.Input;
  readonly onResubscribe?: () => void;
  readonly tag?: string;
}

interface RequestOptions {
  readonly timeout?: Option.Option<Duration.Input>;
}

export type WsTransportConnectionState = "connected" | "disconnected" | "reconnecting";

export interface WsTransportConnectionStateObservable {
  readonly getSnapshot: () => WsTransportConnectionState;
  readonly subscribe: (listener: (state: WsTransportConnectionState) => void) => () => void;
}

export interface WsTransportQueueOptions {
  readonly requestQueueMaxAgeMs?: number;
  readonly requestQueueMaxSize?: number;
}

export const WS_TRANSPORT_DEFAULT_REQUEST_QUEUE_MAX_AGE_MS = 30_000;
export const WS_TRANSPORT_DEFAULT_REQUEST_QUEUE_MAX_SIZE = 100;
const DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS = Duration.millis(250);
const NOOP: () => void = () => undefined;

interface TransportSession {
  readonly clientPromise: Promise<WsRpcProtocolClient>;
  readonly clientScope: Scope.Closeable;
  readonly runtime: ManagedRuntime.ManagedRuntime<RpcClient.Protocol, never>;
}

interface StreamRequestStartInfo {
  readonly id: string;
  readonly tag: string;
  readonly stream: boolean;
}

interface QueuedRequest<TSuccess> {
  readonly createdAt: number;
  readonly execute: () => Promise<TSuccess>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: TSuccess) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class WsTransportRequestTimeoutError extends Error {
  override readonly name = "WsTransportRequestTimeoutError";

  constructor(readonly maxAgeMs: number) {
    super(`WebSocket RPC request timed out after ${maxAgeMs}ms in the reconnect queue.`);
  }
}

export class WsTransportRequestQueueOverflowError extends Error {
  override readonly name = "WsTransportRequestQueueOverflowError";

  constructor(readonly maxSize: number) {
    super(`WebSocket RPC reconnect queue exceeded its max size of ${maxSize}.`);
  }
}

function formatErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export class WsTransport {
  private readonly url: WsRpcProtocolSocketUrlProvider;
  private readonly lifecycleHandlers: WsProtocolLifecycleHandlers | undefined;
  private readonly queueMaxAgeMs: number;
  private readonly queueMaxSize: number;
  private disposed = false;
  private hasReportedTransportDisconnect = false;
  private hasConnected = false;
  private intentionalCloseDepth = 0;
  private currentConnectionState: WsTransportConnectionState = "disconnected";
  private flushingQueuedRequests = false;
  private reconnectChain: Promise<void> = Promise.resolve();
  private nextSessionId = 0;
  private activeSessionId = 0;
  private session: TransportSession;
  private lastHeartbeatPongAt = 0;
  private readonly connectionStateListeners = new Set<
    (state: WsTransportConnectionState) => void
  >();
  private readonly queuedRequests: Array<QueuedRequest<unknown>> = [];
  private readonly streamRequestStartListeners = new Set<(info: StreamRequestStartInfo) => void>();
  readonly connectionState: WsTransportConnectionStateObservable = {
    getSnapshot: () => this.currentConnectionState,
    subscribe: (listener) => {
      this.connectionStateListeners.add(listener);
      return () => {
        this.connectionStateListeners.delete(listener);
      };
    },
  };

  constructor(
    url: WsRpcProtocolSocketUrlProvider,
    lifecycleHandlers?: WsProtocolLifecycleHandlers,
    queueOptions?: WsTransportQueueOptions,
  ) {
    this.url = url;
    this.lifecycleHandlers = this.withQueueLifecycle(lifecycleHandlers);
    this.queueMaxAgeMs =
      queueOptions?.requestQueueMaxAgeMs ?? WS_TRANSPORT_DEFAULT_REQUEST_QUEUE_MAX_AGE_MS;
    this.queueMaxSize =
      queueOptions?.requestQueueMaxSize ?? WS_TRANSPORT_DEFAULT_REQUEST_QUEUE_MAX_SIZE;
    this.session = this.createSession();
  }

  async request<TSuccess>(
    execute: (client: WsRpcProtocolClient) => Effect.Effect<TSuccess, Error, never>,
    _options?: RequestOptions,
  ): Promise<TSuccess> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const runRequest = async () => {
      const session = this.session;
      const client = await session.clientPromise;
      return await session.runtime.runPromise(Effect.suspend(() => execute(client)));
    };

    if (this.shouldQueueRequests()) {
      return await this.enqueueRequest(runRequest);
    }

    return await runRequest();
  }

  async requestStream<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
  ): Promise<void> {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const session = this.session;
    const client = await session.clientPromise;
    await session.runtime.runPromise(
      Stream.runForEach(connect(client), (value) =>
        Effect.sync(() => {
          try {
            listener(value);
          } catch {
            // Swallow listener errors so the stream can finish cleanly.
          }
        }),
      ),
    );
  }

  subscribe<TValue>(
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    options?: SubscribeOptions,
  ): () => void {
    if (this.disposed) {
      return () => undefined;
    }

    let active = true;
    let hasReceivedValue = false;
    const retryDelayMs = Duration.toMillis(
      Duration.fromInputUnsafe(options?.retryDelay ?? DEFAULT_SUBSCRIPTION_RETRY_DELAY_MS),
    );
    let cancelCurrentStream: () => void = NOOP;

    void (async () => {
      for (;;) {
        if (!active || this.disposed) {
          return;
        }

        const session = this.session;
        try {
          const runningStream = this.runStreamOnSession(
            session,
            connect,
            listener,
            {
              ...(options?.tag === undefined ? {} : { tag: options.tag }),
              ...(hasReceivedValue
                ? {
                    onStarted: () => {
                      try {
                        options?.onResubscribe?.();
                      } catch {
                        // Swallow reconnect hook errors so the stream can recover.
                      }
                    },
                  }
                : {}),
            },
            () => active,
            () => {
              this.hasReportedTransportDisconnect = false;
              hasReceivedValue = true;
            },
          );
          cancelCurrentStream = runningStream.cancel;
          await runningStream.completed;
          cancelCurrentStream = NOOP;
        } catch (error) {
          cancelCurrentStream = NOOP;
          if (!active || this.disposed) {
            return;
          }

          if (session !== this.session) {
            continue;
          }

          const formattedError = formatErrorMessage(error);
          if (!isTransportConnectionErrorMessage(formattedError)) {
            console.warn("WebSocket RPC subscription failed", {
              error: formattedError,
            });
            return;
          }

          if (!this.hasReportedTransportDisconnect) {
            console.warn("WebSocket RPC subscription disconnected", {
              error: formattedError,
            });
          }
          this.hasReportedTransportDisconnect = true;
          await sleep(retryDelayMs);
        }
      }
    })();

    return () => {
      active = false;
      cancelCurrentStream();
    };
  }

  async reconnect() {
    if (this.disposed) {
      throw new Error("Transport disposed");
    }

    const reconnectOperation = this.reconnectChain.then(async () => {
      if (this.disposed) {
        throw new Error("Transport disposed");
      }

      clearAllTrackedRpcRequests();
      this.lastHeartbeatPongAt = 0;
      this.setConnectionState("reconnecting");
      const previousSession = this.session;
      this.session = this.createSession();
      await this.closeSession(previousSession);
    });

    this.reconnectChain = reconnectOperation.catch(() => undefined);
    await reconnectOperation;
  }

  isHeartbeatFresh(maxAgeMs = 15_000): boolean {
    return this.lastHeartbeatPongAt > 0 && Date.now() - this.lastHeartbeatPongAt <= maxAgeMs;
  }

  async dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.rejectQueuedRequests(new Error("Transport disposed"));
    await this.closeSession(this.session);
  }

  private closeSession(session: TransportSession) {
    this.intentionalCloseDepth += 1;
    return session.runtime.runPromise(Scope.close(session.clientScope, Exit.void)).finally(() => {
      this.intentionalCloseDepth -= 1;
      session.runtime.dispose();
    });
  }

  private createSession(): TransportSession {
    const sessionId = this.nextSessionId + 1;
    this.nextSessionId = sessionId;
    this.activeSessionId = sessionId;
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        createWsRpcProtocolLayer(this.url, {
          ...this.lifecycleHandlers,
          isActive: () => !this.disposed && this.activeSessionId === sessionId,
          isCloseIntentional: () =>
            this.disposed ||
            this.intentionalCloseDepth > 0 ||
            this.lifecycleHandlers?.isCloseIntentional?.() === true,
          onHeartbeatPong: () => {
            this.lastHeartbeatPongAt = Date.now();
            this.lifecycleHandlers?.onHeartbeatPong?.();
          },
          onRequestStart: (info) => {
            this.lifecycleHandlers?.onRequestStart?.(info);
            if (!info.stream) {
              return;
            }
            for (const listener of this.streamRequestStartListeners) {
              listener(info);
            }
          },
        }),
        ClientTracingLive,
      ),
    );
    const clientScope = runtime.runSync(Scope.make());
    return {
      runtime,
      clientScope,
      clientPromise: runtime.runPromise(Scope.provide(clientScope)(makeWsRpcProtocolClient)),
    };
  }

  private enqueueRequest<TSuccess>(execute: () => Promise<TSuccess>): Promise<TSuccess> {
    this.expireQueuedRequests(Date.now());
    while (this.queuedRequests.length >= this.queueMaxSize) {
      const dropped = this.queuedRequests.shift();
      if (!dropped) {
        break;
      }
      clearTimeout(dropped.timeout);
      dropped.reject(new WsTransportRequestQueueOverflowError(this.queueMaxSize));
    }

    return new Promise<TSuccess>((resolve, reject) => {
      let queued: QueuedRequest<TSuccess>;
      queued = {
        createdAt: Date.now(),
        execute,
        reject,
        resolve,
        timeout: setTimeout(() => {
          const index = this.queuedRequests.indexOf(queued as QueuedRequest<unknown>);
          if (index >= 0) {
            this.queuedRequests.splice(index, 1);
          }
          reject(new WsTransportRequestTimeoutError(this.queueMaxAgeMs));
        }, this.queueMaxAgeMs),
      };
      this.queuedRequests.push(queued as QueuedRequest<unknown>);
    });
  }

  private expireQueuedRequests(now: number) {
    for (let index = 0; index < this.queuedRequests.length; ) {
      const queued = this.queuedRequests[index];
      if (!queued || now - queued.createdAt <= this.queueMaxAgeMs) {
        index += 1;
        continue;
      }
      this.queuedRequests.splice(index, 1);
      clearTimeout(queued.timeout);
      queued.reject(new WsTransportRequestTimeoutError(this.queueMaxAgeMs));
    }
  }

  private flushQueuedRequests() {
    if (
      this.disposed ||
      this.flushingQueuedRequests ||
      this.currentConnectionState !== "connected"
    ) {
      return;
    }

    this.flushingQueuedRequests = true;
    void (async () => {
      try {
        for (;;) {
          this.expireQueuedRequests(Date.now());
          const queued = this.queuedRequests.shift();
          if (!queued) {
            return;
          }
          if (this.disposed) {
            clearTimeout(queued.timeout);
            queued.reject(new Error("Transport disposed"));
            continue;
          }
          if (this.currentConnectionState !== "connected") {
            this.queuedRequests.unshift(queued);
            return;
          }

          clearTimeout(queued.timeout);
          try {
            queued.resolve(await queued.execute());
          } catch (error) {
            queued.reject(error);
          }
        }
      } finally {
        this.flushingQueuedRequests = false;
        if (this.currentConnectionState === "connected" && this.queuedRequests.length > 0) {
          this.flushQueuedRequests();
        }
      }
    })();
  }

  private rejectQueuedRequests(error: unknown) {
    for (const queued of this.queuedRequests.splice(0)) {
      clearTimeout(queued.timeout);
      queued.reject(error);
    }
  }

  private setConnectionState(state: WsTransportConnectionState) {
    if (this.currentConnectionState === state) {
      return;
    }
    this.currentConnectionState = state;
    for (const listener of this.connectionStateListeners) {
      try {
        listener(state);
      } catch {
        // Listener failures should not affect transport recovery.
      }
    }
  }

  private shouldQueueRequests() {
    return (
      this.currentConnectionState !== "connected" ||
      this.flushingQueuedRequests ||
      this.queuedRequests.length > 0
    );
  }

  private withQueueLifecycle(
    handlers?: WsProtocolLifecycleHandlers,
  ): WsProtocolLifecycleHandlers | undefined {
    return {
      ...handlers,
      onOpen: () => {
        this.hasConnected = true;
        this.setConnectionState("connected");
        handlers?.onOpen?.();
        this.flushQueuedRequests();
      },
      onError: (message) => {
        this.setConnectionState(this.hasConnected ? "reconnecting" : "disconnected");
        handlers?.onError?.(message);
        this.expireQueuedRequests(Date.now());
      },
      onClose: (details, context) => {
        if (!context.intentional) {
          this.setConnectionState(this.hasConnected ? "reconnecting" : "disconnected");
        }
        handlers?.onClose?.(details, context);
      },
    };
  }

  private runStreamOnSession<TValue>(
    session: TransportSession,
    connect: (client: WsRpcProtocolClient) => Stream.Stream<TValue, Error, never>,
    listener: (value: TValue) => void,
    requestStart: {
      readonly tag?: string;
      readonly onStarted?: () => void;
    },
    isActive: () => boolean,
    markValueReceived: () => void,
  ): {
    readonly cancel: () => void;
    readonly completed: Promise<void>;
  } {
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => {
      resolveCompleted = resolve;
      rejectCompleted = reject;
    });
    let requestStartListener: ((info: StreamRequestStartInfo) => void) | null = null;
    if (requestStart.onStarted) {
      requestStartListener = (info) => {
        if (!isActive() || !info.stream) {
          return;
        }
        if (requestStart.tag !== undefined && info.tag !== requestStart.tag) {
          return;
        }
        requestStart.onStarted?.();
        if (requestStartListener) {
          this.streamRequestStartListeners.delete(requestStartListener);
          requestStartListener = null;
        }
      };
      this.streamRequestStartListeners.add(requestStartListener);
    }
    const cancel = session.runtime.runCallback(
      Effect.promise(() => session.clientPromise).pipe(
        Effect.flatMap((client) =>
          Stream.runForEach(connect(client), (value) =>
            Effect.sync(() => {
              if (!isActive()) {
                return;
              }

              markValueReceived();
              try {
                listener(value);
              } catch {
                // Swallow listener errors so the stream stays live.
              }
            }),
          ),
        ),
      ),
      {
        onExit: (exit) => {
          if (requestStartListener) {
            this.streamRequestStartListeners.delete(requestStartListener);
            requestStartListener = null;
          }
          if (Exit.isSuccess(exit)) {
            resolveCompleted();
            return;
          }

          rejectCompleted(Cause.squash(exit.cause));
        },
      },
    );

    return {
      cancel,
      completed,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
