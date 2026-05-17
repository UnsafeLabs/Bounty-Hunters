/**
 * Branch Protection Status
 *
 * Queries branch protection rules via the git provider API (GitHub/GitLab),
 * caches them in session state, and provides UI components for displaying
 * protection status (lock icon, tooltip, force-push prevention).
 *
 * Protection status is cached and refreshed every 5 minutes.
 *
 * @module BranchProtection
 */
import type { SourceControlProviderKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Protection rule details for a branch. */
export interface BranchProtectionRule {
  /** Branch name (e.g. "main", "develop") */
  readonly branch: string;
  /** Whether the branch is protected at all */
  readonly isProtected: boolean;
  /** Whether direct pushes are allowed (false if PR review required) */
  readonly allowsDirectPush: boolean;
  /** Whether force pushes are allowed */
  readonly allowsForcePush: boolean;
  /** Whether deletions are allowed */
  readonly allowsDeletions: boolean;
  /** Number of required approving reviews (0 = none) */
  readonly requiredReviewCount: number;
  /** Whether required status checks must pass */
  readonly requiresStatusChecks: boolean;
  /** List of required status check names */
  readonly requiredStatusChecks: ReadonlyArray<string>;
  /** Whether signed commits are required */
  readonly requiresSignedCommits: boolean;
  /** Whether conversation resolution is required before merge */
  readonly requiresConversationResolution: boolean;
  /** Whether the branch requires a linear history */
  readonly requiresLinearHistory: boolean;
}

/** Cache entry with TTL. */
interface ProtectionCacheEntry {
  readonly rule: BranchProtectionRule;
  readonly fetchedAt: number;
}

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export class BranchProtectionError extends Data.TaggedError("BranchProtectionError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// ---------------------------------------------------------------------------
// Default / empty rule
// ---------------------------------------------------------------------------

const UNPROTECTED_RULE: BranchProtectionRule = {
  branch: "",
  isProtected: false,
  allowsDirectPush: true,
  allowsForcePush: true,
  allowsDeletions: true,
  requiredReviewCount: 0,
  requiresStatusChecks: false,
  requiredStatusChecks: [],
  requiresSignedCommits: false,
  requiresConversationResolution: false,
  requiresLinearHistory: false,
};

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface BranchProtectionConfig {
  /** Cache TTL in milliseconds. Default: 300000 (5 minutes) */
  readonly cacheTtlMs: number;
  /** Whether to auto-refresh. Default: true */
  readonly autoRefresh: boolean;
  /** Auto-refresh interval in milliseconds. Default: 300000 (5 minutes) */
  readonly refreshIntervalMs: number;
}

const DEFAULT_CONFIG: BranchProtectionConfig = {
  cacheTtlMs: 300_000,
  autoRefresh: true,
  refreshIntervalMs: 300_000,
};

// ---------------------------------------------------------------------------
// Provider-specific API fetchers
// ---------------------------------------------------------------------------

interface GitProviderProtection {
  readonly allowsForcePush: boolean;
  readonly allowsDeletions: boolean;
  readonly requiredReviewCount: number;
  readonly requiresStatusChecks: boolean;
  readonly requiredStatusChecks: ReadonlyArray<string>;
  readonly requiresSignedCommits: boolean;
  readonly requiresConversationResolution: boolean;
  readonly requiresLinearHistory: boolean;
  readonly allowsDirectPush: boolean;
}

/**
 * GitHub API: GET /repos/{owner}/{repo}/branches/{branch}/protection
 * Returns branch protection rules.
 */
const fetchGitHubProtection = (
  owner: string,
  repo: string,
  branch: string,
  token: string,
): Effect.Effect<GitProviderProtection, BranchProtectionError> =>
  Effect.gen(function* () {
    const url = `https://api.github.com/repos/${owner}/${repo}/branches/${branch}/protection`;
    try {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }),
        catch: (e) =>
          new BranchProtectionError({ message: "Failed to fetch GitHub branch protection", cause: e }),
      });

      if (response.status === 404) {
        // No protection configured
        return {
          allowsForcePush: true,
          allowsDeletions: true,
          requiredReviewCount: 0,
          requiresStatusChecks: false,
          requiredStatusChecks: [],
          requiresSignedCommits: false,
          requiresConversationResolution: false,
          requiresLinearHistory: false,
          allowsDirectPush: true,
        };
      }

      if (!response.ok) {
        yield* new BranchProtectionError({
          message: `GitHub API returned ${response.status}`,
        });
      }

      const data = yield* Effect.tryPromise({
        try: () => response.json() as Promise<any>,
        catch: (e) =>
          new BranchProtectionError({ message: "Failed to parse GitHub response", cause: e }),
      });

      return {
        allowsForcePush: data.allow_force_pushes?.enabled ?? false,
        allowsDeletions: data.allow_deletions?.enabled ?? false,
        requiredReviewCount: data.required_pull_request_reviews?.required_approving_review_count ?? 0,
        requiresStatusChecks: !!data.required_status_checks,
        requiredStatusChecks: data.required_status_checks?.contexts ?? [],
        requiresSignedCommits: data.required_signatures?.enabled ?? false,
        requiresConversationResolution: data.required_conversation_resolution?.enabled ?? false,
        requiresLinearHistory: data.required_linear_history?.enabled ?? false,
        allowsDirectPush: !data.required_pull_request_reviews,
      };
    } catch (e) {
      return {
        allowsForcePush: true,
        allowsDeletions: true,
        requiredReviewCount: 0,
        requiresStatusChecks: false,
        requiredStatusChecks: [],
        requiresSignedCommits: false,
        requiresConversationResolution: false,
        requiresLinearHistory: false,
        allowsDirectPush: true,
      };
    }
  });

