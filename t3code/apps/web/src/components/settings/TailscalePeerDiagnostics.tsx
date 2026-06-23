import { ActivityIcon, AlertTriangleIcon } from "lucide-react";
import { useCallback, useState, type FormEvent, type ReactNode } from "react";
import type { PeerDiagnostics } from "@t3tools/contracts";

import { ensureLocalApi } from "../../localApi";
import {
  buildLatencyGraphModel,
  formatConnectionType,
  formatLatencyMs,
  MAX_LATENCY_GRAPH_SAMPLES,
} from "../../lib/tailscalePeerDiagnostics";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsSection } from "./settingsLayout";

const RUNNER_INPUT_LABEL = "Runner peer hostname or IP";

function DiagnosticsField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border/60 px-4 py-2.5 text-xs first:border-t-0 sm:px-5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium text-foreground">{children}</span>
    </div>
  );
}

function LatencyGraph({ samples }: { samples: readonly number[] }) {
  const model = buildLatencyGraphModel(samples, MAX_LATENCY_GRAPH_SAMPLES);

  if (model.bars.length === 0) {
    return (
      <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground sm:px-5">
        No ping responses were received, so there is no latency to plot.
      </div>
    );
  }

  return (
    <div className="space-y-2 border-t border-border/60 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Latency over the last {model.sampleCount} pings</span>
        <span>
          last {formatLatencyMs(model.latestLatencyMs)} · avg{" "}
          {formatLatencyMs(model.averageLatencyMs)} · max {formatLatencyMs(model.maxLatencyMs)}
        </span>
      </div>
      <div
        className="flex h-28 items-end gap-1 overflow-hidden rounded-sm bg-muted/10 p-2"
        role="img"
        aria-label={`Latency graph for the last ${model.sampleCount} pings`}
        data-testid="tailscale-latency-graph"
      >
        {model.bars.map((bar) => (
          <Tooltip key={bar.index}>
            <TooltipTrigger
              render={
                <div className="flex h-full min-w-1 flex-1 items-end">
                  <div
                    className="w-full rounded-t-sm bg-foreground/60 transition-colors"
                    style={{ height: `${bar.heightPercent}%` }}
                    aria-label={`Ping ${bar.index}: ${formatLatencyMs(bar.latencyMs)}`}
                  />
                </div>
              }
            />
            <TooltipPopup side="top">
              Ping {bar.index}: {formatLatencyMs(bar.latencyMs)}
            </TooltipPopup>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

function PeerDiagnosticsDetails({ diagnostics }: { diagnostics: PeerDiagnostics }) {
  const relay =
    diagnostics.relay === null
      ? "—"
      : diagnostics.relay.region.length > 0
        ? `${diagnostics.relay.name} (${diagnostics.relay.region})`
        : diagnostics.relay.name;
  const tailnetIps =
    diagnostics.tailnetIpv4Addresses.length > 0
      ? diagnostics.tailnetIpv4Addresses.join(", ")
      : "—";

  return (
    <div className="rounded-2xl border bg-card text-card-foreground">
      <DiagnosticsField label="Peer">{diagnostics.peer}</DiagnosticsField>
      <DiagnosticsField label="Host name">{diagnostics.hostName ?? "—"}</DiagnosticsField>
      <DiagnosticsField label="Status">
        <span className={diagnostics.online ? "text-emerald-500" : "text-muted-foreground"}>
          {diagnostics.online ? "Online" : "Offline"}
        </span>
      </DiagnosticsField>
      <DiagnosticsField label="Connection">
        {formatConnectionType(diagnostics.connectionType)}
      </DiagnosticsField>
      <DiagnosticsField label="Latency">{formatLatencyMs(diagnostics.latencyMs)}</DiagnosticsField>
      <DiagnosticsField label="Peer IP">{diagnostics.peerIp ?? "—"}</DiagnosticsField>
      <DiagnosticsField label="Direct endpoint">
        {diagnostics.directEndpoint ?? "—"}
      </DiagnosticsField>
      <DiagnosticsField label="Relay">{relay}</DiagnosticsField>
      <DiagnosticsField label="Tailnet IPv4">{tailnetIps}</DiagnosticsField>
      <DiagnosticsField label="Last seen">{diagnostics.lastSeen ?? "—"}</DiagnosticsField>
      <LatencyGraph samples={diagnostics.latencySamples} />
    </div>
  );
}

export function TailscalePeerDiagnosticsSection() {
  const [peer, setPeer] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PeerDiagnostics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = peer.trim();
      if (trimmed.length === 0 || isRunning) {
        return;
      }
      setIsRunning(true);
      setError(null);
      void ensureLocalApi()
        .server.diagnoseTailscalePeer({ peer: trimmed, pingCount: MAX_LATENCY_GRAPH_SAMPLES })
        .then((diagnostics) => {
          setResult(diagnostics);
        })
        .catch((cause: unknown) => {
          setResult(null);
          setError(cause instanceof Error ? cause.message : "Failed to run peer diagnostics.");
        })
        .finally(() => {
          setIsRunning(false);
        });
    },
    [peer, isRunning],
  );

  return (
    <SettingsSection title="Tailscale Peer Diagnostics" icon={<ActivityIcon className="size-3.5" />}>
      <form className="space-y-3 px-4 py-3 sm:px-5" onSubmit={runDiagnostics}>
        <p className="text-xs text-muted-foreground">
          Pick a runner by its Tailscale hostname, MagicDNS label, or tailnet IP to probe its
          connection and plot latency over the last {MAX_LATENCY_GRAPH_SAMPLES} pings.
        </p>
        <div className="flex items-center gap-2">
          <Input
            nativeInput
            aria-label={RUNNER_INPUT_LABEL}
            placeholder="runner-1 or 100.x.y.z"
            value={peer}
            disabled={isRunning}
            onChange={(event) => setPeer(event.currentTarget.value)}
          />
          <Button type="submit" disabled={isRunning || peer.trim().length === 0}>
            {isRunning ? <Spinner /> : null}
            {isRunning ? "Running…" : "Run diagnostics"}
          </Button>
        </div>
      </form>

      {error ? (
        <div className="flex items-start gap-2 border-t border-border/60 px-4 py-3 text-xs text-destructive sm:px-5">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      {result ? (
        <div className="border-t border-border/60 px-4 py-3 sm:px-5">
          <PeerDiagnosticsDetails diagnostics={result} />
        </div>
      ) : null}
    </SettingsSection>
  );
}
