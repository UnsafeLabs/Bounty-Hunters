import { execFileSync } from "node:child_process";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  isSshAuthFailure,
} from "./auth.ts";

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
      const script = yield* fs.readFileString(askpassPath);
      assert.include(script, 'secret_file=$(mktemp "${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX")');
      assert.include(script, 'printf \'%s\\n\' "$T3_SSH_AUTH_SECRET" > "$secret_file"');
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("stages the cached password in a 0600 temp file wiped by the exit trap", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-trap-" });
      const askpassDirectory = path.join(root, "askpass");
      const env = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory,
        platform: "linux",
        baseEnv: {},
      });
      const scriptPath = env.SSH_ASKPASS;
      if (scriptPath === undefined) {
        throw new Error("expected SSH_ASKPASS to be configured");
      }

      // The script must stage (and then delete) its temp file inside this sandbox.
      const tmpDirectory = path.join(root, "tmp");
      yield* fs.makeDirectory(tmpDirectory, { recursive: true });

      // Shadow `rm` so the trap's delete first records the staged file's
      // permissions via a shim. This proves both that the file is 0600 and that
      // the EXIT/INT/TERM trap actually fires on the exit path - on unfixed code
      // there is no temp file, no trap, and this log is never written.
      const realRm = execFileSync("/bin/sh", ["-c", "command -v rm"]).toString().trim();
      const binDirectory = path.join(root, "bin");
      yield* fs.makeDirectory(binDirectory, { recursive: true });
      const permissionsLog = path.join(root, "perms.log");
      const rmShim = path.join(binDirectory, "rm");
      yield* fs.writeFileString(
        rmShim,
        [
          "#!/bin/sh",
          'for arg in "$@"; do',
          '  case "$arg" in',
          "    -*) ;;",
          `    *) if [ -e "$arg" ]; then stat -c '%a' "$arg" >> "$T3_TEST_PERMS_LOG"; fi ;;`,
          "  esac",
          "done",
          `exec ${realRm} "$@"`,
          "",
        ].join("\n"),
      );
      yield* fs.chmod(rmShim, 0o755);

      const stdout = yield* Effect.sync(() =>
        execFileSync("/bin/sh", [scriptPath], {
          env: {
            PATH: `${binDirectory}:/usr/bin:/bin`,
            TMPDIR: tmpDirectory,
            T3_SSH_AUTH_SECRET: "super-secret",
            T3_TEST_PERMS_LOG: permissionsLog,
          },
        }).toString(),
      );

      // The helper still hands the cached password to ssh on stdout.
      assert.equal(stdout, "super-secret\n");
      // The staged temp file was created owner-only (0600) ...
      assert.equal((yield* fs.readFileString(permissionsLog)).trim(), "600");
      // ... and the trap removed it, leaving no secret behind in the sandbox.
      assert.deepEqual(yield* fs.readDirectory(tmpDirectory), []);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects askpass paths containing spaces or shell metacharacters", () =>
    Effect.gen(function* () {
      const failure = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: "/tmp/t3 code ssh",
        platform: "linux",
        baseEnv: {},
      }).pipe(Effect.flip);
      assert.equal(failure._tag, "SshAskpassPathError");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("hardens the askpass directory to owner-only permissions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-perms-" });
      const directory = path.join(root, "askpass");
      // Simulate a pre-existing, world-readable directory to prove the helper
      // tightens permissions rather than trusting whatever was already there.
      yield* fs.makeDirectory(directory, { recursive: true, mode: 0o755 });

      yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {},
      });

      const directoryInfo = yield* fs.stat(directory);
      assert.equal(Number(directoryInfo.mode) & 0o777, 0o700);

      const scriptInfo = yield* fs.stat(path.join(directory, "ssh-askpass.sh"));
      assert.equal(Number(scriptInfo.mode) & 0o777, 0o700);
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

      // The PowerShell variant keeps the password in a SecureString and frees the
      // unmanaged buffer rather than holding the plaintext on the managed heap.
      const powershell = descriptor.files.find((file) => file.path.endsWith(".ps1"));
      if (powershell === undefined) {
        throw new Error("expected a ssh-askpass.ps1 file");
      }
      assert.include(powershell.contents, "ConvertTo-SecureString");
      assert.include(powershell.contents, "ZeroFreeBSTR");
    }),
  );
});
