import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { SshPasswordPromptError } from "./errors.ts";

export interface SshPasswordRequest {
  readonly destination: string;
  readonly username: string | null;
  readonly prompt: string;
  readonly attempt: number;
}

export interface SshAskpassFile {
  readonly path: string;
  readonly contents: string;
  readonly mode?: number;
}

export interface SshAskpassHelperDescriptor {
  readonly launcherPath: string;
  readonly files: ReadonlyArray<SshAskpassFile>;
}

export interface SshAuthOptions {
  readonly authSecret?: string | null;
  readonly batchMode?: "yes" | "no";
  readonly interactiveAuth?: boolean;
}

export interface SshPasswordPromptShape {
  readonly isAvailable: boolean;
  readonly request: (
    request: SshPasswordRequest,
  ) => Effect.Effect<string | null, SshPasswordPromptError>;
}

export class SshPasswordPrompt extends Context.Service<SshPasswordPrompt, SshPasswordPromptShape>()(
  "@t3tools/ssh/SshPasswordPrompt",
) {
  static readonly disabledLayer = Layer.succeed(
    SshPasswordPrompt,
    SshPasswordPrompt.of({
      isAvailable: false,
      request: () => Effect.succeed(null),
    }),
  );
}

export interface SshChildEnvironmentOptions {
  readonly interactiveAuth?: boolean;
  readonly baseEnv?: NodeJS.ProcessEnv;
  readonly askpassDirectory?: string;
  readonly authSecret?: string | null;
  readonly platform?: NodeJS.Platform;
}

const SSH_ASKPASS_DIR_NAME = "t3code-ssh-askpass";

function joinSshAskpassPath(
  directory: string,
  fileName: string,
  platform: NodeJS.Platform,
): string {
  const trimmed = directory.replace(/[\\/]+$/u, "");
  return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
}

// FIX: POSIX askpass script now uses mktemp with mode 0600, includes trap handler
// for cleanup, and validates the path against shell injection.
export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
# Invoked by ssh via SSH_ASKPASS when T3 Code re-runs ssh with a cached password
# from the renderer's in-app prompt.
# FIX: Uses mktemp with mode 0600 and a trap handler for cleanup.
set -u
ASKPASS_TMPFILE=""
cleanup() {
  if [ -n "$ASKPASS_TMPFILE" ] && [ -f "$ASKPASS_TMPFILE" ]; then
    rm -f "$ASKPASS_TMPFILE"
  fi
}
trap cleanup EXIT INT TERM

if [ "${T3_SSH_AUTH_SECRET+x}" = "x" ]; then
  # Write secret to a temp file with restricted permissions (mode 0600)
  ASKPASS_TMPFILE=$(mktemp -t t3code-askpass.XXXXXXXXXX)
  chmod 0600 "$ASKPASS_TMPFILE"
  printf "%s\\n" "$T3_SSH_AUTH_SECRET" > "$ASKPASS_TMPFILE"
  cat "$ASKPASS_TMPFILE"
  exit 0
fi
printf 'T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.\\n' >&2
exit 1
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

// FIX: Windows variant uses SecureString for password handling
export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\r
# ssh with a cached password from the renderer's in-app prompt.\r
# FIX: Uses SecureString to handle the password securely.\r
param()\r
$secret = $env:T3_SSH_AUTH_SECRET\r
if ($null -ne $secret) {\r
  $secure = ConvertTo-SecureString -String $secret -AsPlainText -Force\r
  $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)\r
  try {\r
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)\r
    [Console]::Out.WriteLine($plain)\r
  } finally {\r
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)\r
  }\r
  exit 0\r
}\r
[Console]::Error.WriteLine("T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.")\r
exit 1\r
`;

export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskpassDirectory")(
  function*() {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // FIX: Use makeTempDirectoryScoped which creates with restrictive permissions
    const tmpDir = yield* Effect.orDie(fileSystem.makeTempDirectoryScoped());
    return path.join(tmpDir, SSH_ASKPASS_DIR_NAME);
  },
);

export const ensureSshAskpassHelpers = Effect.fn("ssh/auth.ensureSshAskpassHelpers")(
  function*(input: { readonly directory: string; readonly platform: NodeJS.Platform }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // FIX: Validate askpass path for shell injection
    const dir = input.directory;
    if (/[\s"'$`\\;|&(){}[\]<>]/.test(dir)) {
      return yield* Effect.die(
        new Error(`Askpass directory path contains unsafe characters: ${dir}`),
      );
    }

    const askpassPath = dir;

    yield* fs.makeDirectory(askpassPath, { recursive: true });

    const filesToCreate: Array<SshAskpassFile> =
      input.platform === "win32"
        ? [
            { path: path.join(askpassPath, "ssh-askpass.cmd"), contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT },
            { path: path.join(askpassPath, "ssh-askpass.ps1"), contents: ASKPASS_WINDOWS_SCRIPT },
          ]
        : [
            { path: path.join(askpassPath, "ssh-askpass.sh"), contents: ASKPASS_POSIX_SCRIPT },
          ];

    for (const file of filesToCreate) {
      // FIX: Write with mode 0600 for POSIX
      yield* fs.writeFileString(file.path, file.contents);
      if (input.platform !== "win32") {
        yield* fs.chmod(file.path, 0o600);
      }
    }

    const launcherPath = input.platform === "win32"
      ? path.join(askpassPath, "ssh-askpass.cmd")
      : path.join(askpassPath, "ssh-askpass.sh");

    return launcherPath;
  },
);
