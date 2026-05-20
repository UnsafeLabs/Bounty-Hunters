import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export interface HealthCheckInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string | undefined;
}

export interface HealthState {
  readonly healthy: boolean;
  readonly restartCount: number;
  readonly lastCheckedAt: number;
  readonly lastError: string | null;
}

export type HealthEvent =
  | { readonly type: "healthy" }
  | { readonly type: "unhealthy"; readonly error: string }
  | { readonly type: "restarted" };

export interface HealthMonitorShape {
  readonly health: Effect.Effect<HealthState>;
  readonly events: PubSub.PubSub<HealthEvent>;
  readonly check: Effect.Effect<HealthState>;
  readonly monitor: (input: HealthCheckInput) => Effect.Effect<void>;
}

export class HealthMonitor extends Context.Service<HealthMonitor, HealthMonitorShape>()(
  "t3/process/HealthMonitor",
) {}

const INITIAL_BACKOFF = Duration.seconds(1);
const MAX_BACKOFF = Duration.minutes(5);
const HEALTH_CHECK_INTERVAL = Duration.seconds(30);

export const make = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const state = yield* Ref.make<HealthState>({
    healthy: true,
    restartCount: 0,
    lastCheckedAt: Date.now(),
    lastError: null,
  });
  const events = yield* PubSub.unbounded<HealthEvent>();

  const runCheck = (input: HealthCheckInput) =>
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(input.command, [...input.args], {
          ...(input.cwd ? { cwd: input.cwd } : {}),
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        }),
      );
      const code = yield* child.exitCode;
      const now = Date.now();
      const isHealthy = code === 0;
      yield* Ref.update(state, (s) => ({
        ...s,
        healthy: isHealthy,
        lastCheckedAt: now,
        lastError: isHealthy ? null : `Process exited with code ${code}`,
      }));
      yield* PubSub.publish(events, isHealthy ? { type: "healthy" } : {
        type: "unhealthy",
        error: `Process exited with code ${code}`,
      });
      return isHealthy;
    }).pipe(
      Effect.catch((error: unknown) =>
        Effect.gen(function* () {
          const now = Date.now();
          const msg = error instanceof Error ? error.message : String(error);
          yield* Ref.update(state, (s) => ({
            ...s,
            healthy: false,
            lastCheckedAt: now,
            lastError: msg,
          }));
          yield* PubSub.publish(events, { type: "unhealthy", error: msg });
          return false;
        }),
      ),
    );

  const restart = (input: HealthCheckInput) =>
    Effect.gen(function* () {
      yield* Ref.update(state, (s) => ({ ...s, restartCount: s.restartCount + 1 }));
      yield* PubSub.publish(events, { type: "restarted" });
      yield* Effect.sleep(INITIAL_BACKOFF);
    });

  const monitor: HealthMonitorShape["monitor"] = (input) =>
    Effect.loop(
      true,
      {
        while: (running) => running,
        body: () =>
          runCheck(input).pipe(
            Effect.tap((ok) =>
              ok ? Effect.void : restart(input)
            ),
            Effect.andThen(Effect.sleep(HEALTH_CHECK_INTERVAL)),
          ),
        step: Effect.void,
        discard: true,
      },
    ).pipe(Effect.forkScoped);

  return HealthMonitor.of({
    health: Ref.get(state),
    events,
    check: Ref.get(state),
    monitor,
  });
});

export const layer = Layer.effect(HealthMonitor, make);
