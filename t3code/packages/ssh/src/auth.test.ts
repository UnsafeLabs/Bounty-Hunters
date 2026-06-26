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
  validateSshAskpassPath,
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
      const askpassInfo = yield* fs.stat(askpassPath);
      assert.equal(askpassInfo.mode & 0o777, 0o700);

      const contents = yield* fs.readFileString(askpassPath);
      assert.include(contents, "mktemp");
      assert.include(contents, "umask 077");
      assert.include(contents, 'chmod 600 "$secret_file"');
      assert.include(contents, "trap cleanup EXIT INT TERM");
      assert.include(contents, 'rm -f "$secret_file"');
      assert.include(contents, 'printf "%s\\n" "$T3_SSH_AUTH_SECRET" > "$secret_file"');
      assert.include(contents, 'cat "$secret_file"');
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("keeps the posix askpass secret in a locked temporary file", () => {
    assert.include(
      ASKPASS_POSIX_SCRIPT,
      'secret_file="$(mktemp "${TMPDIR:-/tmp}/t3-ssh-askpass.XXXXXX")"',
    );
    assert.include(ASKPASS_POSIX_SCRIPT, "umask 077");
    assert.include(ASKPASS_POSIX_SCRIPT, 'chmod 600 "$secret_file"');
    assert.include(ASKPASS_POSIX_SCRIPT, "trap cleanup EXIT INT TERM");
    assert.include(ASKPASS_POSIX_SCRIPT, 'rm -f "$secret_file"');
  });

  it("rejects askpass paths with spaces or shell metacharacters", () => {
    assert.equal(
      validateSshAskpassPath("/tmp/t3-ssh-askpass/ssh-askpass.sh", "linux"),
      "/tmp/t3-ssh-askpass/ssh-askpass.sh",
    );
    assert.equal(
      validateSshAskpassPath("C:\\temp\\t3code-ssh-askpass\\ssh-askpass.cmd", "win32"),
      "C:\\temp\\t3code-ssh-askpass\\ssh-askpass.cmd",
    );

    assert.throws(() => validateSshAskpassPath("/tmp/bad path/ssh-askpass.sh", "linux"));
    assert.throws(() => validateSshAskpassPath("/tmp/bad;rm/ssh-askpass.sh", "linux"));
    assert.throws(() => validateSshAskpassPath("/tmp/bad$(id)/ssh-askpass.sh", "linux"));
    assert.throws(() => validateSshAskpassPath("C:\\temp\\bad path\\ssh-askpass.cmd", "win32"));
  });

  it("uses SecureString for the windows askpass secret", () => {
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ConvertTo-SecureString");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "SecureStringToBSTR");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ZeroFreeBSTR");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "$secureSecret.Dispose()");
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
});
