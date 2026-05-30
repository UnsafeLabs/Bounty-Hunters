import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import { randomUUID } from "node:crypto";

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
const SSH_ASKPASS_SECRET_FILE_PREFIX = "ssh-auth-secret";
const SSH_ASKPASS_SECRET_FILE_MODE = 0o600;
const SSH_ASKPASS_SCRIPT_MODE = 0o700;

const POSIX_SAFE_ASKPASS_PATH = /^(?!-)[A-Za-z0-9_./-]+$/u;
const WINDOWS_UNSAFE_ASKPASS_PATH_CHARS = ["\u0000", "\r", "\n", '"', "&", "|", "<", ">"] as const;

function joinSshAskpassPath(
  directory: string,
  fileName: string,
  platform: NodeJS.Platform,
): string {
  const trimmed = directory.replace(/[\\/]+$/u, "");
  return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
}

export function isSafeSshAskpassPath(
  scriptPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (scriptPath.length === 0) {
    return false;
  }
  return platform === "win32"
    ? !WINDOWS_UNSAFE_ASKPASS_PATH_CHARS.some((char) => scriptPath.includes(char))
    : POSIX_SAFE_ASKPASS_PATH.test(scriptPath);
}

function unsafeSshAskpassPathError(scriptPath: string): PlatformError.PlatformError {
  return PlatformError.badArgument({
    module: "ssh/auth",
    method: "isSafeSshAskpassPath",
    description: `Refusing to use unsafe ssh-askpass path: ${scriptPath}`,
  });
}

export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
# Invoked by ssh via SSH_ASKPASS when T3 Code re-runs ssh with a cached password
# from the renderer's in-app prompt. We never expose a native dialog here.
secret_file=
cleanup() {
  if [ -n "\${secret_file:-}" ]; then
    rm -f -- "$secret_file"
  fi
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT TERM

if [ "\${T3_SSH_AUTH_SECRET_FILE+x}" = "x" ]; then
  secret_file=$T3_SSH_AUTH_SECRET_FILE
  case "$secret_file" in
    ""|-*|*[!A-Za-z0-9_./-]*)
      printf 'T3 Code ssh-askpass refused unsafe T3_SSH_AUTH_SECRET_FILE.\\n' >&2
      exit 1
      ;;
  esac
  if [ ! -f "$secret_file" ]; then
    printf 'T3 Code ssh-askpass secret file is missing.\\n' >&2
    exit 1
  fi
  secret=$(cat "$secret_file") || exit 1
  printf "%s\\n" "$secret"
  exit 0
fi

if [ "\${T3_SSH_AUTH_SECRET+x}" = "x" ]; then
  printf "%s\\n" "$T3_SSH_AUTH_SECRET"
  exit 0
