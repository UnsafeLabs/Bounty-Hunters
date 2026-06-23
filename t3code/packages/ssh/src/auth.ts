import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

import { SshAskpassPathError, SshPasswordPromptError } from "./errors.ts";

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

// ssh execs SSH_ASKPASS for us and the Windows launcher embeds the path verbatim,
// so a space or shell metacharacter in it would either break invocation or let a
// crafted path smuggle an argument. We only ever hand ssh a path we can prove is
// a single safe token; path separators and the Windows drive colon stay allowed.
const UNSAFE_ASKPASS_PATH_PATTERN = /[\s"'`$;&|<>(){}\[\]*?!~]/u;

const ensureSafeAskpassExecutablePath = (
  executablePath: string,
): Effect.Effect<void, SshAskpassPathError> =>
  executablePath.length === 0 || UNSAFE_ASKPASS_PATH_PATTERN.test(executablePath)
    ? Effect.fail(
        new SshAskpassPathError({
          message: `Refusing to use an unsafe ssh-askpass path: ${JSON.stringify(executablePath)}.`,
          executablePath,
        }),
      )
    : Effect.void;

function joinSshAskpassPath(
  directory: string,
  fileName: string,
  platform: NodeJS.Platform,
): string {
  const trimmed = directory.replace(/[\\/]+$/u, "");
  return platform === "win32" ? `${trimmed}\\${fileName}` : `${trimmed}/${fileName}`;
}

export const ASKPASS_POSIX_SCRIPT = `#!/bin/sh
# Invoked by ssh via SSH_ASKPASS when T3 Code re-runs ssh with a cached password
# from the renderer's in-app prompt. We never expose a native dialog here - if
# T3_SSH_AUTH_SECRET is missing, that's a caller bug and we fail loudly.
if [ "\${T3_SSH_AUTH_SECRET+x}" != "x" ]; then
  printf 'T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.\\n' >&2
  exit 1
fi
# Stage the secret in an owner-only temp file instead of leaving it on a shared
# path. umask 077 forces the file to 0600 from creation, and the trap wipes it
# on normal exit or if ssh interrupts or terminates us mid-prompt.
umask 077
secret_file=$(mktemp "\${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX") || {
  printf 'T3 Code ssh-askpass could not create a secure temp file.\\n' >&2
  exit 1
}
trap 'rm -f "$secret_file"' EXIT INT TERM
printf '%s\\n' "$T3_SSH_AUTH_SECRET" > "$secret_file"
cat "$secret_file"
exit 0
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\r
# ssh with a cached password from the renderer's in-app prompt. We never expose\r
# a native dialog here - if T3_SSH_AUTH_SECRET is missing, that's a caller bug\r
# and we fail loudly.\r
if ($null -ne $env:T3_SSH_AUTH_SECRET) {\r
  # Keep the password inside a SecureString and only materialise it through an\r
  # unmanaged BSTR for the single write to stdout, then zero and free that buffer\r
  # so the plaintext does not linger in managed heap memory.\r
  $secure = ConvertTo-SecureString -String $env:T3_SSH_AUTH_SECRET -AsPlainText -Force\r
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)\r
  try {\r
    [Console]::Out.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))\r
  } finally {\r
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)\r
    $secure.Dispose()\r
  }\r
  exit 0\r
}\r
[Console]::Error.WriteLine("T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET.")\r
exit 1\r
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
        mode: 0o700,
      },
    ],
  };
});

export const ensureSshAskpassHelpers = Effect.fn("ssh/auth.ensureSshAskpassHelpers")(
  function* (input: {
    readonly directory: string;
    readonly platform?: NodeJS.Platform;
  }): Effect.fn.Return<
    string,
    PlatformError.PlatformError | SshAskpassPathError,
    FileSystem.FileSystem | Path.Path
  > {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const descriptor = yield* buildSshAskpassHelperDescriptor(input);
    const platform = input.platform ?? process.platform;
    const directory = path.dirname(descriptor.launcherPath);

    // Validate before touching the filesystem so an unsafe path never reaches
    // ssh (or gets created on disk under a name we cannot quote safely).
    yield* ensureSafeAskpassExecutablePath(descriptor.launcherPath);

    // The askpass helper relays the user's cached SSH password to ssh, so the
    // directory holding it must stay owner-only - a world-readable temp
    // directory would leak the script (and let a local user swap it). Create it
    // 0700 and re-assert the mode in case it already existed with looser
    // permissions; mode/chmod are POSIX concepts, so we skip the chmod on win32.
    yield* fs.makeDirectory(directory, { recursive: true, mode: 0o700 });
    if (platform !== "win32") {
      yield* fs.chmod(directory, 0o700);
    }

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
  PlatformError.PlatformError | SshAskpassPathError,
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
