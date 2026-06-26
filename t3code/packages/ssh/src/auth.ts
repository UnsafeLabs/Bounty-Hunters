import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HashMap from "effect/HashMap";
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

export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
# Invoked by ssh via SSH_ASKPASS when T3 Code re-runs ssh with a cached password
# from the renderer's in-app prompt. We never expose a native dialog here - if
# T3_SSH_AUTH_SECRET is missing, that's a caller bug and we fail loudly.
T3_ASKPASS_TMPFILE=$(mktemp -t t3code-ssh-askpass.XXXXXXXXXX)
chmod 0600 "$T3_ASKPASS_TMPFILE"
trap 'rm -f "$T3_ASKPASS_TMPFILE"' EXIT INT TERM
if [ "\${T3_SSH_AUTH_SECRET+x}" = "x" ]; then
  printf "%s\\n" "$T3_SSH_AUTH_SECRET"
  exit 0
fi
printf 'T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.\\n' >&2
exit 1
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\r
# ssh with a cached password from the renderer's in-app prompt. We never expose\r
# a native dialog here - if T3_SSH_AUTH_SECRET is missing, that's a caller bug\r
# and we fail loudly.\r
$secureString = ConvertTo-SecureString $env:T3_SSH_AUTH_SECRET -AsPlainText -Force\r
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureString)\r
try {\r
  if ($null -ne $env:T3_SSH_AUTH_SECRET) {\r
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)\r
    [Console]::Out.WriteLine($plain)\r
    exit 0\r
  }\r
  [Console]::Error.WriteLine("T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.")\r
  exit 1\r
} finally {\r
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)\r
}\r
`;

export const getDefaultSshAskpassDirectory = Effect.fn("ssh/auth.getDefaultSshAskpassDirectory")(
# a native dialog here - if T3_SSH_AUTH_SECRET is missing, that's a caller bug\r
  const path = yield* Path.Path;
  const directory = input.directory;

  // Validate that the directory path does not contain shell metacharacters
  // to prevent shell injection in the askpass script
  const shellMetacharPattern = /[;&|`$(){}[\]<>|!#*?\\]/;
  if (shellMetacharPattern.test(directory)) {
    yield* Effect.fail(new Error("Askpass directory path contains invalid shell metacharacters"));
  }
  if (directory.includes(" ")) {
    yield* Effect.fail(new Error("Askpass directory path cannot contain spaces"));
  }

  if (platform === "win32") {
    const powershellPath = joinSshAskpassPath(directory, "ssh-askpass.ps1", platform);
    return {
exit 1\r
      files: [
        {
          path: powershellPath,
          contents: ASKPASS_WINDOWS_SCRIPT,
          mode: 0o644,
        },
        {
    const parentDirectory = yield* fs.makeTempDirectory({ prefix: "t3code-ssh-runtime-" });
          contents: ASKPASS_WINDOWS_LAUNCHER_SCRIPT,
          mode: 0o644,
        },
      ],
    };
  }

)(function* (input: {
  readonly directory: string;
    files: [
      {
        path: scriptPath,
        contents: ASKPASS_POSIX_SCRIPT,
        mode: 0o755,
      },
    ],
  if (platform === "win32") {
});

// Additional exports for testing
export { shellMetacharPattern };
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
        mode: 0o700,
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

  const platform = input.platform ?? process.platform;
  const directory = input.askpassDirectory ?? (yield* getDefaultSshAskpassDirectory());
  const sshAskpass = yield* ensureSshAskpassHelpers({ directory, platform });

  return {
    ...baseEnv,
    SSH_ASKPASS: sshAskpass,
    SSH_ASKPASS_REQUIRE: "force",
    ...(input.authSecret === undefined ? {} : { T3_SSH_AUTH_SECRET: input.authSecret ?? "" }),
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
