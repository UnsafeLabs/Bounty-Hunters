/**
 * Version command and --version flag for CLI.
 * Adds version info to the CLI entry point.
 */

import { readFileSync } from "fs";
import { join } from "path";

interface VersionInfo {
  version: string;
  buildDate: string;
  gitHash?: string;
  nodeVersion: string;
}

/**
 * Get version information from package.json and build metadata.
 */
export function getVersionInfo(): VersionInfo {
  let version = "unknown";
  let buildDate = "unknown";

  try {
    const pkgPath = join(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    version = pkg.version || "unknown";
  } catch {
    // Fallback
  }

  try {
    const buildPath = join(__dirname, "../build-info.json");
    const build = JSON.parse(readFileSync(buildPath, "utf-8"));
    buildDate = build.date || "unknown";
  } catch {
    buildDate = new Date().toISOString();
  }

  return {
    version,
    buildDate,
    gitHash: process.env.GIT_HASH,
    nodeVersion: process.version,
  };
}

/**
 * Format version string for display.
 */
export function formatVersion(info?: VersionInfo): string {
  const v = info || getVersionInfo();
  let str = `t3code v${v.version}`;
  if (v.gitHash) str += ` (${v.gitHash.slice(0, 7)})`;
  str += `\nNode ${v.nodeVersion}`;
  str += `\nBuilt ${v.buildDate}`;
  return str;
}

/**
 * Register version command with a CLI framework.
 */
export function registerVersionCommand(program: any): void {
  program
    .command("version")
    .alias("v")
    .description("Show version information")
    .action(() => {
      console.log(formatVersion());
    });

  // Also handle --version flag
  program.option("-v, --version", "Output the version number");
}
