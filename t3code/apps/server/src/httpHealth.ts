import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import { HealthMonitor } from "./process/healthMonitor.ts";

export const healthRouteLayer = HttpRouter.add(
  "GET",
  "/health",
  Effect.gen(function* () {
    const monitor = yield* HealthMonitor;
    const state = yield* monitor.health;
    const status = state.healthy ? 200 : 503;
    return HttpServerResponse.jsonUnsafe(state, { status });
  }),
);
