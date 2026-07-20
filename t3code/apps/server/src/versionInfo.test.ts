import {
  buildVersionInfo,
  formatDetailedVersion,
  formatShortVersion,
  readVersionFromPackageJson,
} from "./versionInfo.ts";
function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
assert(readVersionFromPackageJson({ version: "0.1.0" }) === "0.1.0", "pkg");
assert(readVersionFromPackageJson(null) === "0.0.0", "fallback");
const info = buildVersionInfo({ version: "0.1.0" });
assert(formatShortVersion(info) === "0.1.0", "short");
const det = formatDetailedVersion(info);
assert(det.includes("t3code v0.1.0"), "detail name");
assert(det.includes(info.platform), "plat");
console.log("versionInfo tests: all passed");
