/**
 * HTTP route layer for the aggregated metrics endpoint.
 *
 * Exposes GET /metrics/aggregated returning all windows as JSON array.
 */

import * as Effect from "effect/Effect";
import * as HttpRouter from "effect/unstable/http";
import * as HttpServerResponse from "effect/unstable/http";

import { MetricsAggregator } from "./Services/MetricsAggregator.ts";

export const metricsAggregatedRouteLayer = HttpRouter.add(
  "GET",
  "/metrics/aggregated",
  Effect.gen(function* () {
    const aggregator = yield* MetricsAggregator;
    const windows = yield* aggregator.readWindows();
    return HttpServerResponse.jsonUnsafe(windows, { status: 200 });
  }),
);
