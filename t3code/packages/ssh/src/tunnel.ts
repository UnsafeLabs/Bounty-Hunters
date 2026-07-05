import * as NodeNet from "node:net";

import type {
  DesktopSshEnvironmentBootstrap,
  DesktopSshEnvironmentTarget,
} from "@t3tools/contracts";
import * as NetService from "@t3tools/shared/Net";
import { extractJsonObject, fromLenientJson } from "@t3tools/shared/schemaJson";
import { satisfiesSemverRange } from "@t3tools/shared/semver";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  buildSshChildEnvironment,
  type SshAuthOptions,
  SshPasswordPrompt,
  isSshAuthFailure,
} from "./auth.ts";
import {
  baseSshArgs,
  buildSshHostSpecEffect,
  collectProcessOutput,
  getLastNonEmptyOutputLine,
  remoteStateKey,
  resolveSshTarget,
  runSshCommand,
  targetConnectionKey,
} from "./command.ts";
import {
  SshCommandError,
  SshHttpBridgeError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "./errors.ts";

export const DEFAULT_REMOTE_PORT = 3773;
const REMOTE_PORT_SCAN_WINDOW = 200;
const SSH_READY_TIMEOUT_MS = 20_000;
const SSH_READY_PROBE_TIMEOUT_MS = 1_000;
const TUNNEL_SHUTDOWN_TIMEOUT_MS = 2_000;
const REMOTE_READY_TIMEOUT_MS = 15_000;
const REMOTE_REUSE_READY_TIMEOUT_MS = 2_000;
const SSH_TUNNEL_HEALTH_INTERVAL_MS = 15_000;
const SSH_TUNNEL_HEALTH_PROBE_TIMEOUT_MS = 1_000;
const SSH_TUNNEL_RECONNECT_BACKOFF_MS = [1_000, 4_000, 16_000, 60_000] as const;
const SSH_TUNNEL_MAX_RECONNECT_ATTEMPTS = 5;

export function sshTunnelReconnectDelayMs(attempt: number): number {
  const index = Math.max(0, Math.min(attempt - 1, SSH_TUNNEL_RECONNECT_BACKOFF_MS.length - 1));
  return SSH_TUNNEL_RECONNECT_BACKOFF_MS[index] ?? SSH_TUNNEL_RECONNECT_BACKOFF_MS[0];
}

export interface RemoteT3RunnerOptions {
  readonly packageSpec?: string;
  readonly nodeScriptPath?: string | null;
  readonly nodeEngineRange?: string | null;
}

export interface SshTunnelHealthProbeInput {
  readonly key: string;
  readonly target: DesktopSshEnvironmentTarget;
  readonly localPort: number;
  readonly remotePort: number;
  readonly httpBaseUrl: string;
}

export interface SshEnvironmentManagerOptions {
  readonly resolveCliPackageSpec?: () => string;
  readonly resolveCliRunner?: Effect.Effect<RemoteT3RunnerOptions>;
  readonly tunnelHealthIntervalMs?: number;
  readonly tunnelHealthProbe?: (
    input: SshTunnelHealthProbeInput,
  ) => Effect.Effect<void, SshReadinessError>;
  readonly tunnelReconnectBackoffMs?: ReadonlyArray<number>;
}

interface SshTunnelEntry {
  readonly key: string;
  readonly target: DesktopSshEnvironmentTarget;
  readonly remotePort: number;
  readonly remoteServerKind: "external" | "managed" | null;
  readonly localPort: number;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly process: ChildProcessSpawner.ChildProcessHandle;
  readonly scope: Scope.Scope;
  readonly state: Ref.Ref<SshTunnelState>;
  readonly manualDisconnect: Ref.Ref<boolean>;
}

export type SshTunnelState = "connecting" | "connected" | "reconnecting" | "failed";

export interface SshTunnelStateChange {
  readonly key: string;
  readonly target: DesktopSshEnvironmentTarget;
  readonly state: SshTunnelState;
  readonly localPort: number | null;
  readonly remotePort: number | null;
  readonly attempt: number | null;
  readonly message: string | null;
}

type SshEnvironmentEffectContext =
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService
  | SshPasswordPrompt;

type SshEnvironmentEffectError =
  | SshCommandError
  | SshInvalidTargetError
  | SshLaunchError
  | SshPairingError
  | SshReadinessError
  | SshPasswordPromptError
  | NetService.NetError;

function makeSshTunnelCancelledError(target: DesktopSshEnvironmentTarget): SshCommandError {
  return new SshCommandError({
    command: ["ssh"],
    exitCode: null,
    stderr: "",
    message: `SSH environment connection was cancelled for ${target.alias || target.hostname}.`,
  });
}

function sshTargetLogFields(target: DesktopSshEnvironmentTarget) {
  return {
    alias: target.alias,
    hostname: target.hostname,
    username: target.username,
    port: target.port,
  };
}

function sshRunnerLogFields(runner: RemoteT3RunnerOptions | undefined) {
  if (runner?.nodeScriptPath?.trim()) {
    return { runner: "node-script", nodeScriptPath: runner.nodeScriptPath.trim() };
  }
  if (runner?.packageSpec?.trim()) {
    return { runner: "package", packageSpec: runner.packageSpec.trim() };
  }
  return { runner: "default" };
}

interface SshAuthOperationInput<T> {
  readonly key: string;
  readonly target: DesktopSshEnvironmentTarget;
  readonly operation: (
    authOptions: SshAuthOptions,
  ) => Effect.Effect<T, SshEnvironmentEffectError, SshEnvironmentEffectContext>;
}

interface SshAuthAttemptInput<T> extends SshAuthOperationInput<T> {
  readonly promptCount: number;
  readonly authSecret: string | null;
}

export interface SshEnvironmentManagerShape {
  readonly ensureEnvironment: (
    target: DesktopSshEnvironmentTarget,
    options?: { readonly issuePairingToken?: boolean },
  ) => Effect.Effect<
    DesktopSshEnvironmentBootstrap,
    SshEnvironmentEffectError,
    SshEnvironmentEffectContext
  >;
  readonly disconnectEnvironment: (
    target: DesktopSshEnvironmentTarget,
  ) => Effect.Effect<void, SshEnvironmentEffectError, SshEnvironmentEffectContext>;
  readonly getTunnelState: (
    target: DesktopSshEnvironmentTarget,
  ) => Effect.Effect<
    SshTunnelState | "disconnected",
    SshEnvironmentEffectError,
    SshEnvironmentEffectContext
  >;
  readonly tunnelStateChanges: Stream.Stream<SshTunnelStateChange>;
}

const RemoteLaunchResult = Schema.Struct({
  remotePort: Schema.Number,
  serverKind: Schema.optional(Schema.Literals(["external", "managed"])),
});

const RemotePairingResult = Schema.Struct({
  credential: Schema.String,
});

const RemoteHttpError = Schema.Struct({
  error: Schema.optional(Schema.String),
});

const decodeRemoteLaunchResult = Schema.decodeEffect(fromLenientJson(RemoteLaunchResult));
const decodeRemotePairingResult = Schema.decodeEffect(fromLenientJson(RemotePairingResult));
const decodeRemoteHttpError = Schema.decodeEffect(Schema.fromJsonString(RemoteHttpError));

const decodeRemoteJsonOutput = <A, E>(
  stdout: string,
  decode: (input: string) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  decode(stdout).pipe(
    Effect.catch((error) =>
      Effect.gen(function* () {
        const jsonObject = extractJsonObject(stdout);
        if (jsonObject === stdout.trim()) {
          return yield* Effect.fail(error);
        }
        const exit = yield* Effect.exit(decode(jsonObject));
        if (Exit.isSuccess(exit)) {
          return exit.value;
        }
        return yield* Effect.fail(error);
      }),
    ),
  );

const decodeRemoteLaunchOutput = (stdout: string) =>
  decodeRemoteJsonOutput(stdout, decodeRemoteLaunchResult);

const decodeRemotePairingOutput = (stdout: string) =>
  decodeRemoteJsonOutput(stdout, decodeRemotePairingResult);

const remoteNodeEngineCheckMain = function remoteNodeEngineCheckMain() {
  const range = process.argv[2] || "";
  const rawVersion =
    process.versions && process.versions.node ? process.versions.node : process.version;

  if (!satisfiesSemverRange(rawVersion, range)) {
    process.stderr.write(
      "Remote node " + rawVersion + " does not satisfy required range " + range + ".\n",
    );
    process.exit(1);
  }
};

function buildRemoteNodeEngineCheckScript(): string {
  return `${satisfiesSemverRange.toString()}
(${remoteNodeEngineCheckMain.toString()})();`;
}

export function normalizeSshErrorMessage(stderr: string, fallbackMessage: string): string {
  const cleaned = stderr.trim();
  return cleaned.length > 0 ? cleaned : fallbackMessage;
}

function stripTrailingNewlines(value: string): string {
  return value.replace(/\n+$/u, "");
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function applyScriptPlaceholders(
  template: string,
  replacements: Readonly<Record<string, string>>,
): string {
  let result = template;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.replaceAll(`@@${token}@@`, value);
  }
  return result;
}

export function describeReadinessCause(cause: unknown): unknown {
  if (cause instanceof SshReadinessError) {
    return {
      _tag: cause._tag,
      message: cause.message,
      ...(cause.cause === undefined ? {} : { cause: describeReadinessCause(cause.cause) }),
    };
  }
  if (cause instanceof Error) {
    return {
      name: cause.name,
      message: cause.message,
      ...(cause.cause === undefined ? {} : { cause: describeReadinessCause(cause.cause) }),
    };
  }
  if (typeof cause !== "object" || cause === null) {
    return cause;
  }

  const record = cause as Readonly<Record<string, unknown>>;
  return {
    ...(typeof record._tag === "string" ? { _tag: record._tag } : {}),
    ...(typeof record.message === "string" ? { message: record.message } : {}),
    ...(record.reason === undefined ? {} : { reason: describeReadinessCause(record.reason) }),
    ...(record.cause === undefined ? {} : { cause: describeReadinessCause(record.cause) }),
  };
}

function describeReadinessMessage(cause: unknown): string {
  const described = describeReadinessCause(cause);
  if (typeof described === "string" && described.trim().length > 0) {
    return described;
  }
  if (typeof described !== "object" || described === null) {
    return "SSH tunnel health probe failed.";
  }
  const record = described as Readonly<Record<string, unknown>>;
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }
  if (typeof record._tag === "string" && record._tag.trim().length > 0) {
    return record._tag;
  }
  return "SSH tunnel health probe failed.";
}

export const REMOTE_PICK_PORT_SCRIPT = `const fs = require("node:fs");
const net = require("node:net");
const filePath = process.argv[2] ?? "";
const defaultPort = Number.parseInt(process.argv[3] ?? "", 10);
const scanWindow = Number.parseInt(process.argv[4] ?? "", 10);
const raw = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").trim() : "";
const preferred = Number.parseInt(raw, 10);
const start = Number.isInteger(preferred) ? preferred : defaultPort;
const end = start + scanWindow;

function tryPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close((error) => resolve(error ? false : port));
    });
  });
}

(async () => {
  for (let port = start; port < end; port += 1) {
    const available = await tryPort(port);
    if (available) {
      process.stdout.write(String(port));
      return;
    }
  }
  process.exit(1);
})().catch(() => process.exit(1));
`;

export const REMOTE_WAIT_READY_SCRIPT = `const http = require("node:http");
const port = Number.parseInt(process.argv[2] ?? "", 10);
const timeoutMs = Number.parseInt(process.argv[3] ?? "", 10);
const probeTimeoutMs = Number.parseInt(process.argv[4] ?? "", 10);
if (!Number.isInteger(port) || !Number.isInteger(timeoutMs) || !Number.isInteger(probeTimeoutMs)) {
  process.exit(1);
}
const deadline = Date.now() + timeoutMs;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function probe() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/",
        timeout: probeTimeoutMs,
      },
      (response) => {
        response.resume();
        response.once("end", () => {
          resolve(response.statusCode >= 200 && response.statusCode < 300);
        });
      },
    );
    request.once("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.once("error", () => resolve(false));
  });
}

(async () => {
  while (Date.now() < deadline) {
    if (await probe()) {
      process.exit(0);
    }
    await sleep(100);
  }
  process.exit(1);
})().catch(() => process.exit(1));
`;

export const REMOTE_NODE_ENV_SCRIPT = `prepend_path_if_dir() {
  if [ -d "$1" ]; then
    case ":$PATH:" in
      *":$1:"*) ;;
      *) PATH="$1:$PATH" ;;
    esac
  fi
}

remote_node_satisfies_engine() {
  T3_NODE_ENGINE_RANGE=@@T3_NODE_ENGINE_RANGE@@
  if [ -z "$T3_NODE_ENGINE_RANGE" ]; then
    return 0
  fi
  node - "$T3_NODE_ENGINE_RANGE" <<'NODE'
@@T3_NODE_ENGINE_CHECK_SCRIPT@@
NODE
}

ensure_remote_node_path() {
  if command -v node >/dev/null 2>&1 && remote_node_satisfies_engine >/dev/null 2>&1; then
    return 0
  fi

  prepend_path_if_dir "$HOME/.local/bin"
  prepend_path_if_dir "$HOME/bin"
  prepend_path_if_dir "/opt/homebrew/bin"
  prepend_path_if_dir "/usr/local/bin"
  prepend_path_if_dir "/usr/bin"
  prepend_path_if_dir "/bin"

  if [ -z "\${VOLTA_HOME:-}" ]; then
    VOLTA_HOME="$HOME/.volta"
  fi
  export VOLTA_HOME
  prepend_path_if_dir "$VOLTA_HOME/bin"

  prepend_path_if_dir "$HOME/.asdf/shims"
  prepend_path_if_dir "$HOME/.asdf/bin"
  if [ ! -x "$HOME/.asdf/shims/node" ] && [ -s "$HOME/.asdf/asdf.sh" ]; then
    # shellcheck disable=SC1090
    . "$HOME/.asdf/asdf.sh"
  fi

  prepend_path_if_dir "$HOME/.local/share/mise/shims"
  prepend_path_if_dir "$HOME/.mise/shims"
  if ! command -v node >/dev/null 2>&1 && command -v mise >/dev/null 2>&1; then
    eval "$(mise activate sh)" >/dev/null 2>&1 || true
  fi

  if [ -z "\${FNM_DIR:-}" ]; then
    FNM_DIR="$HOME/.local/share/fnm"
  fi
  export FNM_DIR
  prepend_path_if_dir "$FNM_DIR"
  prepend_path_if_dir "$HOME/.fnm"
  if ! command -v node >/dev/null 2>&1 && command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --use-on-cd --shell sh)" >/dev/null 2>&1 || eval "$(fnm env --shell sh)" >/dev/null 2>&1 || true
  fi

  prepend_path_if_dir "$HOME/.nodenv/bin"
  prepend_path_if_dir "$HOME/.nodenv/shims"
  if ! command -v node >/dev/null 2>&1 && command -v nodenv >/dev/null 2>&1; then
    eval "$(nodenv init -)" >/dev/null 2>&1 || true
  fi

  if [ -z "\${NVM_DIR:-}" ]; then
    NVM_DIR="$HOME/.nvm"
  fi
  export NVM_DIR

  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    if ! command -v node >/dev/null 2>&1 && command -v nvm >/dev/null 2>&1; then
      nvm use --silent default >/dev/null 2>&1 || nvm use --silent node >/dev/null 2>&1 || nvm use --silent --lts >/dev/null 2>&1 || true
    fi
  fi

  if ! command -v node >/dev/null 2>&1 && [ -d "$NVM_DIR/versions/node" ]; then
    for T3_NODE_BIN in "$NVM_DIR"/versions/node/*/bin; do
      if [ -x "$T3_NODE_BIN/node" ]; then
        PATH="$T3_NODE_BIN:$PATH"
        export PATH
      fi
    done
  fi

  command -v node >/dev/null 2>&1 && remote_node_satisfies_engine
}
`;

export const REMOTE_RUNNER_SCRIPT = `#!/bin/sh
set -eu
@@T3_NODE_ENV_SCRIPT@@
ensure_remote_node_path || true
T3_NODE_SCRIPT_PATH=@@T3_NODE_SCRIPT_PATH@@
if [ -n "$T3_NODE_SCRIPT_PATH" ]; then
  if ! command -v node >/dev/null 2>&1; then
    printf 'Remote host is missing node on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
    exit 1
  fi
  exec node "$T3_NODE_SCRIPT_PATH" "$@"
fi
if command -v t3 >/dev/null 2>&1; then
  exec t3 "$@"
fi
if command -v npx >/dev/null 2>&1; then
  exec npx --yes @@T3_PACKAGE_SPEC@@ "$@"
fi
if command -v npm >/dev/null 2>&1; then
  exec npm exec --yes @@T3_PACKAGE_SPEC@@ -- "$@"
fi
printf 'Remote host is missing the t3 CLI and could not install @@T3_PACKAGE_SPEC@@ because node/npm/npx are unavailable on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
exit 1
`;

export const REMOTE_LAUNCH_SCRIPT = `set -eu
@@T3_NODE_ENV_SCRIPT@@
STATE_KEY="$1"
STATE_DIR="$HOME/.t3/ssh-launch/$STATE_KEY"
DEFAULT_SERVER_HOME="$HOME/.t3"
DEFAULT_RUNTIME_FILE="$DEFAULT_SERVER_HOME/userdata/server-runtime.json"
PORT_FILE="$STATE_DIR/port"
PID_FILE="$STATE_DIR/pid"
MANAGED_FILE="$STATE_DIR/managed"
LOG_FILE="$STATE_DIR/server.log"
RUNNER_FILE="$STATE_DIR/run-t3.sh"
RUNNER_NEXT="$STATE_DIR/run-t3.next.$$"
mkdir -p "$STATE_DIR"
cleanup_runner_next() {
  rm -f "$RUNNER_NEXT"
}
trap cleanup_runner_next EXIT
cat >"$RUNNER_NEXT" <<'SH'
@@T3_RUNNER_SCRIPT@@
SH
RUNNER_CHANGED=0
if [ ! -f "$RUNNER_FILE" ] || ! cmp -s "$RUNNER_NEXT" "$RUNNER_FILE"; then
  RUNNER_CHANGED=1
fi
mv "$RUNNER_NEXT" "$RUNNER_FILE"
chmod 700 "$RUNNER_FILE"
if ! ensure_remote_node_path; then
  printf 'Remote host is missing node on PATH. Install Node or configure a supported version manager for non-interactive shells.\\n' >&2
  exit 1
fi
pick_port() {
  node - "$PORT_FILE" "@@T3_DEFAULT_REMOTE_PORT@@" "@@T3_REMOTE_PORT_SCAN_WINDOW@@" <<'NODE'
@@T3_PICK_PORT_SCRIPT@@
NODE
}
wait_ready() {
  node - "$REMOTE_PORT" "$1" "@@T3_READY_PROBE_TIMEOUT_MS@@" <<'NODE'
@@T3_WAIT_READY_SCRIPT@@
NODE
}
wait_for_pid_exit() {
  PID_TO_WAIT="$1"
  WAIT_COUNT=0
  while kill -0 "$PID_TO_WAIT" 2>/dev/null && [ "$WAIT_COUNT" -lt 20 ]; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 0.1
  done
}
resolve_default_runtime_port() {
  node - "$DEFAULT_RUNTIME_FILE" <<'NODE'
const fs = require("node:fs");
const runtimePath = process.argv[2] ?? "";
try {
	  const runtime = JSON.parse(fs.readFileSync(runtimePath, "utf8"));
	  const pid = Number(runtime.pid);
	  const port = Number(runtime.port);
	  if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(port)) {
	    process.exit(1);
	  }
  const origin = new URL(String(runtime.origin ?? ""));
  if (origin.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(origin.hostname)) {
    process.exit(1);
  }
  process.kill(pid, 0);
  process.stdout.write(\`\${pid} \${port}\`);
} catch {
  process.exit(1);
}
NODE
}
REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
REMOTE_PORT="$(cat "$PORT_FILE" 2>/dev/null || true)"
REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
DEFAULT_RUNTIME_INFO="$(resolve_default_runtime_port 2>/dev/null || true)"
DEFAULT_RUNTIME_PID=""
DEFAULT_REMOTE_PORT=""
if [ -n "$DEFAULT_RUNTIME_INFO" ]; then
  DEFAULT_RUNTIME_PID="\${DEFAULT_RUNTIME_INFO%% *}"
  DEFAULT_REMOTE_PORT="\${DEFAULT_RUNTIME_INFO#* }"
fi
if [ -n "$DEFAULT_REMOTE_PORT" ]; then
  REMOTE_PORT="$DEFAULT_REMOTE_PORT"
  if wait_ready "@@T3_REUSE_READY_TIMEOUT_MS@@"; then
    if [ "$REMOTE_MANAGED" = "managed" ]; then
      PID_TO_STOP="\${REMOTE_PID:-$DEFAULT_RUNTIME_PID}"
      if [ -n "$PID_TO_STOP" ] && kill -0 "$PID_TO_STOP" 2>/dev/null; then
        kill "$PID_TO_STOP" 2>/dev/null || true
        wait_for_pid_exit "$PID_TO_STOP"
      fi
      REMOTE_PID=""
      REMOTE_PORT="$DEFAULT_REMOTE_PORT"
      REMOTE_MANAGED="external"
      rm -f "$PID_FILE"
      printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
      printf 'external\\n' >"$MANAGED_FILE"
    else
      printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
      printf 'external\\n' >"$MANAGED_FILE"
      REMOTE_PID=""
      REMOTE_MANAGED="external"
    fi
  else
    REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    REMOTE_PORT="$(cat "$PORT_FILE" 2>/dev/null || true)"
    REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
  fi
fi
if [ "$REMOTE_MANAGED" = "external" ]; then
  if [ -z "$REMOTE_PORT" ] || ! wait_ready "@@T3_REUSE_READY_TIMEOUT_MS@@"; then
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  fi
elif [ -n "$REMOTE_PID" ] && [ -n "$REMOTE_PORT" ] && kill -0 "$REMOTE_PID" 2>/dev/null; then
  if [ "$RUNNER_CHANGED" -eq 1 ]; then
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  elif ! wait_ready "@@T3_REUSE_READY_TIMEOUT_MS@@"; then
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    REMOTE_PID=""
    REMOTE_PORT=""
    REMOTE_MANAGED=""
  fi
else
  REMOTE_PID=""
  REMOTE_PORT=""
  REMOTE_MANAGED=""
fi
if [ -z "$REMOTE_PORT" ]; then
  REMOTE_PORT="$(pick_port)" || true
  if [ -z "$REMOTE_PORT" ]; then
    printf 'Failed to find an available port on the remote host. Ensure node is available on PATH.\\n' >&2
    exit 1
  fi
  nohup env T3CODE_NO_BROWSER=1 "$RUNNER_FILE" serve --host 127.0.0.1 --port "$REMOTE_PORT" --base-dir "$DEFAULT_SERVER_HOME" >>"$LOG_FILE" 2>&1 < /dev/null &
  REMOTE_PID="$!"
  printf '%s\\n' "$REMOTE_PID" >"$PID_FILE"
  printf '%s\\n' "$REMOTE_PORT" >"$PORT_FILE"
  printf 'managed\\n' >"$MANAGED_FILE"
  if ! wait_ready "@@T3_READY_TIMEOUT_MS@@"; then
    printf 'Remote T3 server did not become ready on 127.0.0.1:%s.\\n' "$REMOTE_PORT" >&2
    tail -n 80 "$LOG_FILE" >&2 2>/dev/null || true
    kill "$REMOTE_PID" 2>/dev/null || true
    wait_for_pid_exit "$REMOTE_PID"
    rm -f "$PID_FILE" "$PORT_FILE" "$MANAGED_FILE"
    exit 1
  fi
fi
printf '{"remotePort":%s,"serverKind":"%s"}\\n' "$REMOTE_PORT" "\${REMOTE_MANAGED:-managed}"
`;

export const REMOTE_PAIRING_SCRIPT = `set -eu
STATE_DIR="$HOME/.t3/ssh-launch/@@T3_STATE_KEY@@"
DEFAULT_SERVER_HOME="$HOME/.t3"
RUNNER_FILE="$STATE_DIR/run-t3.sh"
mkdir -p "$STATE_DIR"
cat >"$RUNNER_FILE" <<'SH'
@@T3_RUNNER_SCRIPT@@
SH
chmod 700 "$RUNNER_FILE"
PAIRING_BASE_DIR="$DEFAULT_SERVER_HOME"
"$RUNNER_FILE" auth pairing create --base-dir "$PAIRING_BASE_DIR" --json
`;

export const REMOTE_STOP_SCRIPT = `set -eu
STATE_DIR="$HOME/.t3/ssh-launch/@@T3_STATE_KEY@@"
PID_FILE="$STATE_DIR/pid"
PORT_FILE="$STATE_DIR/port"
MANAGED_FILE="$STATE_DIR/managed"
REMOTE_MANAGED="$(cat "$MANAGED_FILE" 2>/dev/null || true)"
REMOTE_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
if [ "$REMOTE_MANAGED" != "external" ] && [ -n "$REMOTE_PID" ] && kill -0 "$REMOTE_PID" 2>/dev/null; then
  kill "$REMOTE_PID" 2>/dev/null || true
  WAIT_COUNT=0
  while kill -0 "$REMOTE_PID" 2>/dev/null && [ "$WAIT_COUNT" -lt 20 ]; do
    WAIT_COUNT=$((WAIT_COUNT + 1))
    sleep 0.1
  done
fi
rm -f "$PID_FILE" "$PORT_FILE" "$MANAGED_FILE"
printf '{"stopped":true}\\n'
`;

const REMOTE_LOG_TAIL_SCRIPT = `set -eu
STATE_DIR="$HOME/.t3/ssh-launch/@@T3_STATE_KEY@@"
LOG_FILE="$STATE_DIR/server.log"
if [ -f "$LOG_FILE" ]; then
  tail -n 80 "$LOG_FILE" 2>/dev/null || true
fi
`;

export function buildRemoteT3RunnerScript(input?: RemoteT3RunnerOptions): string {
  const packageSpec = shellSingleQuote(input?.packageSpec?.trim() || "t3@latest");
  const nodeScriptPath = input?.nodeScriptPath?.trim() || "";
  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_RUNNER_SCRIPT, {
      T3_PACKAGE_SPEC: packageSpec,
      T3_NODE_SCRIPT_PATH: shellSingleQuote(nodeScriptPath),
      T3_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    }),
  );
}

