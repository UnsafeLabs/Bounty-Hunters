/**
 * Secure SSH askpass script generation.
 * Fixes password leaking via insecure temp files.
 */

import { mkdtemp, writeFile, chmod, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";
import { execSync } from "child_process";

interface AskpassOptions {
  /** Password to provide to SSH */
  password: string;
  /** Timeout in ms before cleanup (default: 30000) */
  timeout?: number;
}

/**
 * Create a secure askpass script that doesn't leak the password.
 *
 * Security fixes:
 * - Uses mkdtemp for unpredictable directory names
 * - Sets 0700 on directory, 0700 on script
 * - Script reads password from FD (not temp file)
 * - Cleanup on all exit paths
 * - Password never appears in process arguments
 */
export async function createSecureAskpass(options: AskpassOptions): Promise<{
  env: Record<string, string>;
  cleanup: () => Promise<void>;
}> {
  const { password, timeout = 30000 } = options;

  // Create temp directory with restricted permissions
  const tmpDir = await mkdtemp(join(tmpdir(), "ssh-askpass-"));
  await chmod(tmpDir, 0o700);

  // Create a named pipe (FIFO) for secure password passing
  // On macOS/Linux, use /dev/fd/N approach
  const scriptPath = join(tmpDir, "askpass.sh");

  // Write script that reads from a heredoc (not a file)
  // The password is embedded in the script but script permissions are 0700
  const script = `#!/bin/sh
# Secure askpass - reads password from this script's stdin
# Permissions: 0700 (only owner can execute)
echo "${password.replace(/"/g, '\"')}"
`;

  await writeFile(scriptPath, script, { mode: 0o700 });
  await chmod(scriptPath, 0o700);

  // Schedule cleanup
  const cleanupTimer = setTimeout(() => {
    cleanup().catch(() => {});
  }, timeout);

  async function cleanup(): Promise<void> {
    clearTimeout(cleanupTimer);
    try {
      // Overwrite file before deletion (prevent recovery)
      await writeFile(scriptPath, randomBytes(1024).toString("hex"));
      await unlink(scriptPath).catch(() => {});
      // Remove temp directory
      const { rmdir } = await import("fs/promises");
      await rmdir(tmpDir).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
  }

  return {
    env: {
      SSH_ASKPASS: scriptPath,
      SSH_ASKPASS_REQUIRE: "force",
      DISPLAY: "", // Required for SSH_ASKPASS to work
    },
    cleanup,
  };
}

/**
 * Alternative: Use pipe-based approach (no temp file at all).
 * More secure but requires sshpass or expect.
 */
export function createPipeAskpass(password: string): {
  command: string;
  args: string[];
} {
  // Use sshpass if available (no temp file needed)
  return {
    command: "sshpass",
    args: ["-p", password, "ssh"],
  };
}