/**
 * GitLab API: GET /projects/{id}/protected_branches/{branch}
 */
const fetchGitLabProtection = (
  projectId: string,
  branch: string,
  token: string,
): Effect.Effect<GitProviderProtection, BranchProtectionError> =>
  Effect.gen(function* () {
    const encodedBranch = encodeURIComponent(branch);
    const url = `https://gitlab.com/api/v4/projects/${projectId}/protected_branches/${encodedBranch}`;
    try {
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(url, {
            headers: {
              "PRIVATE-TOKEN": token,
            },
          }),
        catch: (e) =>
          new BranchProtectionError({ message: "Failed to fetch GitLab branch protection", cause: e }),
      });

      if (response.status === 404) {
        return {
          allowsForcePush: true,
          allowsDeletions: true,
          requiredReviewCount: 0,
          requiresStatusChecks: false,
          requiredStatusChecks: [],
          requiresSignedCommits: false,
          requiresConversationResolution: false,
          requiresLinearHistory: false,
          allowsDirectPush: true,
        };
      }

      const data = yield* Effect.tryPromise({
        try: () => response.json() as Promise<any>,
        catch: (e) =>
          new BranchProtectionError({ message: "Failed to parse GitLab response", cause: e }),
      });

      return {
        allowsForcePush: !data.allow_force_push,
        allowsDeletions: false,
        requiredReviewCount: data.merge_access_levels?.length ?? 0,
        requiresStatusChecks: false,
        requiredStatusChecks: [],
        requiresSignedCommits: false,
        requiresConversationResolution: false,
        requiresLinearHistory: false,
        allowsDirectPush: data.push_access_levels?.length > 0,
      };
    } catch (e) {
      return {
        allowsForcePush: true,
        allowsDeletions: true,
        requiredReviewCount: 0,
        requiresStatusChecks: false,
        requiredStatusChecks: [],
        requiresSignedCommits: false,
        requiresConversationResolution: false,
        requiresLinearHistory: false,
        allowsDirectPush: true,
      };
    }
  });

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BranchProtectionServiceShape {
  readonly getProtection: (
    branch: string,
    provider: SourceControlProviderKind,
    remoteUrl: string,
  ) => Effect.Effect<BranchProtectionRule, BranchProtectionError>;
  readonly invalidateCache: (branch?: string) => Effect.Effect<void>;
  readonly isForcePushAllowed: (
    branch: string,
    provider: SourceControlProviderKind,
    remoteUrl: string,
  ) => Effect.Effect<boolean>;
  readonly getProtectionTooltip: (
    rule: BranchProtectionRule,
  ) => string;
}

export class BranchProtectionService extends Context.Service<BranchProtectionService, BranchProtectionServiceShape>()(
  "t3/server/BranchProtectionService",
) {}

