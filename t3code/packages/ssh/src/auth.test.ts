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
  isSafeSshAskpassPath,
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
        platform: process.platform,
        baseEnv: {},
      });

      const askpassPath =
        process.platform === "win32"
          ? `${directory.replace(/[\\/]+$/u, "")}\\ssh-askpass.cmd`
          : path.join(directory, "ssh-askpass.sh");
      const scriptPath =
        process.platform === "win32"
          ? `${directory.replace(/[\\/]+$/u, "")}\\ssh-askpass.ps1`
          : askpassPath;
      const secretPath = env.T3_SSH_AUTH_SECRET_FILE;

      assert.equal(env.SSH_ASKPASS, askpassPath);
      assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
      assert.equal(env.T3_SSH_AUTH_SECRET, undefined);
      assert.isString(secretPath);
      assert.match(secretPath ?? "", /ssh-auth-secret-[a-f0-9]+$/u);
      assert.equal(yield* fs.readFileString(secretPath ?? ""), "super-secret");
      if (process.platform !== "win32") {
        assert.equal(env.DISPLAY, "t3code");
        assert.equal((yield* fs.stat(secretPath ?? "")).mode & 0o777, 0o600);
      }
      assert.equal(yield* fs.exists(askpassPath), true);
      assert.include(yield* fs.readFileString(scriptPath), "T3_SSH_AUTH_SECRET_FILE");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it("keeps the posix askpass script defensive", () => {
    assert.include(ASKPASS_POSIX_SCRIPT, "trap cleanup EXIT");
    assert.include(ASKPASS_POSIX_SCRIPT, "trap 'cleanup; exit 130' INT TERM");
    assert.include(ASKPASS_POSIX_SCRIPT, "*[!A-Za-z0-9_./-]*");
    assert.include(ASKPASS_POSIX_SCRIPT, 'rm -f -- "$secret_file"');
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

  it("uses SecureString in the windows askpass helper", () => {
    assert.include(ASKPASS_WINDOWS_SCRIPT, "T3_SSH_AUTH_SECRET_FILE");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ConvertTo-SecureString");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "ZeroFreeBSTR");
    assert.include(ASKPASS_WINDOWS_SCRIPT, "Remove-Item -LiteralPath");
  });

  it("rejects unsafe askpass paths before shelling out", () => {
    assert.equal(isSafeSshAskpassPath("/tmp/t3code/ssh-askpass.sh", "linux"), true);
    assert.equal(isSafeSshAskpassPath("/tmp/t3code/ssh-askpass.sh;cat", "linux"), false);
    assert.equal(isSafeSshAskpassPath("/tmp/t3 code/ssh-askpass.sh", "linux"), false);
    assert.equal(isSafeSshAskpassPath("-ssh-askpass.sh", "linux"), false);
    assert.equal(isSafeSshAskpassPath("C:\\Temp\\t3code\\ssh-askpass.cmd", "win32"), true);
    assert.equal(
      isSafeSshAskpassPath('C:\\Temp\\t3code\\ssh-askpass.cmd" & whoami', "win32"),
      false,
    );
  });
});
