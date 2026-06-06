import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";

import { execFile } from "node:child_process";
import { mkdtemp, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  ASKPASS_POSIX_SCRIPT,
  buildSshAskpassHelperDescriptor,
  buildSshChildEnvironment,
  isSshAuthFailure,
  isSafePosixAskpassPath,
} from "./auth.ts";

const execFileAsync = promisify(execFile);

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
      if (process.platform === "win32") {
        return;
      }

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
      const askpassScript = yield* fs.readFileString(askpassPath);
      assert.include(askpassScript, "umask 077");
      assert.include(askpassScript, 'mktemp "${TMPDIR:-/tmp}/t3code-ssh-askpass.XXXXXX"');
      assert.include(askpassScript, "trap cleanup EXIT INT TERM");
      assert.include(askpassScript, 'chmod 600 "$secret_file"');
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
  );

  it.effect("rejects unsafe POSIX askpass paths", () =>
    Effect.sync(() => {
      assert.equal(isSafePosixAskpassPath("/tmp/t3code-ssh-askpass/ssh-askpass.sh"), true);
      assert.equal(isSafePosixAskpassPath("/tmp/t3 code/ssh-askpass.sh"), false);
      assert.equal(isSafePosixAskpassPath("/tmp/t3code;rm/ssh-askpass.sh"), false);
      assert.throws(() =>
        Effect.runSync(
          buildSshAskpassHelperDescriptor({
            directory: "/tmp/t3 code",
            platform: "linux",
          }).pipe(Effect.provide(NodeServices.layer)),
        ),
      );
    }),
  );

  it("creates and removes POSIX secret files with private permissions", async () => {
    if (process.platform === "win32") {
      return;
    }

    const directory = await mkdtemp(`${tmpdir()}/t3-ssh-askpass-permissions-`);
    const scriptPath = `${directory}/ssh-askpass.sh`;
    const instrumentedScript = ASKPASS_POSIX_SCRIPT.replace(
      'cat "$secret_file"\n  printf "\\n"',
      'stat -c "%a" "$secret_file" 2>/dev/null || stat -f "%Lp" "$secret_file"\n  cat "$secret_file"\n  printf "\\n"',
    );
    await writeFile(scriptPath, instrumentedScript, { mode: 0o700 });

    const { stdout } = await execFileAsync("/bin/sh", [scriptPath], {
      env: {
        ...process.env,
        TMPDIR: directory,
        T3_SSH_AUTH_SECRET: "super-secret",
      },
    });

    assert.equal(stdout, "600\nsuper-secret\n");
    const leftovers = (await readdir(directory)).filter((entry) =>
      entry.startsWith("t3code-ssh-askpass."),
    );
    assert.deepEqual(leftovers, []);

    const scriptMode = (await stat(scriptPath)).mode & 0o777;
    assert.equal(scriptMode, 0o700);
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
      assert.include(descriptor.files[1]?.contents ?? "", "ConvertTo-SecureString");
      assert.include(descriptor.files[1]?.contents ?? "", "ZeroFreeBSTR");
    }),
  );
});