function buildRemoteNodeEnvScript(input?: RemoteT3RunnerOptions): string {
  return stripTrailingNewlines(
    applyScriptPlaceholders(REMOTE_NODE_ENV_SCRIPT, {
      T3_NODE_ENGINE_RANGE: shellSingleQuote(input?.nodeEngineRange?.trim() || ""),
      T3_NODE_ENGINE_CHECK_SCRIPT: stripTrailingNewlines(buildRemoteNodeEngineCheckScript()),
    }),
  );
}

export function buildRemoteLaunchScript(input?: RemoteT3RunnerOptions): string {
  return applyScriptPlaceholders(REMOTE_LAUNCH_SCRIPT, {
    T3_NODE_ENV_SCRIPT: buildRemoteNodeEnvScript(input),
    T3_RUNNER_SCRIPT: stripTrailingNewlines(buildRemoteT3RunnerScript(input)),
    T3_PICK_PORT_SCRIPT: stripTrailingNewlines(REMOTE_PICK_PORT_SCRIPT),
    T3_WAIT_READY_SCRIPT: stripTrailingNewlines(REMOTE_WAIT_READY_SCRIPT),
    T3_DEFAULT_REMOTE_PORT: String(DEFAULT_REMOTE_PORT),
    T3_REMOTE_PORT_SCAN_WINDOW: String(REMOTE_PORT_SCAN_WINDOW),
    T3_READY_TIMEOUT_MS: String(REMOTE_READY_TIMEOUT_MS),
    T3_REUSE_READY_TIMEOUT_MS: String(REMOTE_REUSE_READY_TIMEOUT_MS),
    T3_READY_PROBE_TIMEOUT_MS: String(SSH_READY_PROBE_TIMEOUT_MS),
  });
}

