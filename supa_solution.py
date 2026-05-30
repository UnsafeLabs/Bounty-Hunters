```typescript
import { GitService } from './git.service';
import * as childProcess from 'child_process';

class GitService {
  private gitManager: GitManager;

  constructor(gitManager: GitManager) {
    this.gitManager = gitManager;
  }

  async exec(command: string[]) {
    try {
      const output = await this.getConflictFiles();
      if (output.length > 0) {
        this.gitManager.rpcEmitter.emit('rebase.conflicts', output);
      }
      await this.gitManager.gitCommand(command);
    } catch (error) {
      if (error.code === 'EAIAGET') {
        const conflictHead = childProcess.execSync('git show --format=%H .git/REBASE_HEAD').toString().trim();
        throw error;
      } else {
        console.error(`Error executing Git command: ${error.message}`);
        throw error;
      }
    }
  }

  async getConflictFiles() {
    try {
      const output = await new Promise((resolve, reject) => {
        childProcess.execSync('git diff --name-only --diff-filter=U', (error, data) => {
          if (error) {
            reject(error);
          } else {
            resolve(data.toString().split('\n').filter(Boolean));
          }
        });
      });

      const conflictFiles = output.filter((file) => file.startsWith('.'));
      return conflictFiles;
    } catch (error) {
      console.error(`Error getting conflict files: ${error.message}`);
      throw error;
    }
  }

  async detectRebaseConflicts() {
    try {
      if (!this.gitManager.isRebase()) {
        return [];
      }

      const conflictHead = await new Promise((resolve, reject) => {
        childProcess.execSync('git show --format=%H .git/REBASE_HEAD', (error, data) => {
          if (error) {
            reject(error);
          } else {
            resolve(data.toString().trim());
          }
        });
      });

      const conflictedFiles = await this.getConflictFiles();
      return conflictedFiles;
    } catch (error) {
      console.error(`Error detecting rebase conflicts: ${error.message}`);
      throw error;
    }
  }

  async resolveRebaseConflicts(conflictFiles: string[]) {
    try {
      for (const file of conflictFiles) {
        await this.gitManager.gitCommand(['co', '--ours', `HEAD:${file}`]);
        await new Promise((resolve, reject) => {
          childProcess.execSync(`git apply --cached ${file}`, { stdio: 'ignore' }, (error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });

        const output = await this.getConflictFiles();
        conflictFiles = output.filter((f) => f !== file);
      }

      return conflictFiles;
    } catch (error) {
      console.error(`Error resolving rebase conflicts: ${error.message}`);
      throw error;
    }
  }
}

export { GitService };
```