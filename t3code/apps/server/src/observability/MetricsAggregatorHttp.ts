/**
 * HTTP route layer for exposing sliding-window aggregated metrics.
 *
 * Mounts a GET endpoint at /.well-known/t3/metrics that returns the
 * current sliding window of RPC metrics as JSON.
 *
 * @module MetricsAggregatorHttp
 */

import * as Effect from "effect/Effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";

import { MetricsAggregator } from "./MetricsAggregator.ts";

const METRICS_PATH = "/.well-known/t3/metrics";

/**
 * HTTP route that returns aggregated metrics as JSON.
 */
export const metricsRouteLayer = HttpRouter.add(
  "GET",
  METRICS_PATH,
  Effect.gen(function* () {
    const service = yield* MetricsAggregator;
    const metrics = yield* service.getAggregatedMetrics;
    return HttpServerResponse.jsonUnsafe(metrics, {
      status: 200,
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  }),
);
