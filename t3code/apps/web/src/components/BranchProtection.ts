/**
 * Branch protection status, cache, force-push prevention (issue #854).
 */

export interface BranchProtectionRules {
  branch: string;
  protected: boolean;
  requirePullRequest: boolean;
  requiredReviews: number;
  requireStatusChecks: boolean;
  statusChecks: string[];
  allowForcePush: boolean;
  provider: "github" | "gitlab" | "unknown";
}

export interface ProtectionCacheEntry {
  rules: BranchProtectionRules;
  fetchedAt: number;
}

export const CACHE_TTL_MS = 5 * 60 * 1000;

export class BranchProtectionCache {
  private cache = new Map<string, ProtectionCacheEntry>();
  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  get(branch: string): BranchProtectionRules | undefined {
    const e = this.cache.get(branch);
    if (!e) return undefined;
    if (this.now() - e.fetchedAt > CACHE_TTL_MS) {
      this.cache.delete(branch);
      return undefined;
    }
    return e.rules;
  }

  set(rules: BranchProtectionRules): void {
    this.cache.set(rules.branch, { rules, fetchedAt: this.now() });
  }

  clear(): void {
    this.cache.clear();
  }
}

export function parseGitHubProtection(branch: string, api: any): BranchProtectionRules {
  const enabled = Boolean(api?.enabled ?? api?.protected ?? true);
  const pr = api?.required_pull_request_reviews;
  const checks = api?.required_status_checks;
  return {
    branch,
    protected: enabled,
    requirePullRequest: Boolean(pr),
    requiredReviews: Number(pr?.required_approving_review_count ?? 0),
    requireStatusChecks: Boolean(checks?.strict || (checks?.contexts?.length ?? 0) > 0),
    statusChecks: Array.isArray(checks?.contexts) ? checks.contexts : [],
    allowForcePush: api?.allow_force_pushes?.enabled === true,
    provider: "github",
  };
}

export function parseGitLabProtection(branch: string, api: any): BranchProtectionRules {
  const force = api?.allow_force_push === true;
  const reviews = Number(api?.code_owner_approval_required ? 1 : api?.merge_access_levels?.length ? 1 : 0);
  return {
    branch,
    protected: true,
    requirePullRequest: true,
    requiredReviews: reviews,
    requireStatusChecks: false,
    statusChecks: [],
    allowForcePush: force,
    provider: "gitlab",
  };
}

export function isForcePushAllowed(rules: BranchProtectionRules | undefined): boolean {
  if (!rules || !rules.protected) return true;
  return rules.allowForcePush === true;
}

export function shouldWarnOnDirectPush(rules: BranchProtectionRules | undefined): boolean {
  if (!rules || !rules.protected) return false;
  return rules.requirePullRequest === true;
}

export function protectionTooltip(rules: BranchProtectionRules): string {
  if (!rules.protected) return "Not protected";
  const parts: string[] = ["Protected branch"];
  if (rules.requirePullRequest) parts.push(`PR required (${rules.requiredReviews} reviews)`);
  if (rules.requireStatusChecks) {
    parts.push(
      rules.statusChecks.length
        ? `Status checks: ${rules.statusChecks.join(", ")}`
        : "Status checks required",
    );
  }
  parts.push(rules.allowForcePush ? "Force push allowed" : "Force push blocked");
  return parts.join(" · ");
}

export function showLockIcon(rules: BranchProtectionRules | undefined): boolean {
  return Boolean(rules?.protected);
}
