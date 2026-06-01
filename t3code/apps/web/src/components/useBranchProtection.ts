/**
 * Branch protection status display and force-push prevention.
 */

interface BranchProtection {
  branch: string;
  protected: boolean;
  requiredReviews: number;
  requiresStatusChecks: boolean;
  allowsForcePush: boolean;
  allowsDeletion: boolean;
}

export function useBranchProtection(repoPath: string) {
  function getProtectionStatus(branch: string): BranchProtection {
    try {
      const { execSync } = require("child_process");

      // Check if branch is protected
      const isProtected = (() => {
        try {
          execSync(`git config --get branch.${branch}.protected`, { cwd: repoPath, stdio: "pipe" });
          return true;
        } catch {
          return false;
        }
      })();

      // Check remote protection rules
      const remoteRules = (() => {
        try {
          const output = execSync(`gh api repos/:owner/:repo/branches/${branch}/protection --jq '.required_pull_request_reviews.required_approving_review_count' 2>/dev/null`, {
            cwd: repoPath, encoding: "utf-8"
          });
          return parseInt(output.trim()) || 0;
        } catch {
          return 0;
        }
      })();

      return {
        branch,
        protected: isProtected || remoteRules > 0,
        requiredReviews: remoteRules,
        requiresStatusChecks: false,
        allowsForcePush: !isProtected,
        allowsDeletion: !isProtected,
      };
    } catch {
      return {
        branch,
        protected: false,
        requiredReviews: 0,
        requiresStatusChecks: false,
        allowsForcePush: true,
        allowsDeletion: true,
      };
    }
  }

  function preventForcePush(branch: string): boolean {
    const protection = getProtectionStatus(branch);
    return protection.protected && !protection.allowsForcePush;
  }

  return { getProtectionStatus, preventForcePush };
}
