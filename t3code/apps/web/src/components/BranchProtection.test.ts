import { describe, expect, it } from "vitest";

import {
  type BranchProtectionRule,
  type BranchProtectionConfig,
  DEFAULT_CONFIG,
  branchProtectionQueryKey,
} from "./BranchProtection.ts";

describe("BranchProtection", () => {
  describe("config", () => {
    it("has sensible defaults", () => {
      expect(DEFAULT_CONFIG.cacheTtlMs).toBe(300_000);
      expect(DEFAULT_CONFIG.autoRefresh).toBe(true);
      expect(DEFAULT_CONFIG.refreshIntervalMs).toBe(300_000);
    });

    it("allows partial overrides", () => {
      const custom: Partial<BranchProtectionConfig> = {
        cacheTtlMs: 60_000,
        autoRefresh: false,
      };
      const merged = { ...DEFAULT_CONFIG, ...custom };
      expect(merged.cacheTtlMs).toBe(60_000);
      expect(merged.autoRefresh).toBe(false);
      expect(merged.refreshIntervalMs).toBe(300_000);
    });
  });

  describe("BranchProtectionRule", () => {
    it("unprotected rule has all access allowed", () => {
      const rule: BranchProtectionRule = {
        branch: "feature/test",
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

      expect(rule.isProtected).toBe(false);
      expect(rule.allowsForcePush).toBe(true);
      expect(rule.allowsDirectPush).toBe(true);
    });

    it("protected rule blocks force push", () => {
      const rule: BranchProtectionRule = {
        branch: "main",
        isProtected: true,
        allowsDirectPush: false,
        allowsForcePush: false,
        allowsDeletions: false,
        requiredReviewCount: 2,
        requiresStatusChecks: true,
        requiredStatusChecks: ["ci/test", "ci/lint"],
        requiresSignedCommits: true,
        requiresConversationResolution: true,
        requiresLinearHistory: false,
      };

      expect(rule.isProtected).toBe(true);
      expect(rule.allowsForcePush).toBe(false);
      expect(rule.requiredReviewCount).toBe(2);
      expect(rule.requiredStatusChecks).toEqual(["ci/test", "ci/lint"]);
    });
  });

  describe("branchProtectionQueryKey", () => {
    it("generates stable query keys", () => {
      const key1 = branchProtectionQueryKey("github", "https://github.com/org/repo", "main");
      const key2 = branchProtectionQueryKey("github", "https://github.com/org/repo", "main");

      expect(key1).toEqual(key2);
      expect(key1).toEqual(["branch-protection", "github", "https://github.com/org/repo", "main"]);
    });

    it("different branches produce different keys", () => {
      const key1 = branchProtectionQueryKey("github", "https://github.com/org/repo", "main");
      const key2 = branchProtectionQueryKey("github", "https://github.com/org/repo", "develop");

      expect(key1).not.toEqual(key2);
    });

    it("different providers produce different keys", () => {
      const key1 = branchProtectionQueryKey("github", "https://github.com/org/repo", "main");
      const key2 = branchProtectionQueryKey("gitlab", "https://gitlab.com/org/repo", "main");

      expect(key1).not.toEqual(key2);
    });
  });

  describe("tooltip generation", () => {
    const getProtectionTooltip = (rule: BranchProtectionRule): string => {
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
      return lines.join("\n");
    };

    it("shows no protection message for unprotected branches", () => {
      const rule: BranchProtectionRule = {
        branch: "feature/x",
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
      expect(getProtectionTooltip(rule)).toBe("This branch has no protection rules.");
    });

    it("lists all active protections", () => {
      const rule: BranchProtectionRule = {
        branch: "main",
        isProtected: true,
        allowsDirectPush: false,
        allowsForcePush: false,
        allowsDeletions: false,
        requiredReviewCount: 2,
        requiresStatusChecks: true,
        requiredStatusChecks: ["ci/test"],
        requiresSignedCommits: true,
        requiresConversationResolution: false,
        requiresLinearHistory: false,
      };
      const tooltip = getProtectionTooltip(rule);
      expect(tooltip).toContain("2 approving review(s) required");
      expect(tooltip).toContain("Status checks must pass");
      expect(tooltip).toContain("Force push is disabled");
      expect(tooltip).toContain("Direct push requires PR review");
    });
  });
});
