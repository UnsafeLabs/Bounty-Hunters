import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  ASKPASS_POSIX_SCRIPT,
  ASKPASS_WINDOWS_SCRIPT,
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
      assert.include(script, "umask 077");
      assert.include(script, 'mktemp "${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX"');
      assert.include(script, 'chmod 600 "$secret_file"');
      assert.include(script, "trap cleanup_secret_file EXIT INT TERM");
      assert.include(script, 'rm -f -- "$secret_file"');
      assert.notInclude(script, "set -x");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects unsafe POSIX askpass launcher paths", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        buildSshAskpassHelperDescriptor({
          directory: "/tmp/t3 ssh;askpass",
          platform: "linux",
        }).pipe(Effect.provide(NodeServices.layer)),
      );

      assert.equal(failure._tag, "SshAskpassPathError");
      assert.include(failure.path, " ");
      assert.include(failure.path, ";");
    }),
  );

  it("keeps POSIX askpass secret files private and self-cleaning", () => {
    assert.include(ASKPASS_POSIX_SCRIPT, "umask 077");
    assert.include(ASKPASS_POSIX_SCRIPT, 'mktemp "${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX"');
    assert.include(ASKPASS_POSIX_SCRIPT, 'chmod 600 "$secret_file"');
    assert.include(ASKPASS_POSIX_SCRIPT, "trap cleanup_secret_file EXIT INT TERM");
    assert.include(ASKPASS_POSIX_SCRIPT, 'rm -f -- "$secret_file"');
    assert.notInclude(ASKPASS_POSIX_SCRIPT, "T3_SSH_AUTH_SECRET' >&2");
    assert.notInclude(ASKPASS_POSIX_SCRIPT, "set -x");
  });

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
    }),
  );

  it("uses SecureString cleanup in the Windows askpass helper", () => {
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ConvertTo-SecureString");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "SecureStringToBSTR");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ZeroFreeBSTR");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "Remove-Item Env:T3_SSH_AUTH_SECRET");
    assert.notInclude(ASKPASS_WINDOWS_SCRIPT, "[Console]::Out.WriteLine($env:T3_SSH_AUTH_SECRET)");
  });
});
