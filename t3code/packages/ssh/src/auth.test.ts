import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  ASKPASS_POSIX_SCRIPT,
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  isSshAuthFailure,
  validateAskpassPath,
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

  it.effect("POSIX askpass script uses mktemp with mode 0600 and includes trap cleanup", () =>
    Effect.sync(() => {
      assert.include(ASKPASS_POSIX_SCRIPT, "mktemp");
      assert.include(ASKPASS_POSIX_SCRIPT, "0600");
      assert.include(ASKPASS_POSIX_SCRIPT, "_cleanup");
      assert.include(ASKPASS_POSIX_SCRIPT, "trap _cleanup EXIT INT TERM");
    }),
  );

  it.effect("POSIX askpass script has rm -f cleanup in trap", () =>
    Effect.sync(() => {
      assert.include(ASKPASS_POSIX_SCRIPT, "rm -f");
    }),
  );

  it.effect("validateAskpassPath rejects paths with spaces", () =>
    Effect.gen(function* () {
      const result = yield* validateAskpassPath("/tmp/bad path/askpass.sh").pipe(
        Effect.flip,
        Effect.catchAll((err) => Effect.succeed(err)),
      );
      assert.ok(result);
      assert.include(result.message, "Invalid askpass script path");
    }),
  );

  it.effect("validateAskpassPath rejects paths with shell metacharacters", () =>
    Effect.gen(function* () {
      const result = yield* validateAskpassPath("/tmp/askpass;rm -rf /").pipe(
        Effect.flip,
        Effect.catchAll((err) => Effect.succeed(err)),
      );
      assert.ok(result);
      assert.include(result.message, "Invalid askpass script path");
    }),
  );

  it.effect("validateAskpassPath accepts valid paths", () =>
    Effect.gen(function* () {
      const result = yield* validateAskpassPath("/tmp/t3code-ssh-askpass/ssh-askpass.sh").pipe(
        Effect.matchEffect({
          onSuccess: () => Effect.succeed("ok"),
          onFailure: () => Effect.succeed("fail"),
        }),
      );
      assert.equal(result, "ok");
    }),
  );

  it.effect("created askpass script file has mode 0600", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-perm-test-" });
      const env = yield* buildSshChildEnvironment({
        authSecret: "test-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {},
      });

      const askpassPath = path.join(directory, "ssh-askpass.sh");
      const stat = yield* fs.stat(askpassPath);
      // Verify mode is 0600 (owner read/write only)
      assert.equal(stat.mode & 0o777, 0o600);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("Windows askpass script uses SecureString", () =>
    Effect.gen(function* () {
      const descriptor = yield* buildSshAskpassHelperDescriptor({
        directory: "C:\\temp\\t3code-ssh-askpass",
        platform: "win32",
      }).pipe(Effect.provide(NodeServices.layer));

      const psScript = descriptor.files.find(
        (f) => f.path.endsWith("ssh-askpass.ps1"),
      );
      assert.ok(psScript);
      assert.include(psScript!.contents, "SecureString");
      assert.include(psScript!.contents, "ConvertTo-SecureString");
      assert.include(psScript!.contents, "ZeroFreeBSTR");
    }),
  );
});
