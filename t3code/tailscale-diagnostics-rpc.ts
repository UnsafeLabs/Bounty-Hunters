/**
 * Tailscale Diagnostics RPC endpoint (#844)
 */

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TailscaleDiagnostics, PeerDiagnostics, LatencyRecord } from "./TailscaleDiagnostics.js";

export const DiagnosePeerRequest = Schema.Struct({
  peerId: Schema.String,
});
export type DiagnosePeerRequest = typeof DiagnosePeerRequest.Type;

export const DiagnosePeerResponse = Schema.Struct({
  diagnostics: PeerDiagnostics,
  latencyHistory: Schema.Array(LatencyRecord),
});
export type DiagnosePeerResponse = typeof DiagnosePeerResponse.Type;

export const registerDiagnosticsRpc = Effect.gen(function* (_) {
  const diagnostics = yield* _(TailscaleDiagnostics);

  return {
    method: "tailscale.diagnosePeer",
    handler: (req: DiagnosePeerRequest) =>
      Effect.gen(function* (_) {
        const result = yield* _(diagnostics.diagnosePeer(req.peerId));
        const history = yield* _(diagnostics.getLatencyHistory(req.peerId));
        return { diagnostics: result, latencyHistory: history };
      }),
  };
});
