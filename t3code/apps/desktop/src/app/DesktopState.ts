import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface DesktopStateShape {
  readonly backendReady: Ref.Ref<boolean>;
  readonly setBackendReady: (ready: boolean) => Effect.Effect<void>;
  readonly onBackendReadyChange: (
    listener: (ready: boolean) => Effect.Effect<void>,
  ) => Effect.Effect<() => Effect.Effect<void>>;
  readonly quitting: Ref.Ref<boolean>;
}

export class DesktopState extends Context.Service<DesktopState, DesktopStateShape>()(
  "t3/desktop/State",
) {}

export const layer = Layer.effect(
  DesktopState,
  Effect.gen(function* () {
    const backendReady = yield* Ref.make(false);
    const backendReadyListeners = yield* Ref.make<
      ReadonlySet<(ready: boolean) => Effect.Effect<void>>
    >(new Set());
    const quitting = yield* Ref.make(false);

    const notifyBackendReadyListeners = (ready: boolean) =>
      Ref.get(backendReadyListeners).pipe(
        Effect.flatMap((listeners) =>
          Effect.forEach(listeners, (listener) => listener(ready), {
            discard: true,
          }),
        ),
      );

    return {
      backendReady,
      setBackendReady: (ready) =>
        Ref.modify(backendReady, (current) => [current !== ready, ready] as const).pipe(
          Effect.flatMap((changed) => (changed ? notifyBackendReadyListeners(ready) : Effect.void)),
        ),
      onBackendReadyChange: (listener) =>
        Ref.update(backendReadyListeners, (listeners) => new Set([...listeners, listener])).pipe(
          Effect.as(() =>
            Ref.update(backendReadyListeners, (listeners) => {
              const next = new Set(listeners);
              next.delete(listener);
              return next;
            }),
          ),
        ),
      quitting,
    };
  }),
);