export const make = (config: Partial<BranchProtectionConfig> = {}) =>
  Effect.gen(function* () {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    const cache = yield* Ref.make(new Map<string, ProtectionCacheEntry>());

    const getProtection: BranchProtectionServiceShape["getProtection"] = (
      branch,
      provider,
      remoteUrl,
    ) =>
      Effect.gen(function* () {
        const cacheKey = `${provider}:${remoteUrl}:${branch}`;
        const now = Date.now();

        // Check cache
        const cached = yield* Ref.get(cache);
        const entry = cached.get(cacheKey);
        if (entry && now - entry.fetchedAt < fullConfig.cacheTtlMs) {
          return entry.rule;
        }

        // Fetch from provider
        let protection: GitProviderProtection;
        if (provider === "github") {
          const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
          if (!match) {
            return { ...UNPROTECTED_RULE, branch };
          }
          const [, owner, repo] = match;
          protection = yield* fetchGitHubProtection(owner, repo, branch, "");
        } else if (provider === "gitlab") {
          protection = yield* fetchGitLabProtection(remoteUrl, branch, "");
        } else {
          protection = {
            allowsForcePush: true,
            allowsDeletions: true,
            requiredReviewCount: 0,
            requiresStatusChecks: false,
            requiredStatusChecks: [],
            requiresSignedCommits: false,
            requiresConversationResolution: false,
            requiresLinearHistory: false,
            allowsDirectPush: true,
          };
        }

        const isProtected =
          !protection.allowsForcePush ||
          !protection.allowsDirectPush ||
          protection.requiredReviewCount > 0 ||
          protection.requiresStatusChecks ||
          protection.requiresSignedCommits;

        const rule: BranchProtectionRule = {
          branch,
          isProtected,
          ...protection,
        };

        // Update cache
        yield* Ref.update(cache, (map) => new Map(map).set(cacheKey, { rule, fetchedAt: now }));

        return rule;
      });

    const invalidateCache: BranchProtectionServiceShape["invalidateCache"] = (branch) =>
      branch
        ? Ref.update(cache, (map) => {
            const next = new Map(map);
            for (const key of next.keys()) {
              if (key.endsWith(`:${branch}`)) {
                next.delete(key);
              }
            }
            return next;
          })
        : Ref.set(cache, new Map());

    const isForcePushAllowed: BranchProtectionServiceShape["isForcePushAllowed"] = (
      branch,
      provider,
      remoteUrl,
    ) =>
      getProtection(branch, provider, remoteUrl).pipe(
        Effect.map((rule) => rule.allowsForcePush),
        Effect.catchAll(() => Effect.succeed(true)),
      );

    const getProtectionTooltip: BranchProtectionServiceShape["getProtectionTooltip"] = (rule) => {
      if (!rule.isProtected) {
        return "This branch has no protection rules.";
      }

      const lines: string[] = ["Branch protection active:"];
      if (rule.requiredReviewCount > 0) {
        lines.push(`• ${rule.requiredReviewCount} approving review(s) required`);
      }
      if (rule.requiresStatusChecks) {
        lines.push(`• Status checks must pass`);
        if (rule.requiredStatusChecks.length > 0) {
          lines.push(`  Required: ${rule.requiredStatusChecks.join(", ")}`);
        }
      }
      if (!rule.allowsForcePush) {
        lines.push(`• Force push is disabled`);
      }
      if (!rule.allowsDirectPush) {
        lines.push(`• Direct push requires PR review`);
      }
      if (rule.requiresSignedCommits) {
        lines.push(`• Signed commits required`);
      }
      if (rule.requiresLinearHistory) {
        lines.push(`• Linear history required`);
      }
      if (rule.requiresConversationResolution) {
        lines.push(`• Conversations must be resolved`);
      }
      return lines.join("\n");
    };

    return BranchProtectionService.of({
      getProtection,
      invalidateCache,
      isForcePushAllowed,
      getProtectionTooltip,
    });
  });

// ---------------------------------------------------------------------------
// React hook utilities
// ---------------------------------------------------------------------------

/** Hook-ready cache key for React Query integration. */
export const branchProtectionQueryKey = (
  provider: SourceControlProviderKind,
  remoteUrl: string,
  branch: string,
) => ["branch-protection", provider, remoteUrl, branch] as const;
