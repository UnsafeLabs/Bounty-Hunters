/**
 * CLI version formatting (issue 821).
 */

export interface VersionInfo {
  version: string;
  runtime: string;
  runtimeVersion: string;
  platform: string;
  arch: string;
}

export function readVersionFromPackageJson(pkg: { version?: string } | null): string {
  return pkg?.version ?? "0.0.0";
}

export function detectRuntime(): { runtime: string; runtimeVersion: string } {
  const bun = (globalThis as any).Bun;
  if (bun?.version) return { runtime: "bun", runtimeVersion: String(bun.version) };
  if (typeof process !== "undefined" && process.versions?.node) {
    return { runtime: "node", runtimeVersion: process.versions.node };
  }
  return { runtime: "unknown", runtimeVersion: "unknown" };
}

export function buildVersionInfo(pkg: { version?: string } | null): VersionInfo {
  const { runtime, runtimeVersion } = detectRuntime();
  return {
    version: readVersionFromPackageJson(pkg),
    runtime,
    runtimeVersion,
    platform: typeof process !== "undefined" ? process.platform : "unknown",
    arch: typeof process !== "undefined" ? process.arch : "unknown",
  };
}

export function formatShortVersion(info: VersionInfo): string {
  return info.version;
}

export function formatDetailedVersion(info: VersionInfo, appName = "t3code"): string {
  return `${appName} v${info.version} (${info.runtime} ${info.runtimeVersion}, ${info.platform} ${info.arch})`;
}