export function buildRemotePairingScript(
  target: DesktopSshEnvironmentTarget,
  input?: RemoteT3RunnerOptions,
): string {
  return applyScriptPlaceholders(REMOTE_PAIRING_SCRIPT, {
    T3_STATE_KEY: remoteStateKey(target),
    T3_RUNNER_SCRIPT: stripTrailingNewlines(buildRemoteT3RunnerScript(input)),
  });
}

export function buildRemoteStopScript(target: DesktopSshEnvironmentTarget): string {
  return applyScriptPlaceholders(REMOTE_STOP_SCRIPT, {
    T3_STATE_KEY: remoteStateKey(target),
  });
}

function buildRemoteLogTailScript(target: DesktopSshEnvironmentTarget): string {
  return applyScriptPlaceholders(REMOTE_LOG_TAIL_SCRIPT, {
    T3_STATE_KEY: remoteStateKey(target),
  });
}

export const launchOrReuseRemoteServer = Effect.fn("ssh/tunnel.launchOrReuseRemoteServer")(
  function* (
    target: DesktopSshEnvironmentTarget,
    input?: SshAuthOptions,
    runner?: RemoteT3RunnerOptions,
  ): Effect.fn.Return<
    { readonly remotePort: number; readonly remoteServerKind: "external" | "managed" | null },
    SshCommandError | SshInvalidTargetError | SshLaunchError,
    ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
  > {
    yield* Effect.logInfo("ssh.remoteServer.launch.start", {
      ...sshTargetLogFields(target),
      ...sshRunnerLogFields(runner),
      stateKey: remoteStateKey(target),
    });
    const result = yield* runSshCommand(target, {
      remoteCommandArgs: ["sh", "-s", "--", remoteStateKey(target)],
      stdin: buildRemoteLaunchScript(runner),
      ...(input?.authSecret === undefined ? {} : { authSecret: input.authSecret }),
      ...(input?.batchMode === undefined ? {} : { batchMode: input.batchMode }),
      ...(input?.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
    });
    if (!getLastNonEmptyOutputLine(result.stdout)) {
      return yield* new SshLaunchError({
        message: "SSH launch did not return a remote port.",
        stdout: result.stdout,
      });
    }
    const parsed = yield* decodeRemoteLaunchOutput(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new SshLaunchError({
            message: "SSH launch returned unparseable output.",
            stdout: result.stdout,
            cause,
          }),
      ),
    );
    if (!Number.isInteger(parsed.remotePort)) {
      return yield* new SshLaunchError({
        message: `SSH launch returned an invalid remote port: ${String(parsed.remotePort)}.`,
        stdout: result.stdout,
      });
    }
    yield* Effect.logInfo("ssh.remoteServer.launch.ready", {
      ...sshTargetLogFields(target),
      remotePort: parsed.remotePort,
      remoteServerKind: parsed.serverKind ?? null,
      stateKey: remoteStateKey(target),
    });
    return {
      remotePort: parsed.remotePort,
      remoteServerKind: parsed.serverKind ?? null,
    };
  },
);

