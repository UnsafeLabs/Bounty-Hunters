import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as NetService from "@t3tools/shared/Net";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export type TunnelState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "failed";

export interface TunnelStateChange {
  readonly previousState: TunnelState;
  readonly newState: TunnelState;
  readonly timestamp: number;
}

export interface KeepaliveConfig {
  readonly interval: Duration.Duration;
  readonly maxFailures: number;
  readonly reconnectBackoff: ReadonlyArray<Duration.Duration>;
  readonly maxReconnectAttempts: number;
}

export const defaultKeepaliveConfig: KeepaliveConfig = {
  interval: Duration.seconds(15),
  maxFailures: 3,
  reconnectBackoff: [
    Duration.seconds(1),
    Duration.seconds(4),
    Duration.seconds(16),
    Duration.seconds(60),
  ],
  maxReconnectAttempts: 5,
};

export interface TunnelKeepaliveShape {
  readonly start: (
    probeHost: string,
    probePort: number,
    onReconnect: () => Effect.Effect<void>,
    onFatalFailure: () => Effect.Effect<void>,
  ) => Effect.Effect<void, never, Scope.Scope>;

  readonly stop: () => Effect.Effect<void>;

  readonly getState: Effect.Effect<TunnelState>;

  readonly stateChanges: Stream.Stream<TunnelStateChange>;
}

export class TunnelKeepaliveError extends Error {
  readonly _tag = "TunnelKeepaliveError";
  constructor(message: string) {
    super(message);
  }
}

export function makeTunnelKeepalive(
  config: KeepaliveConfig = defaultKeepaliveConfig,
) {
  return Effect.gen(function* () {
    const stateRef = yield* Ref.make<TunnelState>("connecting");
    const failuresRef = yield* Ref.make(0);
    const reconnectAttemptsRef = yield* Ref.make(0);
    const manualStopRef = yield* Ref.make(false);

    const stateChangesHub = yield* Effect.sync(() => {
      const listeners: Array<(change: TunnelStateChange) => void> = [];
      return {
        subscribe: (listener: (change: TunnelStateChange) => void) => {
          listeners.push(listener);
          return () => {
            const idx = listeners.indexOf(listener);
            if (idx >= 0) listeners.splice(idx, 1);
          };
        },
        emit: (change: TunnelStateChange) => {
          for (const listener of listeners) {
            listener(change);
          }
        },
      };
    });

    let monitorFiber: Fiber.RuntimeFiber<void, never> | null = null;

    const setState = (newState: TunnelState) =>
      Effect.gen(function* () {
        const previous = yield* Ref.get(stateRef);
        if (previous !== newState) {
          yield* Ref.set(stateRef, newState);
          stateChangesHub.emit({
            previousState: previous,
            newState,
            timestamp: Date.now(),
          });
        }
      });

    const probeConnection = (host: string, port: number) =>
      Effect.gen(function* () {
        try {
          yield* Effect.sleep(Duration.seconds(2));
          return true;
        } catch {
          return false;
        }
      });

    const start: TunnelKeepaliveShape["start"] = (
      probeHost,
      probePort,
      onReconnect,
      onFatalFailure,
    ) =>
      Effect.gen(function* () {
        yield* Ref.set(stateRef, "connecting");
        yield* Ref.set(manualStopRef, false);

        const fiber = yield* Effect.gen(function* () {
          yield* setState("connected");

          yield* Effect.gen(function* () {
            const isAlive = yield* probeConnection(probeHost, probePort);

            if (isAlive) {
              yield* Ref.set(failuresRef, 0);
              yield* Effect.sleep(config.interval);
            } else {
              const failures = yield* Ref.updateAndGet(
                failuresRef,
                (n) => n + 1,
              );

              if (failures >= config.maxFailures) {
                const wasManualStop = yield* Ref.get(manualStopRef);
                if (wasManualStop) return;

                yield* setState("reconnecting");
                const attempts = yield* Ref.updateAndGet(
                  reconnectAttemptsRef,
                  (n) => n + 1,
                );

                if (attempts > config.maxReconnectAttempts) {
                  yield* setState("failed");
                  yield* onFatalFailure();
                  return;
                }

                const backoffIndex = Math.min(attempts - 1, config.reconnectBackoff.length - 1);
                const backoff = config.reconnectBackoff[backoffIndex];
                yield* Effect.sleep(backoff);

                yield* onReconnect();
                yield* Ref.set(failuresRef, 0);
                yield* setState("connected");
              }
            }
          }).pipe(
            Effect.repeat(Schedule.forever),
            Effect.catchAll(() => Effect.void),
          );
        }).pipe(
          Effect.forkDaemon,
        );

        monitorFiber = fiber;

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* Ref.set(manualStopRef, true);
            if (monitorFiber) {
              yield* Fiber.interrupt(monitorFiber);
            }
          }),
        );
      });

    const stop: TunnelKeepaliveShape["stop"] = () =>
      Effect.gen(function* () {
        yield* Ref.set(manualStopRef, true);
        if (monitorFiber) {
          yield* Fiber.interrupt(monitorFiber);
          monitorFiber = null;
        }
      });

    const getState: TunnelKeepaliveShape["getState"] = Ref.get(stateRef);

    const stateChanges: TunnelKeepaliveShape["stateChanges"] = Stream.async<
      TunnelStateChange,
      never
    >((emit) => {
      const unsubscribe = stateChangesHub.subscribe((change) => {
        emit({ _tag: "Emit", value: change });
      });
      return Effect.sync(unsubscribe);
    });

    return { start, stop, getState, stateChanges } satisfies TunnelKeepaliveShape;
  });
}
