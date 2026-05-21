// @effect-diagnostics nodeBuiltinImport:off
import { spawnSync } from "node:child_process";

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

function runAskpassScript(askpassPath: string, env: NodeJS.ProcessEnv) {
  return spawnSync(askpassPath, [], {
    env,
    encoding: "utf8",
  });
}

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
      const tmpDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-tmp-" });
      const helperDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-bin-" });
      const catLogPath = path.join(tmpDirectory, "cat-log.txt");
      const catScriptPath = path.join(helperDirectory, "cat");
      yield* fs.writeFileString(
        catScriptPath,
        `#!/bin/sh
set -eu
file="$1"
mode="$(stat -f '%Lp' "$file" 2>/dev/null || stat -c '%a' "$file")"
printf '%s\t%s\n' "$file" "$mode" > "$CAT_LOG_PATH"
/bin/cat "$file"
`,
      );
      yield* fs.chmod(catScriptPath, 0o700);
      const env = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {
          PATH: `${helperDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          TMPDIR: tmpDirectory,
          CAT_LOG_PATH: catLogPath,
        },
      });

      const askpassPath = path.join(directory, "ssh-askpass.sh");
      assert.equal(env.SSH_ASKPASS, askpassPath);
      assert.equal(env.SSH_ASKPASS_REQUIRE, "force");
      assert.equal(env.T3_SSH_AUTH_SECRET, "super-secret");
      assert.equal(env.DISPLAY, "t3code");
      assert.equal(yield* fs.exists(askpassPath), true);
      const askpassScript = yield* fs.readFileString(askpassPath);
      assert.include(askpassScript, 'mktemp "${TMPDIR:-/tmp}/t3code-ssh-secret.XXXXXX"');
      assert.include(askpassScript, "trap handle_signal INT TERM");

      const result = yield* Effect.sync(() => runAskpassScript(askpassPath, env));

      assert.equal(result.status, 0);
      assert.equal(result.stdout, "super-secret\n");

      const [secretFilePath = "", tempFileMode = ""] = (yield* fs.readFileString(catLogPath))
        .trim()
        .split("\t");
      assert.equal(tempFileMode, "600");
      assert.equal(yield* fs.exists(secretFilePath), false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("cleans up the temporary secret file when the POSIX helper is interrupted", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "t3-ssh-askpass-signal-" });
      const tmpDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ssh-askpass-signal-tmp-",
      });
      const helperDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-ssh-askpass-signal-bin-",
      });
      const catLogPath = path.join(tmpDirectory, "cat-log.txt");
      const catScriptPath = path.join(helperDirectory, "cat");
      yield* fs.writeFileString(
        catScriptPath,
        `#!/bin/sh
set -eu
file="$1"
printf '%s\n' "$file" > "$CAT_LOG_PATH"
kill -TERM "$PPID"
sleep 0.1
exit 1
`,
      );
      yield* fs.chmod(catScriptPath, 0o700);

      const env = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: directory,
        platform: "linux",
        baseEnv: {
          PATH: `${helperDirectory}:${process.env.PATH ?? "/usr/bin:/bin"}`,
          TMPDIR: tmpDirectory,
          CAT_LOG_PATH: catLogPath,
        },
      });

      const askpassPath = path.join(directory, "ssh-askpass.sh");
      const result = yield* Effect.sync(() => runAskpassScript(askpassPath, env));

      assert.equal(result.status === 0, false);
      const secretFilePath = (yield* fs.readFileString(catLogPath)).trim();
      assert.equal(yield* fs.exists(secretFilePath), false);
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects POSIX askpass paths with shell-unsafe characters", () =>
    Effect.gen(function* () {
      const error = yield* buildSshChildEnvironment({
        authSecret: "super-secret",
        interactiveAuth: true,
        askpassDirectory: "/tmp/t3code ssh-askpass",
        platform: "linux",
        baseEnv: {},
      }).pipe(Effect.flip, Effect.provide(NodeServices.layer));

      assert.equal(error._tag, "SshAskpassPathError");
      assert.include(error.message, "unsupported characters");
    }),
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
      const powershellScript =
        descriptor.files.find((file) => file.path.endsWith(".ps1"))?.contents ?? "";
      assert.include(powershellScript, "ConvertTo-SecureString");
      assert.include(powershellScript, "ZeroFreeBSTR");
    }),
  );
});
