import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeFileSync } from "node:fs";

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
const POSIX_SAFE_SCRIPT_PATH_PATTERN = /^[A-Za-z0-9_./-]+$/u;
const WINDOWS_UNSAFE_SCRIPT_PATH_PATTERN = /[&|;`$<>]/u;

export function validateSshAskpassScriptPath(path: string, platform: NodeJS.Platform): string {
  if (path.length === 0) {
    throw new SshPasswordPromptError({
      message: "SSH askpass script path must not be empty.",
    });
  }

  if (platform === "win32") {
    if (WINDOWS_UNSAFE_SCRIPT_PATH_PATTERN.test(path)) {
      throw new SshPasswordPromptError({
        message: `SSH askpass script path contains unsafe shell metacharacters: ${path}`,
      });
    }
    return path;
  }

  if (!POSIX_SAFE_SCRIPT_PATH_PATTERN.test(path)) {
    throw new SshPasswordPromptError({
      message: `SSH askpass script path contains unsafe shell metacharacters: ${path}`,
    });
  }

  return path;
}

function writeSecretFileMode0600(path: string, secret: string): void {
  const fd = openSync(path, "wx", 0o600);
  try {
    writeFileSync(fd, secret, { encoding: "utf8" });
  } finally {
    closeSync(fd);
  }
}

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
# from the renderer's in-app prompt. The cached password is stored in a private
# 0600 file created by the parent process and removed by this helper on every
# exit path.
cleanup() {
  if [ -n "\${T3_SSH_AUTH_SECRET_FILE:-}" ]; then
    rm -f -- "$T3_SSH_AUTH_SECRET_FILE"
  fi
}
trap cleanup EXIT INT TERM

if [ -n "\${T3_SSH_AUTH_SECRET_FILE:-}" ]; then
  if [ ! -f "$T3_SSH_AUTH_SECRET_FILE" ]; then
    printf 'T3 Code ssh-askpass secret file is missing.\\n' >&2
    exit 1
  fi
  cat -- "$T3_SSH_AUTH_SECRET_FILE"
  exit 0
fi

printf 'T3 Code ssh-askpass invoked without T3_SSH_AUTH_SECRET_FILE.\\n' >&2
exit 1
`;

export const ASKPASS_WINDOWS_LAUNCHER_SCRIPT = `@echo off\r
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ssh-askpass.ps1" %*\r
`;

export const ASKPASS_WINDOWS_SCRIPT = `# Invoked by ssh via SSH_ASKPASS (through ssh-askpass.cmd) when T3 Code re-runs\r
# ssh with a cached password from the renderer's in-app prompt. Keep the secret\r
# in a SecureString until the final askpass stdout write required by OpenSSH.\r
if ($null -ne $env:T3_SSH_AUTH_SECRET) {\r
  $secureSecret = ConvertTo-SecureString $env:T3_SSH_AUTH_SECRET -AsPlainText -Force\r
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureSecret)\r
  try {\r
    [Console]::Out.WriteLine([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))\r
    exit 0\r
  } finally {\r
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)\r
  }\r
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
    const powershellPath = validateSshAskpassScriptPath(
      joinSshAskpassPath(directory, "ssh-askpass.ps1", platform),
      platform,
    );
    const launcherPath = validateSshAskpassScriptPath(
      joinSshAskpassPath(directory, "ssh-askpass.cmd", platform),
      platform,
    );
    return {
      launcherPath,
      files: [
        {
          path: launcherPath,
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
    launcherPath: validateSshAskpassScriptPath(path.join(directory, "ssh-askpass.sh"), platform),
    files: [
      {
        path: validateSshAskpassScriptPath(path.join(directory, "ssh-askpass.sh"), platform),
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
  const path = yield* Path.Path;
  const directory = input.askpassDirectory ?? (yield* getDefaultSshAskpassDirectory());
  const sshAskpass = yield* ensureSshAskpassHelpers({ directory, platform });
  const authSecret = input.authSecret ?? "";
  const posixSecretPath =
    input.authSecret === undefined || platform === "win32"
      ? null
      : validateSshAskpassScriptPath(
          path.join(directory, `ssh-askpass-secret-${process.pid}-${randomUUID()}`),
          platform,
        );

  if (posixSecretPath !== null) {
    yield* Effect.sync(() => writeSecretFileMode0600(posixSecretPath, authSecret));
  }

  return {
    ...baseEnv,
    SSH_ASKPASS: sshAskpass,
    SSH_ASKPASS_REQUIRE: "force",
    ...(input.authSecret === undefined
      ? {}
      : platform === "win32"
        ? { T3_SSH_AUTH_SECRET: authSecret }
        : { T3_SSH_AUTH_SECRET_FILE: posixSecretPath ?? "" }),
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