export const issueRemotePairingToken = Effect.fn("ssh/tunnel.issueRemotePairingToken")(function* (
  target: DesktopSshEnvironmentTarget,
  input?: SshAuthOptions,
  runner?: RemoteT3RunnerOptions,
): Effect.fn.Return<
  {
    readonly credential: string;
  },
  SshCommandError | SshInvalidTargetError | SshPairingError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  yield* Effect.logDebug("ssh.remoteServer.pairingToken.start", {
    ...sshTargetLogFields(target),
    stateKey: remoteStateKey(target),
  });
  const result = yield* runSshCommand(target, {
    remoteCommandArgs: ["sh", "-s"],
    stdin: buildRemotePairingScript(target, runner),
    ...(input?.authSecret === undefined ? {} : { authSecret: input.authSecret }),
    ...(input?.batchMode === undefined ? {} : { batchMode: input.batchMode }),
    ...(input?.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
  });
  if (!getLastNonEmptyOutputLine(result.stdout)) {
    return yield* new SshPairingError({
      message: "SSH pairing did not return a credential.",
      stdout: result.stdout,
    });
  }
  const parsed = yield* decodeRemotePairingOutput(result.stdout).pipe(
    Effect.mapError(
      (cause) =>
        new SshPairingError({
          message: "SSH pairing returned unparseable output.",
          stdout: result.stdout,
          cause,
        }),
    ),
  );
  if (parsed.credential.trim().length === 0) {
    return yield* new SshPairingError({
      message: "SSH pairing command returned an invalid credential.",
      stdout: result.stdout,
    });
  }
  yield* Effect.logDebug("ssh.remoteServer.pairingToken.created", {
    ...sshTargetLogFields(target),
    stateKey: remoteStateKey(target),
  });
  return {
    credential: parsed.credential,
  };
});

export const stopRemoteServer = Effect.fn("ssh/tunnel.stopRemoteServer")(function* (
  target: DesktopSshEnvironmentTarget,
  input?: SshAuthOptions,
): Effect.fn.Return<
  void,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  yield* Effect.logInfo("ssh.remoteServer.stop.start", {
    ...sshTargetLogFields(target),
    stateKey: remoteStateKey(target),
  });
  yield* runSshCommand(target, {
    remoteCommandArgs: ["sh", "-s"],
    stdin: buildRemoteStopScript(target),
    ...(input?.authSecret === undefined ? {} : { authSecret: input.authSecret }),
    ...(input?.batchMode === undefined ? {} : { batchMode: input.batchMode }),
    ...(input?.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
  });
  yield* Effect.logInfo("ssh.remoteServer.stop.succeeded", {
    ...sshTargetLogFields(target),
    stateKey: remoteStateKey(target),
  });
});

const readRemoteServerLogTail = Effect.fn("ssh/tunnel.readRemoteServerLogTail")(function* (
  target: DesktopSshEnvironmentTarget,
  input?: SshAuthOptions,
): Effect.fn.Return<
  string,
  SshCommandError | SshInvalidTargetError,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> {
  const result = yield* runSshCommand(target, {
    remoteCommandArgs: ["sh", "-s"],
    stdin: buildRemoteLogTailScript(target),
    timeoutMs: 10_000,
    ...(input?.authSecret === undefined ? {} : { authSecret: input.authSecret }),
    ...(input?.batchMode === undefined ? {} : { batchMode: input.batchMode }),
    ...(input?.interactiveAuth === undefined ? {} : { interactiveAuth: input.interactiveAuth }),
  });
  return result.stdout.trim();
});

export const waitForHttpReady = Effect.fn("ssh/tunnel.waitForHttpReady")(function* (input: {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly intervalMs?: number;
  readonly probeTimeoutMs?: number;
  readonly path?: string;
}): Effect.fn.Return<void, SshReadinessError, HttpClient.HttpClient> {
  const timeoutMs = input.timeoutMs ?? 30_000;
  const intervalMs = input.intervalMs ?? 100;
  const probeTimeoutMs = input.probeTimeoutMs ?? SSH_READY_PROBE_TIMEOUT_MS;
  const retryPolicy = Schedule.spaced(Duration.millis(intervalMs)).pipe(
    Schedule.take(Math.max(0, Math.ceil(timeoutMs / intervalMs))),
  );
  const requestUrl = new URL(input.path ?? "/", input.baseUrl).toString();
  const client = yield* HttpClient.HttpClient;
  const lastProbeFailure = yield* Ref.make<unknown>(null);
  let attempt = 0;

  yield* Effect.logDebug("ssh.tunnel.httpReady.start", {
    baseUrl: input.baseUrl,
    requestUrl,
    timeoutMs,
    intervalMs,
    probeTimeoutMs,
  });

  const readinessClient = client.pipe(
    HttpClient.filterStatusOk,
    HttpClient.transform((effect) =>
      Effect.gen(function* () {
        attempt += 1;
        const responseOption = yield* effect.pipe(
          Effect.timeoutOption(Duration.millis(probeTimeoutMs)),
          Effect.mapError(
            (cause) =>
              new SshReadinessError({
                message: `Backend readiness probe failed at ${requestUrl}.`,
                cause,
              }),
          ),
        );
        return yield* Option.match(responseOption, {
          onSome: Effect.succeed,
          onNone: () =>
            Effect.fail(
              new SshReadinessError({
                message: `Backend readiness probe exceeded ${probeTimeoutMs}ms at ${requestUrl}.`,
                cause: {
                  kind: "probe-timeout",
                  attempt,
                  probeTimeoutMs,
                },
              }),
            ),
        });
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof SshReadinessError
            ? cause
            : new SshReadinessError({
                message: `Backend readiness probe failed at ${requestUrl}.`,
                cause,
              }),
        ),
        Effect.tapError((cause) =>
          Ref.set(lastProbeFailure, {
            attempt,
            cause: describeReadinessCause(cause),
          }),
        ),
      ),
    ),
    HttpClient.tap((response) => response.text.pipe(Effect.ignore)),
    HttpClient.retry(retryPolicy),
  );

  const result = yield* readinessClient.execute(HttpClientRequest.get(requestUrl)).pipe(
    Effect.mapError((cause) =>
      cause instanceof SshReadinessError
        ? cause
        : new SshReadinessError({
            message: `Backend readiness probe failed at ${requestUrl}.`,
            cause,
          }),
    ),
    Effect.timeoutOption(Duration.millis(timeoutMs)),
  );

  return yield* Option.match(result, {
    onSome: () =>
      Effect.logDebug("ssh.tunnel.httpReady.succeeded", {
        baseUrl: input.baseUrl,
        requestUrl,
        attempts: attempt,
      }),
    onNone: () =>
      Effect.gen(function* () {
        const lastFailure = yield* Ref.get(lastProbeFailure);
        yield* Effect.logWarning("ssh.tunnel.httpReady.timedOut", {
          baseUrl: input.baseUrl,
          requestUrl,
          timeoutMs,
          intervalMs,
          probeTimeoutMs,
          attempts: attempt,
          lastFailure,
        });
        return yield* new SshReadinessError({
          message: `Timed out waiting ${timeoutMs}ms for backend readiness at ${input.baseUrl}.`,
          cause: lastFailure,
        });
      }),
  });
});

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

