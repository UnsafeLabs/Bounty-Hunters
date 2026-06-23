import * as Schema from "effect/Schema";

import { PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Wire contract for Tailscale peer diagnostics. The implementation that runs the
 * `tailscale` CLI lives in `@t3tools/tailscale` (server-only, depends on the
 * process spawner); this module mirrors its result shape as a transport schema
 * so the web UI can consume it without pulling node-only code into the bundle.
 */

export const TailscalePeerConnectionType = Schema.Literals(["direct", "relayed", "unknown"]);
export type TailscalePeerConnectionType = typeof TailscalePeerConnectionType.Type;

export const TailscaleRelayInfo = Schema.Struct({
  name: Schema.String,
  region: Schema.String,
});
export type TailscaleRelayInfo = typeof TailscaleRelayInfo.Type;

export const PeerDiagnostics = Schema.Struct({
  peer: Schema.String,
  hostName: Schema.NullOr(Schema.String),
  online: Schema.Boolean,
  connectionType: TailscalePeerConnectionType,
  peerIp: Schema.NullOr(Schema.String),
  directEndpoint: Schema.NullOr(Schema.String),
  relay: Schema.NullOr(TailscaleRelayInfo),
  latencyMs: Schema.NullOr(Schema.Number),
  latencySamples: Schema.Array(Schema.Number),
  lastSeen: Schema.NullOr(Schema.String),
  tailnetIpv4Addresses: Schema.Array(Schema.String),
});
export type PeerDiagnostics = typeof PeerDiagnostics.Type;

export const TailscaleDiagnosePeerInput = Schema.Struct({
  /** Runner identity: hostname, MagicDNS label, or tailnet IP of the peer. */
  peer: TrimmedNonEmptyString,
  /** Number of pings to send for the latency graph; defaults to 10 server-side. */
  pingCount: Schema.optional(PositiveInt),
});
export type TailscaleDiagnosePeerInput = typeof TailscaleDiagnosePeerInput.Type;

export const TailscaleDiagnosticsErrorKind = Schema.Literals([
  "unavailable",
  "peer-unknown",
  "parse-error",
  "command-failed",
  "timeout",
]);
export type TailscaleDiagnosticsErrorKind = typeof TailscaleDiagnosticsErrorKind.Type;

export class TailscaleDiagnosticsError extends Schema.TaggedErrorClass<TailscaleDiagnosticsError>()(
  "TailscaleDiagnosticsError",
  {
    kind: TailscaleDiagnosticsErrorKind,
    detail: TrimmedNonEmptyString,
  },
) {
  override get message(): string {
    return this.detail;
  }
}
