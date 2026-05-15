import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  ASKPASS_POSIX_SCRIPT,
  ASKPASS_WINDOWS_SCRIPT,
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  isSshAuthFailure,
  validateSshAskpassScriptPath,
} from "./auth.ts";

const collectText = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const runAskpassScript = (
  scriptPath: string,
  env: NodeJS.ProcessEnv,
): Effect.Effect<
  { readonly stdout: string; readonly stderr: string; readonly exitCode: number },
  PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(scriptPath, [], { env }));
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectText(child.stdout),
        collectText(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );
    return { stdout, stderr, exitCode };
  });

describe("ssh auth", () => {
  it.effect("detects ssh auth failures from common permission denied messages", () =>
    Effect.sync(() => {
      assert.equal(
        isSshAuthFailure(
          new Error(
            "julius@100.65.180.100: Permission denied (publickey,password,keyboard-interactive).",
          ),
        ),
        true,
      );
      assert.equal(isSshAuthFailure(new Error("Permission denied (publickey).")), true);
      assert.equal(isSshAuthFailure(new Error("Connection timed out")), false);
      assert.equal(isSshAuthFailure(new Error("mkdir: Permission denied")), false);
    }),
  );

  it.effect("creates askpass env for cached password prompts", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-test-" });
      const env = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {},
      });

      const askpassPath = path.join(directory, "ssh-askpass.sh");
      assert.equal(env.SSH_ASKPASS, askpassPath);
      assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
      assert.equal(env.T3_SSH_AUTH_SECRET, "super-secret");
      assert.equal(env.DISPLAY, "t3code");
      assert.equal(yield* fs.exists(askpassPath), true);
      assert.include(yield* fs.readFileString(askpassPath), "mktemp");
      assert.equal((yield* fs.stat(askpassPath)).mode & 0o777, 0o700);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("uses a 0600 temp file and removes it after POSIX askpass exits", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") {
        return;
      }

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-test-" });
      const binDirectory = path.join(directory, "bin");
      const modePath = path.join(directory, "mode.txt");
      const scriptPath = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {},
      }).pipe(Effect.map((env) => env.SSH_ASKPASS));
      if (!scriptPath) {
        assert.fail("Expected SSH_ASKPASS to be set.");
      }

      yield* fs.makeDirectory(binDirectory);
      const catWrapperPath = path.join(binDirectory, "cat");
      yield* fs.writeFileString(
        catWrapperPath,
        `#!/bin/sh
if stat -f '%Lp' "$1" > "$MODE_OUT" 2>/dev/null; then
  :
else
  stat -c '%a' "$1" > "$MODE_OUT"
fi
exec /bin/cat "$@"
`,
      );
      yield* fs.chmod(catWrapperPath, 0o700);

      const result = yield* runAskpassScript(scriptPath, {
        PATH: `${binDirectory}:/bin:/usr/bin`,
        MODE_OUT: modePath,
        TMPDIR: directory,
        T3_SSH_AUTH_SECRET: "super-secret",
      });

      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "super-secret\n");
      assert.equal(result.stderr, "");
      assert.equal((yield* fs.readFileString(modePath)).trim(), "600");
      assert.deepEqual(
        (yield* fs.readDirectory(directory)).filter((entry) =>
          entry.startsWith("t3code-ssh-askpass-secret."),
        ),
        [],
      );
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("removes the POSIX askpass temp file on TERM", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") {
        return;
      }

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-test-" });
      const binDirectory = path.join(directory, "bin");
      const tempPathRecord = path.join(directory, "temp-path.txt");
      const scriptPath = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {},
      }).pipe(Effect.map((env) => env.SSH_ASKPASS));
      if (!scriptPath) {
        assert.fail("Expected SSH_ASKPASS to be set.");
      }

      yield* fs.makeDirectory(binDirectory);
      const catWrapperPath = path.join(binDirectory, "cat");
      yield* fs.writeFileString(
        catWrapperPath,
        `#!/bin/sh
printf '%s\\n' "$1" > "$TEMP_PATH_OUT"
kill -TERM "$PPID"
sleep 1
`,
      );
      yield* fs.chmod(catWrapperPath, 0o700);

      const result = yield* runAskpassScript(scriptPath, {
        PATH: `${binDirectory}:/bin:/usr/bin`,
        TEMP_PATH_OUT: tempPathRecord,
        TMPDIR: directory,
        T3_SSH_AUTH_SECRET: "super-secret",
      });

      assert.equal(result.exitCode, 143);
      const secretTempPath = (yield* fs.readFileString(tempPathRecord)).trim();
      assert.equal(yield* fs.exists(secretTempPath), false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("builds a windows askpass launcher pair", () =>
    Effect.gen(function* () {
      const descriptor = yield* buildSshAskpassHelperDescriptor({
        directory: "C:\\temp\\t3code-ssh-askpass",
        platform: "win32",
      }).pipe(Effect.provide(NodeServices.layer));

      assert.equal(descriptor.launcherPath, "C:\\temp\\t3code-ssh-askpass\\ssh-askpass.cmd");
      assert.deepEqual(
        descriptor.files.map((file) => file.path.split("\\").at(-1)),
        ["ssh-askpass.cmd", "ssh-askpass.ps1"],
      );
      assert.include(ASKPASS_WINDOWS_SCRIPT, "ConvertTo-SecureString");
      assert.include(ASKPASS_WINDOWS_SCRIPT, "ZeroFreeBSTR");
    }),
  );

  it.effect("rejects askpass script paths with shell metacharacters", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* validateSshAskpassScriptPath("/tmp/t3code-ssh-askpass/ssh-askpass.sh").pipe(
          Effect.provide(NodeServices.layer),
        ),
        "/tmp/t3code-ssh-askpass/ssh-askpass.sh",
      );

      const error = yield* buildSshAskpassHelperDescriptor({
        directory: "/tmp/t3code ssh;askpass",
        platform: "linux",
      }).pipe(Effect.provide(NodeServices.layer), Effect.flip);
      assert.equal(error._tag, "SshAskpassPathError");
    }),
  );

  it("installs POSIX cleanup traps for exit and signals", () => {
    assert.include(ASKPASS_POSIX_SCRIPT, "trap cleanup EXIT");
    assert.include(ASKPASS_POSIX_SCRIPT, "trap 'cleanup; exit 130' INT");
    assert.include(ASKPASS_POSIX_SCRIPT, "trap 'cleanup; exit 143' TERM");
  });
});