function resolveLoopbackSshHttpUrl(
  rawHttpBaseUrl: unknown,
  pathname: string,
): Effect.Effect<URL, SshHttpBridgeError> {
  return Effect.try({
    try: () => {
      if (typeof rawHttpBaseUrl !== "string" || rawHttpBaseUrl.trim().length === 0) {
        throw new Error("Invalid SSH forwarded http base URL.");
      }
      const baseUrl = new URL(rawHttpBaseUrl);
      if (!isLoopbackHostname(baseUrl.hostname)) {
        throw new Error("SSH desktop bridge only supports loopback forwarded URLs.");
      }
      const url = new URL(baseUrl.toString());
      url.pathname = pathname;
      url.search = "";
      url.hash = "";
      return url;
    },
    catch: (cause) =>
      new SshHttpBridgeError({
        message: cause instanceof Error ? cause.message : "Invalid SSH forwarded http base URL.",
        cause,
      }),
  });
}

export const fetchLoopbackSshJson = Effect.fn("ssh/tunnel.fetchLoopbackSshJson")(function* <
  T,
>(input: {
  readonly httpBaseUrl: unknown;
  readonly pathname: string;
  readonly method?: "GET" | "POST";
  readonly bearerToken?: unknown;
  readonly body?: unknown;
}): Effect.fn.Return<T, SshHttpBridgeError, HttpClient.HttpClient> {
  const requestUrl = yield* resolveLoopbackSshHttpUrl(input.httpBaseUrl, input.pathname);
  const bearerToken =
    typeof input.bearerToken === "string" && input.bearerToken.trim().length > 0
      ? input.bearerToken
      : null;

  const request = (
    input.method === "POST"
      ? HttpClientRequest.post(requestUrl.toString())
      : HttpClientRequest.get(requestUrl.toString())
  ).pipe(
    input.body === undefined ? (req) => req : HttpClientRequest.bodyJsonUnsafe(input.body),
    bearerToken
      ? HttpClientRequest.setHeader("authorization", `Bearer ${bearerToken}`)
      : (req) => req,
  );
  const client = yield* HttpClient.HttpClient;
  const response = yield* client.execute(request).pipe(
    Effect.mapError(
      (cause) =>
        new SshHttpBridgeError({
          message: `Failed to reach SSH forwarded endpoint ${requestUrl.toString()}.`,
          cause,
        }),
    ),
  );
  if (response.status < 200 || response.status >= 300) {
    const text = yield* response.text.pipe(Effect.catch(() => Effect.succeed("")));
    const parsedError = yield* decodeRemoteHttpError(text).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );
    const message =
      parsedError?.error && parsedError.error.trim().length > 0
        ? parsedError.error
        : text || `SSH forwarded request failed (${response.status}).`;
    return yield* new SshHttpBridgeError({
      status: response.status,
      message: `[ssh_http:${response.status}] ${message} (${input.method ?? "GET"} ${requestUrl.toString()})`,
    });
  }
  return (yield* response.json.pipe(
    Effect.mapError(
      (cause) =>
        new SshHttpBridgeError({
          message: `SSH forwarded endpoint ${requestUrl.toString()} returned invalid JSON.`,
          cause,
        }),
    ),
  )) as T;
});

const reserveLocalTunnelPort = Effect.fn("ssh/tunnel.reserveLocalTunnelPort")(function* () {
  const net = yield* NetService.NetService;
  return yield* net.reserveLoopbackPort();
});

export const probeLocalTunnelTcp = Effect.fn("ssh/tunnel.probeLocalTunnelTcp")(function* (input: {
  readonly port: number;
  readonly timeoutMs?: number;
}): Effect.fn.Return<void, SshReadinessError> {
  const timeoutMs = input.timeoutMs ?? SSH_TUNNEL_HEALTH_PROBE_TIMEOUT_MS;
  return yield* Effect.callback<void, SshReadinessError>((resume) => {
    const socket = NodeNet.createConnection({
      host: "127.0.0.1",
      port: input.port,
    });
    let settled = false;

    const settle = (effect: Effect.Effect<void, SshReadinessError>) => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resume(effect);
    };

    socket.once("connect", () => {
      settle(Effect.void);
    });
    socket.once("error", (cause) => {
      settle(
        Effect.fail(
          new SshReadinessError({
            message: `SSH tunnel TCP probe failed on 127.0.0.1:${input.port}.`,
            cause,
          }),
        ),
      );
    });
    socket.setTimeout(timeoutMs, () => {
      settle(
        Effect.fail(
          new SshReadinessError({
            message: `SSH tunnel TCP probe exceeded ${timeoutMs}ms on 127.0.0.1:${input.port}.`,
            cause: { kind: "tcp-probe-timeout", timeoutMs },
          }),
        ),
      );
    });

    return Effect.sync(() => {
      settle(
        Effect.fail(
          new SshReadinessError({
            message: `SSH tunnel TCP probe was cancelled on 127.0.0.1:${input.port}.`,
          }),
        ),
      );
    });
  });
});

const startSshTunnel = Effect.fn("ssh/tunnel.startSshTunnel")(function* (input: {
  readonly key: string;
  readonly resolvedTarget: DesktopSshEnvironmentTarget;
  readonly remotePort: number;
  readonly localPort: number;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
  readonly authOptions: SshAuthOptions;
  readonly remoteServerKind: "external" | "managed" | null;
  readonly state: Ref.Ref<SshTunnelState>;
  readonly manualDisconnect: Ref.Ref<boolean>;
}): Effect.fn.Return<
  SshTunnelEntry,
  SshCommandError | SshInvalidTargetError | SshReadinessError,
  | ChildProcessSpawner.ChildProcessSpawner
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService
  | Scope.Scope
> {
  const hostSpec = yield* buildSshHostSpecEffect(input.resolvedTarget);
  const childEnvironment = yield* buildSshChildEnvironment({
    ...(input.authOptions.authSecret === undefined
      ? {}
      : { authSecret: input.authOptions.authSecret }),
    ...(input.authOptions.interactiveAuth === undefined
      ? {}
      : { interactiveAuth: input.authOptions.interactiveAuth }),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SshCommandError({
          command: ["ssh"],
          exitCode: null,
          stderr: "",
          message: "Failed to prepare SSH authentication helpers.",
          cause,
        }),
    ),
  );
  const args = [
    ...baseSshArgs(input.resolvedTarget, {
      batchMode: input.authOptions.batchMode ?? "no",
    }),
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-n",
    "-N",
    "-L",
    `${input.localPort}:127.0.0.1:${input.remotePort}`,
    hostSpec,
  ];
  const tunnelCommand = ["ssh", ...args];
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Scope.Scope;
  yield* Effect.logDebug("ssh.tunnel.spawn.start", {
    ...sshTargetLogFields(input.resolvedTarget),
    command: tunnelCommand,
    localPort: input.localPort,
    remotePort: input.remotePort,
    remoteServerKind: input.remoteServerKind,
    httpBaseUrl: input.httpBaseUrl,
  });
  const child = yield* spawner
    .spawn(
      ChildProcess.make("ssh", args, {
        env: childEnvironment,
        shell: process.platform === "win32",
        stdin: {
          stream: Stream.empty,
          endOnDone: true,
        },
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new SshCommandError({
            command: tunnelCommand,
            exitCode: null,
            stderr: "",
            message:
              cause instanceof Error
                ? cause.message
                : `Failed to spawn SSH tunnel for ${input.resolvedTarget.alias}.`,
            cause,
          }),
      ),
    );
  yield* Effect.logDebug("ssh.tunnel.spawn.succeeded", {
    ...sshTargetLogFields(input.resolvedTarget),
    command: tunnelCommand,
    pid: child.pid,
    localPort: input.localPort,
    remotePort: input.remotePort,
    httpBaseUrl: input.httpBaseUrl,
  });
  const tunnelEntry: SshTunnelEntry = {
    key: input.key,
    target: input.resolvedTarget,
    remotePort: input.remotePort,
    remoteServerKind: input.remoteServerKind,
    localPort: input.localPort,
    httpBaseUrl: input.httpBaseUrl,
    wsBaseUrl: input.wsBaseUrl,
    process: child,
    scope,
    state: input.state,
    manualDisconnect: input.manualDisconnect,
  };
  const exitFailure = Effect.all(
    [collectProcessOutput(child.stderr), child.exitCode.pipe(Effect.map(Number))],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (cause) =>
        new SshCommandError({
          command: tunnelCommand,
          exitCode: null,
          stderr: "",
          message:
            cause instanceof Error
              ? cause.message
              : `Failed to monitor SSH tunnel for ${input.resolvedTarget.alias}.`,
          cause,
        }),
    ),
    Effect.flatMap(([stderr, exitCode]) => {
      const error = new SshCommandError({
        command: tunnelCommand,
        exitCode,
        stderr,
        message: normalizeSshErrorMessage(
          stderr,
          `SSH tunnel exited unexpectedly for ${input.resolvedTarget.alias} (exit ${exitCode}).`,
        ),
      });
      return Effect.logWarning("ssh.tunnel.process.exited", {
        ...sshTargetLogFields(input.resolvedTarget),
        command: tunnelCommand,
        pid: child.pid,
        localPort: input.localPort,
        remotePort: input.remotePort,
        httpBaseUrl: input.httpBaseUrl,
        exitCode,
        stderr,
      }).pipe(Effect.andThen(Effect.fail(error)));
    }),
  );
  yield* Effect.raceFirst(
    waitForHttpReady({
      baseUrl: input.httpBaseUrl,
      timeoutMs: SSH_READY_TIMEOUT_MS,
    }),
    exitFailure,
  ).pipe(
    Effect.tap(() =>
      Effect.logInfo("ssh.tunnel.ready", {
        ...sshTargetLogFields(input.resolvedTarget),
        command: tunnelCommand,
        pid: child.pid,
        localPort: input.localPort,
        remotePort: input.remotePort,
        httpBaseUrl: input.httpBaseUrl,
      }),
    ),
    Effect.tapError((cause) =>
      Effect.gen(function* () {
        const net = yield* NetService.NetService;
        const processRunningExit = yield* Effect.exit(child.isRunning);
        const localPortAvailableExit = yield* Effect.exit(
          net.canListenOnHost(input.localPort, "127.0.0.1"),
        );
        const remoteLogTailExit = yield* Effect.exit(
          readRemoteServerLogTail(input.resolvedTarget, input.authOptions),
        );
        const processRunning = Exit.isSuccess(processRunningExit) ? processRunningExit.value : null;
        const localPortAvailable = Exit.isSuccess(localPortAvailableExit)
          ? localPortAvailableExit.value
          : null;
        const remoteLogTail = Exit.isSuccess(remoteLogTailExit)
          ? remoteLogTailExit.value || null
          : null;
        yield* Effect.logWarning("ssh.tunnel.ready.failed", {
          ...sshTargetLogFields(input.resolvedTarget),
          command: tunnelCommand,
          pid: child.pid,
          processRunning,
          ...(Exit.isSuccess(processRunningExit)
            ? {}
            : { processRunningError: processRunningExit.cause }),
          localPort: input.localPort,
          localPortListening: localPortAvailable === null ? null : !localPortAvailable,
          remotePort: input.remotePort,
          httpBaseUrl: input.httpBaseUrl,
          ...(Exit.isSuccess(localPortAvailableExit)
            ? {}
            : { localPortProbeError: localPortAvailableExit.cause }),
          ...(remoteLogTail === null ? {} : { remoteLogTail }),
          ...(Exit.isSuccess(remoteLogTailExit)
            ? {}
            : { remoteLogTailError: remoteLogTailExit.cause }),
          cause,
        });
      }),
    ),
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Effect.void
        : child
            .kill({
              killSignal: "SIGTERM",
              forceKillAfter: TUNNEL_SHUTDOWN_TIMEOUT_MS,
            })
            .pipe(Effect.ignore),
    ),
  );
  return tunnelEntry;
});

