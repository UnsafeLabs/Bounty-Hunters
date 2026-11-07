/**
 * BranchProtectionService - Branch protection status display and force-push prevention.
 *
 * Queries GitHub/GitLab APIs for branch protection rules and caches results
 * with a 5-minute TTL. Provides protection status for UI display and
 * force-push gating.
 *
 * @module BranchProtectionService
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

export const BranchProtectionRule = Schema.Struct({
  requiredReviews: Schema.Number,
  dismissStaleReviews: Schema.Boolean,
  requireCodeOwnerReviews: Schema.Boolean,
  requiredStatusChecks: Schema.Array(Schema.String),
  requireStrictStatusChecks: Schema.Boolean,
  requireLinearHistory: Schema.Boolean,
  allowForcePushes: Schema.Boolean,
  allowDeletions: Schema.Boolean,
  requiredConversationResolution: Schema.Boolean,
  lockedBranch: Schema.Boolean,
});
export type BranchProtectionRule = typeof BranchProtectionRule.Type;

export interface BranchProtectionStatus {
  readonly branch: string;
  readonly isProtected: boolean;
  readonly rule: Option.Option<BranchProtectionRule>;
  readonly fetchedAt: string;
  readonly provider: "github" | "gitlab" | "unknown";
}

export interface BranchProtectionServiceShape {
  readonly getProtection: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly provider: "github" | "gitlab";
    readonly token?: string;
  }) => Effect.Effect<BranchProtectionStatus>;
  readonly isProtected: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly provider: "github" | "gitlab";
    readonly token?: string;
  }) => Effect.Effect<boolean>;
  readonly canForcePush: (input: {
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
    readonly provider: "github" | "gitlab";
    readonly token?: string;
  }) => Effect.Effect<boolean>;
  readonly clearCache: () => Effect.Effect<void>;
}

export class BranchProtectionService extends Context.Service<
  BranchProtectionService,
  BranchProtectionServiceShape
>()("t3/sourceControl/BranchProtectionService") {}

const CACHE_TTL = Duration.minutes(5);

interface CacheEntry {
  status: BranchProtectionStatus;
  expiresAt: number;
}

const cacheKey = (owner: string, repo: string, branch: string): string =>
  `${owner}/${repo}:${branch}`;

const defaultProtectionRule: BranchProtectionRule = {
  requiredReviews: 0,
  dismissStaleReviews: false,
  requireCodeOwnerReviews: false,
  requiredStatusChecks: [],
  requireStrictStatusChecks: false,
  requireLinearHistory: false,
  allowForcePushes: false,
  allowDeletions: false,
  requiredConversationResolution: false,
  lockedBranch: false,
};

const parseGitHubProtection = (data: any): BranchProtectionRule => ({
  requiredReviews: data.required_pull_request_reviews?.required_approving_review_count ?? 0,
  dismissStaleReviews: data.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
  requireCodeOwnerReviews: data.required_pull_request_reviews?.require_code_owner_reviews ?? false,
  requiredStatusChecks: data.required_status_checks?.contexts ?? [],
  requireStrictStatusChecks: data.required_status_checks?.strict ?? false,
  requireLinearHistory: data.required_linear_history?.enabled ?? false,
  allowForcePushes: data.allow_force_pushes?.enabled ?? false,
  allowDeletions: data.allow_deletions?.enabled ?? false,
  requiredConversationResolution: data.required_conversation_resolution?.enabled ?? false,
  lockedBranch: data.lock_branch?.enabled ?? false,
});

const parseGitLabProtection = (data: any): BranchProtectionRule => ({
  requiredReviews: data.merge_access_levels?.length ?? 0,
  dismissStaleReviews: false,
  requireCodeOwnerReviews: data.code_owner_approval_required ?? false,
  requiredStatusChecks: [],
  requireStrictStatusChecks: false,
  requireLinearHistory: false,
  allowForcePushes: data.push_access_levels?.some((l: any) => l.access_level >= 40) ?? false,
  allowDeletions: false,
  requiredConversationResolution: false,
  lockedBranch: data.allow_force_push === false,
});

const fetchGitHubProtection = Effect.fn("BranchProtection.fetchGitHub")(function* (input: {
  owner: string;
  repo: string;
  branch: string;
  token?: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const url = `https://api.github.com/repos/${input.owner}/${input.repo}/branches/${input.branch}/protection`;

  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.acceptJson,
    ...(input.token ? [HttpClientRequest.bearerToken(input.token)] : []),
    ...(input.token ? [] : [HttpClientRequest.header("Accept", "application/vnd.github.v3+json")]),
  );

  const response = yield* httpClient.execute(request);
  const body = yield* response.json;

  if (response.status === 200 && body && typeof body === "object" && "url" in body) {
    return Option.some(parseGitHubProtection(body));
  }
  return Option.none<BranchProtectionRule>();
});

const fetchGitLabProtection = Effect.fn("BranchProtection.fetchGitLab")(function* (input: {
  owner: string;
  repo: string;
  branch: string;
  token?: string;
}) {
  const httpClient = yield* HttpClient.HttpClient;
  const projectPath = encodeURIComponent(`${input.owner}/${input.repo}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}/protected_branches/${encodeURIComponent(input.branch)}`;

  const request = HttpClientRequest.get(url).pipe(
    HttpClientRequest.acceptJson,
    ...(input.token ? [HttpClientRequest.bearerToken(input.token)] : []),
  );

  const response = yield* httpClient.execute(request);
  const body = yield* response.json;

  if (response.status === 200 && body && typeof body === "object" && "name" in body) {
    return Option.some(parseGitLabProtection(body));
  }
  return Option.none<BranchProtectionRule>();
});

const makeLive = Effect.gen(function* () {
  const cacheRef = yield* Ref.make<Map<string, CacheEntry>>(new Map());

  const getFromCache = (key: string): Option.Option<BranchProtectionStatus> => {
    const now = Date.now();
    let cachedEntry: CacheEntry | undefined;
    const cache = new Map();

    return Effect.runSync(
      Ref.get(cacheRef).pipe(
        Effect.map((c) => {
          const entry = c.get(key);
          if (entry && entry.expiresAt > now) {
            return Option.some(entry.status);
          }
          return Option.none<BranchProtectionStatus>();
        }),
      ),
    );
  };

  const setCache = (key: string, status: BranchProtectionStatus) =>
    Ref.update(cacheRef, (cache) => {
      const next = new Map(cache);
      next.set(key, {
        status,
        expiresAt: Date.now() + CACHE_TTL.pipe(Duration.toMillis),
      });
      return next;
    });

  const getProtection = Effect.fn("BranchProtectionService.getProtection")(function* (input: {
    owner: string;
    repo: string;
    branch: string;
    provider: "github" | "gitlab";
    token?: string;
  }) {
    const key = cacheKey(input.owner, input.repo, input.branch);
    const cached = yield* Ref.get(cacheRef).pipe(
      Effect.map((cache) => {
        const entry = cache.get(key);
        if (entry && entry.expiresAt > Date.now()) {
          return Option.some(entry.status);
        }
        return Option.none<BranchProtectionStatus>();
      }),
    );

    if (Option.isSome(cached)) {
      return cached.value;
    }

    const fetchResult = yield* Effect.either(
      input.provider === "github"
        ? fetchGitHubProtection(input)
        : fetchGitLabProtection(input),
    );

    const rule = fetchResult._tag === "Right" ? fetchResult.right : Option.none<BranchProtectionRule>();
    const now = DateTime.formatIso(yield* DateTime.now);

    const status: BranchProtectionStatus = {
      branch: input.branch,
      isProtected: Option.isSome(rule),
      rule,
      fetchedAt: now,
      provider: input.provider,
    };

    yield* setCache(key, status);
    return status;
  });

  const isProtected = (input: {
    owner: string;
    repo: string;
    branch: string;
    provider: "github" | "gitlab";
    token?: string;
  }) =>
    getProtection(input).pipe(Effect.map((status) => status.isProtected));

  const canForcePush = (input: {
    owner: string;
    repo: string;
    branch: string;
    provider: "github" | "gitlab";
    token?: string;
  }) =>
    getProtection(input).pipe(
      Effect.map((status) => {
        if (!status.isProtected) return true;
        if (Option.isNone(status.rule)) return true;
        return !status.rule.value.lockedBranch && status.rule.value.allowForcePushes;
      }),
    );

  const clearCache = Ref.set(cacheRef, new Map());

  return {
    getProtection,
    isProtected,
    canForcePush,
    clearCache,
  } satisfies BranchProtectionServiceShape;
});

export const BranchProtectionServiceLive = Layer.effect(BranchProtectionService, makeLive);
