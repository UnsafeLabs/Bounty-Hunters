import type {
	ServerDiagnoseTailscalePeerInput,
	ServerDiagnoseTailscalePeerResult,
} from "@t3tools/contracts";
import * as Chunk from "effect/Chunk";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface TailscaleDiagnosticsShape {
	readonly diagnosePeer: (
		input: ServerDiagnoseTailscalePeerInput,
	) => Effect.Effect<ServerDiagnoseTailscalePeerResult>;
}

export class TailscaleDiagnostics extends Context.Service<
	TailscaleDiagnostics,
	TailscaleDiagnosticsShape
>()("t3/diagnostics/TailscaleDiagnostics") {}

const make = (): TailscaleDiagnosticsShape => {
	const { diagnosePeer: dp, getPingHistory: gph } = (() => {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const tailscale = require("@t3tools/tailscale");
		return {
			diagnosePeer: dp,
			getPingHistory: gph,
		};
	})();

	return {
		diagnosePeer: (input) =>
			Effect.gen(function* () {
				const result = yield* dp(input.peer);
				const history = yield* gph(input.peer);
				return {
					peer: result.peer,
					connectionType: result.connectionType,
					latencyMs: result.latencyMs,
					relayServer: result.relayServer,
					relayLocation: result.relayLocation,
					lastSeen: result.lastSeen,
					success: result.success,
					error: result.error,
					pingHistory: Chunk.toArray(history).map((ping) => ({
						peer: ping.peer,
						latencyMs: ping.latencyMs,
						connectionType: ping.connectionType,
						relayServer: ping.relayServer,
						timestamp: ping.timestamp,
					})),
				} satisfies ServerDiagnoseTailscalePeerResult;
			}),
	};
};

export const layer = Layer.effect(TailscaleDiagnostics, Effect.sync(make));