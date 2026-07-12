import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Result from "effect/Result";

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
      assert.include(yield* fs.readFileString(askpassPath), "mktemp");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("builds a POSIX askpass script with private temp files and cleanup traps", () => {
    assert.include(ASKPASS_POSIX_SCRIPT, 'mktemp "${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX"');
    assert.include(ASKPASS_POSIX_SCRIPT, 'chmod 600 "$secret_file"');
    assert.include(ASKPASS_POSIX_SCRIPT, "trap cleanup EXIT");
    assert.include(ASKPASS_POSIX_SCRIPT, "trap abort INT TERM");
    assert.include(ASKPASS_POSIX_SCRIPT, 'rm -f "$secret_file"');
  });

  it.effect("rejects POSIX askpass helper paths with shell metacharacters", () =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        buildSshAskpassHelperDescriptor({
          directory: "/tmp/t3code askpass;bad",
          platform: "linux",
        }),
      );

      assert.isTrue(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.equal(result.failure._tag, "SshUnsafeAskpassPathError");
      }
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("marks the POSIX askpass helper executable for owner-only access", () =>
    Effect.gen(function* () {
      const descriptor = yield* buildSshAskpassHelperDescriptor({
        directory: "/tmp/t3code-ssh-askpass",
        platform: "linux",
      });

      assert.equal(descriptor.files.at(0)?.mode, 0o700);
    }).pipe(Effect.provide(NodeServices.layer)),
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
      assert.include(ASKPASS_WINDOWS_SCRIPT, "SecureStringToBSTR");
      assert.include(ASKPASS_WINDOWS_SCRIPT, "ZeroFreeBSTR");
    }),
  );
});
