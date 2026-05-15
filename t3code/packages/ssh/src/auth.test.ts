import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  ensureSshAskpassHelpers,
  isSshAuthFailure,
} from "./auth.ts";
import { SshPasswordPromptError } from "./errors.ts";

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
      assert.include(yield* fs.readFileString(askpassPath), 'printf "%s\\n" "$T3_SSH_AUTH_SECRET"');
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
    }),
  );

  it.effect("rejects askpass paths with shell metacharacters", () =>
    Effect.gen(function* () {
      const result = yield* ensureSshAskpassHelpers({
        directory: "/tmp/evil; rm -rf /",
        platform: "linux",
      }).pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.include(String(result.left), "shell metacharacters");
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects askpass paths with spaces", () =>
    Effect.gen(function* () {
      const result = yield* ensureSshAskpassHelpers({
        directory: "/tmp/path with spaces",
        platform: "linux",
      }).pipe(Effect.either);

      assert.isTrue(result._tag === "Left");
      if (result._tag === "Left") {
        assert.include(String(result.left), "spaces");
      }
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("posix script contains trap handler for cleanup", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-test-" });
      yield* ensureSshAskpassHelpers({ directory, platform: "linux" });

      const scriptPath = path.join(directory, "ssh-askpass.sh");
      const script = yield* fs.readFileString(scriptPath);
      assert.include(script, "trap cleanup EXIT INT TERM");
      assert.include(script, "mktemp");
      assert.include(script, "chmod 600");
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("posix script sets restrictive directory permissions", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-test-" });
      yield* ensureSshAskpassHelpers({
        directory: path.join(directory, "sub"),
        platform: "linux",
      });
      const stat = yield* fs.stat(path.join(directory, "sub"));
      // 0o700 = 0o100000 + 0o700 = directory flag + permissions
      assert.equal(stat.mode & 0o777, 0o700);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("windows script uses SecureString", () =>
    Effect.gen(function* () {
      const descriptor = yield* buildSshAskpassHelperDescriptor({
        directory: "C:\temp\t3code-ssh-askpass",
        platform: "win32",
      }).pipe(Effect.provide(NodeServices.layer));

      const psScript = descriptor.files.find((f) => f.path.endsWith(".ps1"));
      assert.isTrue(psScript !== undefined);
      if (psScript) {
        assert.include(psScript.contents, "ConvertTo-SecureString");
        assert.include(psScript.contents, "SecureStringToBSTR");
        assert.include(psScript.contents, "ZeroFreeBSTR");
      }
    }),
  );
});
