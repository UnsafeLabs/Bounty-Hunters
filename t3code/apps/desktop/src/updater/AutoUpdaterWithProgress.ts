import { Effect, Ref, Schema } from "effect";

/**
 * Fix: Add update download progress, defer, and skip version (#842)
 */

export interface UpdateState {
  version: string;
  progress: number;
  downloading: boolean;
  deferred: boolean;
  skippedVersions: string[];
}

export const AutoUpdaterWithProgress = Effect.gen(function* (_) {
  const stateRef = yield* _(Ref.make<UpdateState>({
    version: "",
    progress: 0,
    downloading: false,
    deferred: false,
    skippedVersions: [],
  }));

  const onProgress = (progress: number, version: string) =>
    Ref.update(stateRef, (s) => ({
      ...s,
      progress,
      downloading: progress < 100,
      version,
    }));

  const deferUpdate = Effect.gen(function* (_) {
    yield* _(Ref.update(stateRef, (s) => ({ ...s, deferred: true })));
  });

  const skipVersion = (version: string) =>
    Effect.gen(function* (_) {
      yield* _(Ref.update(stateRef, (s) => ({
        ...s,
        skippedVersions: [...s.skippedVersions, version],
      })));
    });

  const shouldNotify = (version: string) =>
    Effect.gen(function* (_) {
      const state = yield* _(Ref.get(stateRef));
      return !state.skippedVersions.includes(version) && !state.deferred;
    });

  const getState = Ref.get(stateRef);

  return { onProgress, deferUpdate, skipVersion, shouldNotify, getState };
});
