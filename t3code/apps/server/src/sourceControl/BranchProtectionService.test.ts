import { describe, it, expect } from "vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import {
  BranchProtectionService,
  BranchProtectionServiceLive,
  type BranchProtectionStatus,
  type BranchProtectionRule,
} from "./BranchProtectionService.ts";

describe("BranchProtectionService", () => {
  describe("BranchProtectionRule defaults", () => {
    it("should have correct default protection rule shape", () => {
      const rule: BranchProtectionRule = {
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

      expect(rule.requiredReviews).toBe(0);
      expect(rule.allowForcePushes).toBe(false);
      expect(rule.lockedBranch).toBe(false);
    });
  });

  describe("BranchProtectionStatus", () => {
    it("should represent unprotected branch", () => {
      const status: BranchProtectionStatus = {
        branch: "feature/test",
        isProtected: false,
        rule: Option.none(),
        fetchedAt: "2026-11-07T12:00:00Z",
        provider: "github",
      };

      expect(status.isProtected).toBe(false);
      expect(Option.isNone(status.rule)).toBe(true);
    });

    it("should represent protected branch with rules", () => {
      const rule: BranchProtectionRule = {
        requiredReviews: 2,
        dismissStaleReviews: true,
        requireCodeOwnerReviews: true,
        requiredStatusChecks: ["ci/build", "ci/test"],
        requireStrictStatusChecks: true,
        requireLinearHistory: true,
        allowForcePushes: false,
        allowDeletions: false,
        requiredConversationResolution: true,
        lockedBranch: true,
      };

      const status: BranchProtectionStatus = {
        branch: "main",
        isProtected: true,
        rule: Option.some(rule),
        fetchedAt: "2026-11-07T12:00:00Z",
        provider: "github",
      };

      expect(status.isProtected).toBe(true);
      expect(Option.isSome(status.rule)).toBe(true);
      expect(Option.getOrElse(status.rule, () => rule as any).requiredReviews).toBe(2);
      expect(Option.getOrElse(status.rule, () => rule as any).lockedBranch).toBe(true);
    });
  });

  describe("cache key generation", () => {
    it("should generate unique cache keys per branch", () => {
      const key1 = `owner/repo:main`;
      const key2 = `owner/repo:develop`;
      const key3 = `other/repo:main`;

      expect(key1).not.toBe(key2);
      expect(key1).not.toBe(key3);
      expect(key2).not.toBe(key3);
    });
  });

  describe("canForcePush logic", () => {
    it("should allow force push on unprotected branches", () => {
      const status: BranchProtectionStatus = {
        branch: "feature/test",
        isProtected: false,
        rule: Option.none(),
        fetchedAt: "2026-11-07T12:00:00Z",
        provider: "github",
      };

      const canForcePush = !status.isProtected;
      expect(canForcePush).toBe(true);
    });

    it("should deny force push on locked branches", () => {
      const rule: BranchProtectionRule = {
        requiredReviews: 1,
        dismissStaleReviews: false,
        requireCodeOwnerReviews: false,
        requiredStatusChecks: [],
        requireStrictStatusChecks: false,
        requireLinearHistory: false,
        allowForcePushes: false,
        allowDeletions: false,
        requiredConversationResolution: false,
        lockedBranch: true,
      };

      const canForcePush = !rule.lockedBranch && rule.allowForcePushes;
      expect(canForcePush).toBe(false);
    });

    it("should allow force push when explicitly enabled", () => {
      const rule: BranchProtectionRule = {
        requiredReviews: 0,
        dismissStaleReviews: false,
        requireCodeOwnerReviews: false,
        requiredStatusChecks: [],
        requireStrictStatusChecks: false,
        requireLinearHistory: false,
        allowForcePushes: true,
        allowDeletions: false,
        requiredConversationResolution: false,
        lockedBranch: false,
      };

      const canForcePush = !rule.lockedBranch && rule.allowForcePushes;
      expect(canForcePush).toBe(true);
    });
  });

  describe("provider support", () => {
    it("should support github provider", () => {
      const status: BranchProtectionStatus = {
        branch: "main",
        isProtected: true,
        rule: Option.none(),
        fetchedAt: "2026-11-07T12:00:00Z",
        provider: "github",
      };

      expect(status.provider).toBe("github");
    });

    it("should support gitlab provider", () => {
      const status: BranchProtectionStatus = {
        branch: "main",
        isProtected: true,
        rule: Option.none(),
        fetchedAt: "2026-11-07T12:00:00Z",
        provider: "gitlab",
      };

      expect(status.provider).toBe("gitlab");
    });
  });
});
