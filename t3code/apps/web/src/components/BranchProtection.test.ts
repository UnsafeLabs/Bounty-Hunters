import {
  BranchProtectionCache,
  CACHE_TTL_MS,
  isForcePushAllowed,
  parseGitHubProtection,
  parseGitLabProtection,
  protectionTooltip,
  shouldWarnOnDirectPush,
  showLockIcon,
} from "./BranchProtection.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

const gh = parseGitHubProtection("main", {
  enabled: true,
  required_pull_request_reviews: { required_approving_review_count: 2 },
  required_status_checks: { strict: true, contexts: ["ci"] },
  allow_force_pushes: { enabled: false },
});
assert(gh.protected && gh.requiredReviews === 2, "gh parse");
assert(isForcePushAllowed(gh) === false, "force disabled");
assert(shouldWarnOnDirectPush(gh) === true, "warn PR");
assert(showLockIcon(gh) === true, "lock");
assert(protectionTooltip(gh).includes("2 reviews"), "tooltip");

const gl = parseGitLabProtection("main", { allow_force_push: false, code_owner_approval_required: true });
assert(gl.provider === "gitlab" && isForcePushAllowed(gl) === false, "gl");

assert(isForcePushAllowed(undefined) === true, "unprotected force ok");
assert(showLockIcon(undefined) === false, "no lock");

let t = 1_000_000;
const cache = new BranchProtectionCache(() => t);
cache.set(gh);
assert(cache.get("main")?.branch === "main", "cached");
t += CACHE_TTL_MS + 1;
assert(cache.get("main") === undefined, "expired");

console.log("BranchProtection tests: all passed");
