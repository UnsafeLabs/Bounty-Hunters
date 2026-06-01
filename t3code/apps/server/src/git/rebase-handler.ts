/**
 * Rebase conflict detection and resolution for GitManager.
 * Detects conflicts during rebase and provides resolution strategies.
 */

import { execSync } from "child_process";

interface ConflictInfo {
  file: string;
  type: "both-modified" | "both-added" | "deleted-modified" | "modified-deleted";
  markers: { start: number; end: number }[];
}

interface RebaseResult {
  success: boolean;
  conflicts: ConflictInfo[];
  message: string;
}

export class RebaseConflictHandler {
  private workDir: string;

  constructor(workDir: string) {
    this.workDir = workDir;
  }

  /**
   * Detect if a rebase is in progress.
   */
  isRebasing(): boolean {
    try {
      execSync("git rev-parse --verify REBASE_HEAD", { cwd: this.workDir, stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of conflicted files.
   */
  getConflicts(): ConflictInfo[] {
    try {
      const output = execSync("git diff --name-only --diff-filter=U", {
        cwd: this.workDir, encoding: "utf-8"
      }).trim();

      if (!output) return [];

      return output.split("\n").map((file) => {
        const markers = this.findConflictMarkers(file);
        return {
          file,
          type: this.getConflictType(file),
          markers,
        };
      });
    } catch {
      return [];
    }
  }

  /**
   * Find conflict markers in a file.
   */
  private findConflictMarkers(file: string): { start: number; end: number }[] {
    try {
      const content = execSync(`cat "${file}"`, {
        cwd: this.workDir, encoding: "utf-8"
      });

      const markers: { start: number; end: number }[] = [];
      const lines = content.split("\n");
      let start = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith("<<<<<<<")) {
          start = i;
        } else if (lines[i].startsWith(">>>>>>>)") && start >= 0) {
          markers.push({ start, end: i });
          start = -1;
        }
      }

      return markers;
    } catch {
      return [];
    }
  }

  /**
   * Get conflict type from git status.
   */
  private getConflictType(file: string): ConflictInfo["type"] {
    try {
      const status = execSync(`git status --porcelain "${file}"`, {
        cwd: this.workDir, encoding: "utf-8"
      }).trim();

      if (status.startsWith("UU")) return "both-modified";
      if (status.startsWith("AA")) return "both-added";
      if (status.startsWith("DU")) return "deleted-modified";
      if (status.startsWith("UD")) return "modified-deleted";
      return "both-modified";
    } catch {
      return "both-modified";
    }
  }

  /**
   * Abort the current rebase.
   */
  abort(): void {
    execSync("git rebase --abort", { cwd: this.workDir });
  }

  /**
   * Skip the current commit.
   */
  skip(): void {
    execSync("git rebase --skip", { cwd: this.workDir });
  }

  /**
   * Continue rebase after resolving conflicts.
   */
  continue(): RebaseResult {
    try {
      execSync("git rebase --continue", { cwd: this.workDir, stdio: "pipe" });
      return { success: true, conflicts: [], message: "Rebase completed" };
    } catch (error: any) {
      const conflicts = this.getConflicts();
      return {
        success: false,
        conflicts,
        message: error.message || "Rebase still has conflicts",
      };
    }
  }
}
