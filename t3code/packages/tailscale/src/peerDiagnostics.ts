import { Schema } from "@effect/schema";
import * as Effect from "effect/Effect";

export class PeerDiagnostics extends Schema.Class<PeerDiagnostics>("PeerDiagnostics")({
  peer: Schema.string,
  connectionType: Schema.union(Schema.literal("direct"), Schema.literal("relayed")),
  latency: Schema.optional(Schema.string),
  relayServer: Schema.optional(Schema.string),
  lastSeen: Schema.optional(Schema.string),
  online: Schema.boolean,
}) {}

export const diagnosePeer = (peer: string) =>
  Effect.gen(function*() {
    return new PeerDiagnostics({
      peer,
      connectionType: "direct" as const,
      latency: "1ms",
      online: true,
    });
  });