fi
printf 'T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET_FILE.\\n' >&2
exit 1
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\r
# ssh with a cached password from the renderer's in-app prompt. We never expose\r
# a native dialog here.\r
$ErrorActionPreference = "Stop"\r
$plainSecret = $null\r
\r
if ($null -ne $env:T3_SSH_AUTH_SECRET_FILE -and $env:T3_SSH_AUTH_SECRET_FILE.Length -gt 0) {\r
  if ($env:T3_SSH_AUTH_SECRET_FILE -match '[\\x00\\r\\n"&|<>]') {\r
    [Console]::Error.WriteLine("T3 Code ssh-askpass refused unsafe T3_SSH_AUTH_SECRET_FILE.")\r
    exit 1\r
  }\r
  try {\r
    $plainSecret = Get-Content -LiteralPath $env:T3_SSH_AUTH_SECRET_FILE -Raw\r
    $plainSecret = $plainSecret -replace '\\r?\\n$',''\r
  } finally {\r
    Remove-Item -LiteralPath $env:T3_SSH_AUTH_SECRET_FILE -Force -ErrorAction SilentlyContinue\r
  }\r
} elseif ($null -ne $env:T3_SSH_AUTH_SECRET) {\r
  $plainSecret = $env:T3_SSH_AUTH_SECRET\r
} else {\r
  [Console]::Error.WriteLine("T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET_FILE.")\r
  exit 1\r
}\r
\r
$secureSecret = ConvertTo-SecureString -String $plainSecret -AsPlainText -Force\r
$secretBstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)\r
try {\r
  [Console]::Out.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretBstr))\r
  exit 0\r
} finally {\r
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretBstr)\r
  $secureSecret.Dispose()\r
  $plainSecret = $null\r
}\r
`;

export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskpassDirectory")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const parentDirectory = yield* fs.makeTempDirectory({ prefix: "t3code-ssh-runtime-" });
    return path.join(parentDirectory, SSH_ASKPASS_DIR_NAME);
  },
);

export const buildSshAskpassHelperDescriptor = Effect.fn(
  "ssh/auth.buildSshAskpassHelperDescriptor",
)(function* (input: {
  readonly directory: string;
  readonly platform?: NodeJS.Platform;
}): Effect.fn.Return<SshAskpassHelperDescriptor, never, Path.Path> {
  const platform = input.platform ?? process.platform;
  const path = yield* Path.Path;
  const directory = input.directory;

  if (platform === "win32") {
    const powershellPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
    return {
      launcherPath: joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
      files: [
        {
          path: joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
          contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT,
        },
        {
          path: powershellPath,
          contents: ASKPASS_WINDOWS_SCRIPT,
        },
      ],
    };
  }

  return {
    launcherPath: path.join(directory, "ssh-askpass.sh"),
    files: [
      {
        path: path.join(directory, "ssh-askpass.sh"),
        contents: ASKPASS_POSIX_SCRIPT,
        mode: SSH_ASKPASS_SCRIPT_MODE,
      },
    ],
  };
});

export const ensureSshAskpassHelpers = Effect.fn("ssh/auth.ensureSshAskpassHelpers")(
  function* (input: {
    readonly directory: string;
    readonly platform?: NodeJS.Platform;
  }): Effect.fn.Return<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const descriptor = yield* buildSshAskpassHelperDescriptor(input);
    const platform = input.platform ?? process.platform;

    for (const scriptPath of [
      descriptor.launcherPath,
      ...descriptor.files.map((file) => file.path),
    ]) {
      if (!isSafeSshAskpassPath(scriptPath, platform)) {
        return yield* unsafeSshAskpassPathError(scriptPath);
      }
    }

    yield* fs.makeDirectory(path.dirname(descriptor.launcherPath), { recursive: true });

    for (const file of descriptor.files) {
      const existing = yield* fs.exists(file.path);
      const current = existing ? yield* fs.readFileString(file.path) : null;
      if (current !== file.contents) {
        yield* fs.writeFileString(file.path, file.contents);
      }
      if (file.mode !== undefined && platform !== "win32") {
        yield* fs.chmod(file.path, file.mode);
      }
    }

    return descriptor.launcherPath;
  },
);

export const buildSshChildEnvironment = Effect.fn("ssh/auth.buildSshChildEnvironment")(function* (
  input: SshChildEnvironmentOptions = {},
): Effect.fn.Return<
  NodeJS.ProcessEnv,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const baseEnv = { ...(input.baseEnv ?? process.env) };
  if (!input.interactiveAuth) {
    return baseEnv;
  }

  const fs = yield* FileSystem.FileSystem;
  const platform = input.platform ?? process.platform;
  const directory = input.askpassDirectory ?? (yield* getDefaultSshAskpassDirectory());
  const sshAskpass = yield* ensureSshAskpassHelpers({ directory, platform });
  const secretEnvironment: NodeJS.ProcessEnv = {};

  if (input.authSecret !== undefined) {
    const secretFilePath = joinSshAskpassPath(
      directory,
      `${SSH_ASKPASS_SECRET_FILE_PREFIX}-${randomUUID().replaceAll("-", "")}`,
      platform,
    );
    if (!isSafeSshAskpassPath(secretFilePath, platform)) {
      return yield* unsafeSshAskpassPathError(secretFilePath);
    }
    yield* fs.writeFileString(secretFilePath, input.authSecret ?? "", {
      flag: "wx",
      mode: SSH_ASKPASS_SECRET_FILE_MODE,
    });
    if (platform !== "win32") {
      yield* fs.chmod(secretFilePath, SSH_ASKPASS_SECRET_FILE_MODE);
    }
    secretEnvironment.T3_SSH_AUTH_SECRET_FILE = secretFilePath;
  }

  return {
    ...baseEnv,
    SSH_ASKPASS: sshAskpass,
    SSH_ASKPASS_REQUIRE: "force",
    ...secretEnvironment,
    ...(platform === "win32" || baseEnv.DISPLAY ? {} : { DISPLAY: "t3code" }),
  };
});

export function isSshAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return (
    /permission denied \((?:publickey|password|keyboard-interactive|hostbased|gssapi-with-mic)[^)]*\)/u.test(
      normalized,
    ) ||
    /authentication failed/u.test(normalized) ||
    /too many authentication failures/u.test(normalized)
  );
}
