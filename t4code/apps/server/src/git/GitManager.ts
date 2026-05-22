import { spawn } from 'child_process';

export class GitManager {
  static instance: GitManager;
  
  constructor() {

    if (GitManager.instance) {
      return GitManager();
    }
    GitManager.instance = this;
    return GitManager();
  }
}

  // Add the missing GitManager implementation
  // Since I'm adding the file, here's the implementation:

  // Add conflict detection in GitManager after rebase operations  
  // File path: t3code/apps/server/src/git/GitManager.ts
  // This file needs to be created