const makeSshEnvironmentManager = Effect.fn("ssh/tunnel.SshEnvironmentManager.make")(function* (
  options: SshEnvironmentManagerOptions = {},
): Effect.fn.Return<SshEnvironmentManagerShape, never, Scope.Scope> {
  const managerScope = yield* Scope.Scope;
  const tunnels = new Map<string, SshTunnelEntry>();
  const pendingTunnelEntries = new Map<
    string,
    Deferred.Deferred<SshTunnelEntry, SshEnvironmentEffectError>
  >();
  const authSecrets = new Map<string, string>();
  const tunnelStateChanges = yield* Effect.acquireRelease(
    PubSub.unbounded<SshTunnelStateChange>(),
    (pubsub) => PubSub.shutdown(pubsub),
  );

  const setTunnelState = (
    entry: SshTunnelEntry,
    state: SshTunnelState,
    options: {
      readonly attempt?: number;
      readonly message?: string;
    } = {},
  ): Effect.Effect<void> =>
    Effect.all(
      [
        Ref.set(entry.state, state),
        PubSub.publish(tunnelStateChanges, {
          key: entry.key,
          target: entry.target,
          state,
          localPort: entry.localPort,
          remotePort: entry.remotePort,
          attempt: options.attempt ?? null,
          message: options.message ?? null,
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.asVoid);

  const addTunnelFinalizer = Effect.fn("ssh/tunnel.addTunnelFinalizer")(function* (
    entry: SshTunnelEntry,
  ) {
    const spawnerService = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fileSystemService = yield* FileSystem.FileSystem;
    const pathService = yield* Path.Path;
    yield* Scope.addFinalizer(
      entry.scope,
      Effect.gen(function* () {
        if (tunnels.get(entry.key) !== entry) {
          return;
        }
        yield* Effect.logDebug("ssh.environment.tunnel.finalizer.start", {
          ...sshTargetLogFields(entry.target),
          key: entry.key,
          localPort: entry.localPort,
          remotePort: entry.remotePort,
        });
        tunnels.delete(entry.key);
        const authSecret = authSecrets.get(entry.key) ?? null;
        yield* Effect.all(
          [
            entry.process.kill({
              killSignal: "SIGTERM",
              forceKillAfter: TUNNEL_SHUTDOWN_TIMEOUT_MS,
            }),
            stopRemoteServer(
              entry.target,
              authSecret === null
                ? {
                    batchMode: "yes",
                    interactiveAuth: false,
                  }
                : {
                    authSecret,
                    batchMode: "no",
                    interactiveAuth: true,
                  },
            ).pipe(
              Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawnerService),
              Effect.provideService(FileSystem.FileSystem, fileSystemService),
              Effect.provideService(Path.Path, pathService),
            ),
          ],
          { concurrency: "unbounded" },
        ).pipe(Effect.ignore);
        yield* Effect.logDebug("ssh.environment.tunnel.finalizer.succeeded", {
          ...sshTargetLogFields(entry.target),
          key: entry.key,
          localPort: entry.localPort,
          remotePort: entry.remotePort,
        });
      }).pipe(Effect.ignore),
    );
  });

  const closeTunnelEntry = Effect.fn("ssh/tunnel.closeTunnelEntry")(function* (
    entry: SshTunnelEntry,
  ) {
    yield* Ref.set(entry.manualDisconnect, true);
    yield* Effect.logDebug("ssh.tunnel.close.start", {
      ...sshTargetLogFields(entry.target),
      key: entry.key,
      localPort: entry.localPort,
      remotePort: entry.remotePort,
    });
    yield* Scope.close(entry.scope, Exit.void).pipe(Effect.ignore);
    yield* Effect.logInfo("ssh.tunnel.close.succeeded", {
      ...sshTargetLogFields(entry.target),
      key: entry.key,
      localPort: entry.localPort,
      remotePort: entry.remotePort,
    });
  });

  const cancelPendingTunnelEntry = Effect.fn("ssh/tunnel.cancelPendingTunnelEntry")(function* (
    key: string,
    target: DesktopSshEnvironmentTarget,
  ) {
    const pending = pendingTunnelEntries.get(key);
    if (!pending) {
      return;
    }
    pendingTunnelEntries.delete(key);
    yield* Deferred.fail(pending, makeSshTunnelCancelledError(target)).pipe(Effect.ignore);
  });

  yield* Scope.addFinalizer(
    managerScope,
    Effect.sync(() => [...tunnels.values()]).pipe(
      Effect.flatMap((entries) =>
        Effect.forEach(entries, closeTunnelEntry, { concurrency: "unbounded" }),
      ),
      Effect.ignore,
    ),
  );

  const promptForPassword = Effect.fn("ssh/tunnel.promptForPassword")(function* (
    target: DesktopSshEnvironmentTarget,
    attempt: number,
  ): Effect.fn.Return<string, SshInvalidTargetError | SshPasswordPromptError, SshPasswordPrompt> {
    const promptService = yield* SshPasswordPrompt;
    const hostSpec = yield* buildSshHostSpecEffect(target);
    if (!promptService.isAvailable) {
      yield* Effect.logWarning("ssh.auth.passwordPrompt.unavailable", {
        ...sshTargetLogFields(target),
        attempt,
      });
      return yield* new SshPasswordPromptError({
        message: `SSH authentication failed for ${hostSpec}.`,
      });
    }

    yield* Effect.logInfo("ssh.auth.passwordPrompt.request", {
      ...sshTargetLogFields(target),
      attempt,
    });
    const password = yield* promptService.request({
      attempt,
      destination: target.alias.trim() || target.hostname.trim(),
      username: target.username,
      prompt: `Enter the SSH password for ${hostSpec}.`,
    });
    if (password === null) {
      yield* Effect.logWarning("ssh.auth.passwordPrompt.cancelled", {
        ...sshTargetLogFields(target),
        attempt,
      });
      return yield* new SshPasswordPromptError({
        message: `SSH authentication cancelled for ${hostSpec}.`,
      });
    }
    yield* Effect.logInfo("ssh.auth.passwordPrompt.received", {
      ...sshTargetLogFields(target),
      attempt,
    });
    return password;
  });

  const handleSshAuthFailure = Effect.fn("ssh/tunnel.runWithSshAuthAttempt.handleFailure")(
    function* <T>(
      input: SshAuthAttemptInput<T> & {
        readonly error: SshEnvironmentEffectError;
      },
    ): Effect.fn.Return<T, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
      if (!isSshAuthFailure(input.error)) {
        return yield* input.error;
      }

      yield* Effect.logWarning("ssh.auth.failed", {
        ...sshTargetLogFields(input.target),
        key: input.key,
        promptCount: input.promptCount,
        cause: input.error,
      });
      const promptService = yield* SshPasswordPrompt;
      if (!promptService.isAvailable) {
        return yield* input.error;
      }
      if (input.authSecret !== null) {
        authSecrets.delete(input.key);
      }
      if (input.promptCount >= 2) {
        return yield* input.error;
      }

      const nextPromptCount = input.promptCount + 1;
      const nextAuthSecret = yield* promptForPassword(input.target, nextPromptCount);
      authSecrets.set(input.key, nextAuthSecret);
      return yield* runWithSshAuthAttempt({
        ...input,
        promptCount: nextPromptCount,
        authSecret: nextAuthSecret,
      });
    },
  );

  const runWithSshAuthAttempt = Effect.fn("ssh/tunnel.runWithSshAuthAttempt")(function* <T>(
    input: SshAuthAttemptInput<T>,
  ): Effect.fn.Return<T, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
    const promptService = yield* SshPasswordPrompt;
    const authOptions =
      input.authSecret === null
        ? {
            batchMode: promptService.isAvailable ? ("yes" as const) : ("no" as const),
            interactiveAuth: !promptService.isAvailable,
          }
        : {
            authSecret: input.authSecret,
            batchMode: "no" as const,
            interactiveAuth: true,
          };

    return yield* input
      .operation(authOptions)
      .pipe(Effect.catch((error) => handleSshAuthFailure({ ...input, error })));
  });

  const runWithSshAuth = Effect.fn("ssh/tunnel.runWithSshAuth")(function* <T>(
    input: SshAuthOperationInput<T>,
  ): Effect.fn.Return<T, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
    return yield* runWithSshAuthAttempt({
      ...input,
      promptCount: 0,
      authSecret: authSecrets.get(input.key) ?? null,
    });
  });

  const reconnectDelayMs = (attempt: number) => {
    const configured = options.tunnelReconnectBackoffMs;
    if (configured === undefined || configured.length === 0) {
      return sshTunnelReconnectDelayMs(attempt);
    }
    const index = Math.max(0, Math.min(attempt - 1, configured.length - 1));
    return configured[index] ?? configured[0] ?? sshTunnelReconnectDelayMs(attempt);
  };

  const startTunnelHealthMonitor = Effect.fn("ssh/tunnel.startTunnelHealthMonitor")(function* (
    entry: SshTunnelEntry,
  ): Effect.fn.Return<void, never, SshEnvironmentEffectContext> {
    const monitor = Effect.gen(function* () {
      let currentEntry = entry;
      let reconnectAttempt = 0;

      while (true) {
        yield* Effect.sleep(
          Duration.millis(options.tunnelHealthIntervalMs ?? SSH_TUNNEL_HEALTH_INTERVAL_MS),
        );

        if (tunnels.get(currentEntry.key) !== currentEntry) {
          return;
        }
        if (yield* Ref.get(currentEntry.manualDisconnect)) {
          return;
        }

        const probe =
          options.tunnelHealthProbe ??
          ((probeInput: SshTunnelHealthProbeInput) =>
            probeLocalTunnelTcp({
              port: probeInput.localPort,
              timeoutMs: SSH_TUNNEL_HEALTH_PROBE_TIMEOUT_MS,
            }));
        const probeExit = yield* Effect.exit(
          probe({
            key: currentEntry.key,
            target: currentEntry.target,
            localPort: currentEntry.localPort,
            remotePort: currentEntry.remotePort,
            httpBaseUrl: currentEntry.httpBaseUrl,
          }),
        );
        if (Exit.isSuccess(probeExit)) {
          reconnectAttempt = 0;
          const state = yield* Ref.get(currentEntry.state);
          if (state !== "connected") {
            yield* setTunnelState(currentEntry, "connected");
          }
          continue;
        }

        reconnectAttempt += 1;
        const message = describeReadinessMessage(probeExit.cause);
        if (reconnectAttempt > SSH_TUNNEL_MAX_RECONNECT_ATTEMPTS) {
          yield* Effect.logWarning("ssh.tunnel.health.failed", {
            ...sshTargetLogFields(currentEntry.target),
            key: currentEntry.key,
            localPort: currentEntry.localPort,
            remotePort: currentEntry.remotePort,
            reconnectAttempt,
            cause: probeExit.cause,
          });
          yield* setTunnelState(currentEntry, "failed", {
            attempt: reconnectAttempt,
            message,
          });
          tunnels.delete(currentEntry.key);
          return;
        }

        yield* setTunnelState(currentEntry, "reconnecting", {
          attempt: reconnectAttempt,
          message,
        });
        yield* Effect.logWarning("ssh.tunnel.health.reconnecting", {
          ...sshTargetLogFields(currentEntry.target),
          key: currentEntry.key,
          localPort: currentEntry.localPort,
          remotePort: currentEntry.remotePort,
          reconnectAttempt,
          backoffMs: reconnectDelayMs(reconnectAttempt),
          cause: probeExit.cause,
        });
        yield* currentEntry.process
          .kill({
            killSignal: "SIGTERM",
            forceKillAfter: TUNNEL_SHUTDOWN_TIMEOUT_MS,
          })
          .pipe(
            Effect.timeoutOption(Duration.millis(TUNNEL_SHUTDOWN_TIMEOUT_MS + 500)),
            Effect.ignore,
          );
        yield* Effect.sleep(Duration.millis(reconnectDelayMs(reconnectAttempt)));

        if (yield* Ref.get(currentEntry.manualDisconnect)) {
          return;
        }

        const reconnectScope = yield* Scope.make("sequential");
        const reconnectExit = yield* Effect.exit(
          runWithSshAuth({
            key: currentEntry.key,
            target: currentEntry.target,
            operation: (authOptions) =>
              startSshTunnel({
                key: currentEntry.key,
                resolvedTarget: currentEntry.target,
                remotePort: currentEntry.remotePort,
                localPort: currentEntry.localPort,
                httpBaseUrl: currentEntry.httpBaseUrl,
                wsBaseUrl: currentEntry.wsBaseUrl,
                authOptions,
                remoteServerKind: currentEntry.remoteServerKind,
                state: currentEntry.state,
                manualDisconnect: currentEntry.manualDisconnect,
              }).pipe(Effect.provideService(Scope.Scope, reconnectScope)),
          }),
        );

        if (Exit.isSuccess(reconnectExit)) {
          const nextEntry = reconnectExit.value;
          tunnels.set(nextEntry.key, nextEntry);
          yield* addTunnelFinalizer(nextEntry);
          yield* Scope.close(currentEntry.scope, Exit.void).pipe(Effect.ignore);
          currentEntry = nextEntry;
          reconnectAttempt = 0;
          yield* setTunnelState(currentEntry, "connected");
          yield* Effect.logInfo("ssh.tunnel.health.reconnected", {
            ...sshTargetLogFields(currentEntry.target),
            key: currentEntry.key,
            localPort: currentEntry.localPort,
            remotePort: currentEntry.remotePort,
          });
          continue;
        }

        yield* Scope.close(reconnectScope, Exit.void).pipe(Effect.ignore);
        yield* Effect.logWarning("ssh.tunnel.health.reconnect.failed", {
          ...sshTargetLogFields(currentEntry.target),
          key: currentEntry.key,
          localPort: currentEntry.localPort,
          remotePort: currentEntry.remotePort,
          reconnectAttempt,
          cause: reconnectExit.cause,
        });
      }
    }).pipe(Effect.ignoreCause({ log: true }));
    yield* Effect.forkIn(monitor, managerScope).pipe(Effect.asVoid);
  });

  const createTunnelEntry = Effect.fn("ssh/tunnel.ensureTunnelEntry.create")(function* (input: {
    readonly key: string;
    readonly resolvedTarget: DesktopSshEnvironmentTarget;
    readonly runner?: RemoteT3RunnerOptions;
  }): Effect.fn.Return<SshTunnelEntry, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
    yield* Effect.logDebug("ssh.environment.tunnel.create.start", {
      ...sshTargetLogFields(input.resolvedTarget),
      ...sshRunnerLogFields(input.runner),
      key: input.key,
    });
    const remoteLaunch = yield* runWithSshAuth({
      key: input.key,
      target: input.resolvedTarget,
      operation: (authOptions) =>
        launchOrReuseRemoteServer(input.resolvedTarget, authOptions, input.runner),
    });
    const remotePort = remoteLaunch.remotePort;
    yield* Effect.logDebug("ssh.environment.remotePort.ready", {
      ...sshTargetLogFields(input.resolvedTarget),
      key: input.key,
      remotePort,
      remoteServerKind: remoteLaunch.remoteServerKind,
    });
    const localPort = yield* reserveLocalTunnelPort();
    const httpBaseUrl = `http://127.0.0.1:${localPort}/`;
    const wsBaseUrl = `ws://127.0.0.1:${localPort}/`;
    yield* Effect.logDebug("ssh.environment.localPort.reserved", {
      ...sshTargetLogFields(input.resolvedTarget),
      key: input.key,
      localPort,
      remotePort,
    });
    const tunnelState = yield* Ref.make<SshTunnelState>("connecting");
    const manualDisconnect = yield* Ref.make(false);
    const entryScope = yield* Scope.make("sequential");
    yield* PubSub.publish(tunnelStateChanges, {
      key: input.key,
      target: input.resolvedTarget,
      state: "connecting",
      localPort,
      remotePort,
      attempt: null,
      message: null,
    });
    const tunnelEntry = yield* runWithSshAuth({
      key: input.key,
      target: input.resolvedTarget,
      operation: (authOptions) =>
        startSshTunnel({
          key: input.key,
          resolvedTarget: input.resolvedTarget,
          remotePort,
          localPort,
          httpBaseUrl,
          wsBaseUrl,
          authOptions,
          remoteServerKind: remoteLaunch.remoteServerKind,
          state: tunnelState,
          manualDisconnect,
        }).pipe(Effect.provideService(Scope.Scope, entryScope)),
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isSuccess(exit) ? Effect.void : Scope.close(entryScope, Exit.void).pipe(Effect.ignore),
      ),
    );
    tunnels.set(input.key, tunnelEntry);
    yield* addTunnelFinalizer(tunnelEntry);
    yield* setTunnelState(tunnelEntry, "connected");
    yield* startTunnelHealthMonitor(tunnelEntry);
    yield* Effect.logDebug("ssh.environment.tunnel.create.succeeded", {
      ...sshTargetLogFields(input.resolvedTarget),
      key: input.key,
      localPort,
      remotePort,
    });
    return tunnelEntry;
  });

  const ensureTunnelEntry = Effect.fn("ssh/tunnel.ensureTunnelEntry")(function* (
    key: string,
    resolvedTarget: DesktopSshEnvironmentTarget,
    runner?: RemoteT3RunnerOptions,
  ): Effect.fn.Return<SshTunnelEntry, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
    let entry = tunnels.get(key) ?? null;

    if (entry !== null) {
      yield* Effect.logDebug("ssh.environment.tunnel.existing.check", {
        ...sshTargetLogFields(resolvedTarget),
        key,
        localPort: entry.localPort,
        remotePort: entry.remotePort,
      });
      const readinessExit = yield* Effect.exit(
        waitForHttpReady({ baseUrl: entry.httpBaseUrl, timeoutMs: 2_000 }),
      );
      if (Exit.isSuccess(readinessExit)) {
        yield* Effect.logDebug("ssh.environment.tunnel.reused", {
          ...sshTargetLogFields(resolvedTarget),
          key,
          localPort: entry.localPort,
          remotePort: entry.remotePort,
        });
        return entry;
      }
      yield* Effect.logWarning("ssh.environment.tunnel.existing.stale", {
        ...sshTargetLogFields(resolvedTarget),
        key,
        localPort: entry.localPort,
        remotePort: entry.remotePort,
        cause: readinessExit.cause,
      });
      yield* closeTunnelEntry(entry);
      yield* cancelPendingTunnelEntry(key, resolvedTarget);
      entry = null;
    }

    const pending = pendingTunnelEntries.get(key);
    if (pending) {
      yield* Effect.logDebug("ssh.environment.tunnel.pending.await", {
        ...sshTargetLogFields(resolvedTarget),
        key,
      });
      return yield* Deferred.await(pending);
    }

    const deferred = yield* Deferred.make<SshTunnelEntry, SshEnvironmentEffectError>();
    pendingTunnelEntries.set(key, deferred);

    return yield* createTunnelEntry({
      key,
      resolvedTarget,
      ...(runner === undefined ? {} : { runner }),
    }).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("ssh.environment.tunnel.create.failed", {
          ...sshTargetLogFields(resolvedTarget),
          key,
          cause,
        }),
      ),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (pendingTunnelEntries.get(key) === deferred) {
            pendingTunnelEntries.delete(key);
          }
        }).pipe(Effect.andThen(Deferred.done(deferred, exit))),
      ),
    );
  });

  const ensureEnvironment = Effect.fn("ssh/tunnel.ensureEnvironment")(function* (
    target: DesktopSshEnvironmentTarget,
    requestOptions?: { readonly issuePairingToken?: boolean },
  ): Effect.fn.Return<
    DesktopSshEnvironmentBootstrap,
    SshEnvironmentEffectError,
    SshEnvironmentEffectContext
  > {
    yield* Effect.logInfo("ssh.environment.ensure.start", {
      ...sshTargetLogFields(target),
      issuePairingToken: requestOptions?.issuePairingToken === true,
    });
    const baseResolved = yield* resolveSshTarget(target.alias || target.hostname);
    const resolvedTarget: DesktopSshEnvironmentTarget = {
      ...baseResolved,
      ...(target.username !== null ? { username: target.username } : {}),
      ...(target.port !== null ? { port: target.port } : {}),
    };
    const key = targetConnectionKey(resolvedTarget);
    yield* Effect.logDebug("ssh.environment.target.resolved", {
      ...sshTargetLogFields(resolvedTarget),
      key,
    });
    const packageSpec = options.resolveCliPackageSpec?.();
    const runner =
      options.resolveCliRunner === undefined
        ? packageSpec === undefined
          ? undefined
          : { packageSpec }
        : yield* options.resolveCliRunner;
    yield* Effect.logDebug("ssh.environment.runner.resolved", {
      ...sshTargetLogFields(resolvedTarget),
      ...sshRunnerLogFields(runner),
      key,
    });
    const entry = yield* ensureTunnelEntry(key, resolvedTarget, runner);

    const pairingResult = requestOptions?.issuePairingToken
      ? yield* runWithSshAuth({
          key,
          target: entry.target,
          operation: (authOptions) => issueRemotePairingToken(entry.target, authOptions, runner),
        })
      : null;
    const pairingToken = pairingResult?.credential ?? null;

    yield* Effect.logInfo("ssh.environment.ensure.succeeded", {
      ...sshTargetLogFields(entry.target),
      key,
      localPort: entry.localPort,
      remotePort: entry.remotePort,
      remoteServerKind: entry.remoteServerKind,
      issuedPairingToken: pairingToken !== null,
    });
    return {
      target: entry.target,
      httpBaseUrl: entry.httpBaseUrl,
      wsBaseUrl: entry.wsBaseUrl,
      pairingToken,
      remotePort: entry.remotePort,
      ...(entry.remoteServerKind ? { remoteServerKind: entry.remoteServerKind } : {}),
    };
  });

  const disconnectEnvironment = Effect.fn("ssh/tunnel.disconnectEnvironment")(function* (
    target: DesktopSshEnvironmentTarget,
  ): Effect.fn.Return<void, SshEnvironmentEffectError, SshEnvironmentEffectContext> {
    yield* Effect.logInfo("ssh.environment.disconnect.start", sshTargetLogFields(target));
    const baseResolved = yield* resolveSshTarget(target.alias || target.hostname);
    const resolvedTarget: DesktopSshEnvironmentTarget = {
      ...baseResolved,
      ...(target.username !== null ? { username: target.username } : {}),
      ...(target.port !== null ? { port: target.port } : {}),
    };
    const key = targetConnectionKey(resolvedTarget);
    const entry = tunnels.get(key) ?? null;
    yield* Effect.logDebug("ssh.environment.disconnect.targetResolved", {
      ...sshTargetLogFields(resolvedTarget),
      key,
      hasTunnel: entry !== null,
      hasPendingTunnel: pendingTunnelEntries.has(key),
    });
    if (entry !== null) {
      yield* closeTunnelEntry(entry);
    }
    yield* cancelPendingTunnelEntry(key, resolvedTarget);
    if (entry === null) {
      yield* runWithSshAuth({
        key,
        target: resolvedTarget,
        operation: (authOptions) => stopRemoteServer(resolvedTarget, authOptions),
      });
    }
    yield* Effect.logInfo("ssh.environment.disconnect.succeeded", {
      ...sshTargetLogFields(resolvedTarget),
      key,
    });
  });

  const getTunnelState = Effect.fn("ssh/tunnel.getTunnelState")(function* (
    target: DesktopSshEnvironmentTarget,
  ): Effect.fn.Return<
    SshTunnelState | "disconnected",
    SshEnvironmentEffectError,
    SshEnvironmentEffectContext
  > {
    const baseResolved = yield* resolveSshTarget(target.alias || target.hostname);
    const resolvedTarget: DesktopSshEnvironmentTarget = {
      ...baseResolved,
      ...(target.username !== null ? { username: target.username } : {}),
      ...(target.port !== null ? { port: target.port } : {}),
    };
    const entry = tunnels.get(targetConnectionKey(resolvedTarget)) ?? null;
    return entry === null ? "disconnected" : yield* Ref.get(entry.state);
  });

  return SshEnvironmentManager.of({
    ensureEnvironment,
    disconnectEnvironment,
    getTunnelState,
    tunnelStateChanges: Stream.fromPubSub(tunnelStateChanges),
  });
});

export class SshEnvironmentManager extends Context.Service<
  SshEnvironmentManager,
  SshEnvironmentManagerShape
>()("@t3tools/ssh/SshEnvironmentManager") {
  static readonly layer = (options: SshEnvironmentManagerOptions = {}) =>
    Layer.effect(SshEnvironmentManager, makeSshEnvironmentManager(options));
}
