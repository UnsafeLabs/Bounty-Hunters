import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";

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
      assert.match(env.T3_SSH_AUTH_SECRET_FILE ?? "", /ssh-askpass-secret-/u);
      assert.equal(env.T3_SSH_AUTH_SECRET, undefined);
      assert.equal(env.DISPLAY, "t3code");
      assert.equal(yield* fs.exists(askpassPath), true);
      assert.include(yield* fs.readFileString(askpassPath), "T3_SSH_AUTH_SECRET_FILE");

      const secretPath = env.T3_SSH_AUTH_SECRET_FILE ?? "";
      assert.equal(statSync(secretPath).mode & 0o777, 0o600);
      assert.equal(execFileSync("sh", [askpassPath], { env, encoding: "utf8" }), "super-secret");
      assert.equal(existsSync(secretPath), false);
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
      assert.include(descriptor.files[1]?.contents ?? "", "ConvertTo-SecureString");
    }),
  );

  it("rejects unsafe askpass script paths", () => {
    assert.throws(() =>
      Effect.runSync(
        buildSshAskpassHelperDescriptor({
          directory: "/tmp/t3code askpass;rm-rf",
          platform: "linux",
        }).pipe(Effect.provide(NodeServices.layer)),
      ),
    );
  });
});
