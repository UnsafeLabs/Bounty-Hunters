import { Effect, Schedule, Ref, Schema } from "effect";

export const SSHTunnelConfig = Schema.Struct({
  host: Schema.String,
  port: Schema.Number.pipe(Schema.positive),
  username: Schema.String,
  localPort: Schema.Number.pipe(Schema.positive),
  remoteHost: Schema.String,
  remotePort: Schema.Number.pipe(Schema.positive),
  keepaliveInterval: Schema.Number.pipe(Schema.positive),
  keepaliveCountMax: Schema.Number.pipe(Schema.positive),
  reconnectDelay: Schema.Number.pipe(Schema.positive),
  maxReconnectAttempts: Schema.Number.pipe(Schema.nonNegative),
});

export type SSHTunnelConfigType = Schema.Schema.Type<typeof SSHTunnelConfig>;

export class SSHConnectionError extends Error {
  readonly _tag = "SSHConnectionError";
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
  }
}

export const SSHTunnelManager = Effect.gen(function* (_) {
  const config = yield* _(Effect.config(SSHTunnelConfig));
  const connectionRef = yield* _(Ref.make<{
    status: "connected" | "disconnected" | "reconnecting";
    lastPing: number;
    reconnectAttempts: number;
  }>({ status: "disconnected", lastPing: 0, reconnectAttempts: 0 }));

  const keepalive = Effect.gen(function* (_) {
    while (true) {
      yield* _(Effect.sleep(Duration.millis(config.keepaliveInterval)));

      const state = yield* _(Ref.get(connectionRef));
      if (state.status !== "connected") continue;

      try {
        // Send SSH keepalive @openssh.com request
        yield* _(
          Effect.try({
            try: () => {
              // In real impl: connection.sendKeepalive()
            },
            catch: () => new SSHConnectionError("Keepalive failed"),
          })
        );

        yield* _(Ref.update(connectionRef, (s) => ({
          ...s,
          lastPing: Date.now(),
        })));
      } catch {
        yield* _(Ref.update(connectionRef, (s) => ({
          ...s,
          status: "reconnecting",
        })));
        yield* _(reconnect());
      }
    }
  });

  const reconnect = Effect.gen(function* (_) {
    const state = yield* _(Ref.get(connectionRef));

    if (state.reconnectAttempts >= config.maxReconnectAttempts) {
      yield* _(Ref.set(connectionRef, {
        status: "disconnected",
        lastPing: 0,
        reconnectAttempts: 0,
      }));
      return yield* _(Effect.fail(new SSHConnectionError("Max reconnect attempts exceeded")));
    }

    yield* _(Ref.update(connectionRef, (s) => ({
      ...s,
      status: "reconnecting",
      reconnectAttempts: s.reconnectAttempts + 1,
    })));

    const delay = Math.min(
      config.reconnectDelay * Math.pow(2, state.reconnectAttempts),
      30000 // Max 30 seconds
    );

    yield* _(Effect.sleep(Duration.millis(delay)));

    // Attempt reconnection
    const connected = yield* _(
      Effect.try({
        try: () => true, // In real impl: establish SSH connection
        catch: () => false,
      }).pipe(Effect.orElseSucceed(() => false))
    );

    if (connected) {
      yield* _(Ref.set(connectionRef, {
        status: "connected",
        lastPing: Date.now(),
        reconnectAttempts: 0,
      }));
    }
  });

  const getStatus = Effect.gen(function* (_) {
    const state = yield* _(Ref.get(connectionRef));
    const timeSincePing = Date.now() - state.lastPing;
    const isAlive = state.status === "connected" &&
      timeSincePing < config.keepaliveInterval * config.keepaliveCountMax;

    return {
      ...state,
      isAlive,
      timeSinceLastPing: timeSincePing,
    };
  });

  const startKeepalive = Effect.gen(function* (_) {
    yield* _(Ref.set(connectionRef, {
      status: "connected",
      lastPing: Date.now(),
      reconnectAttempts: 0,
    }));
    yield* _(keepalive.pipe(Effect.fork));
  });

  return { startKeepalive, reconnect, getStatus };
});

// Helper for Duration
const Duration = {
  millis: (ms: number) => ms,
};
