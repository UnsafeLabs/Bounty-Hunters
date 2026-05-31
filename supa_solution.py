 Just the solution.
```  
```typescript
import { GitService } from './git.service';

class GitService {
  private gitManager: GitManager;

  constructor(gitManager: GitManager) {
    this.gitManager = gitManager;
  }

  async exec(command: string[]) {
    try {
      await this.gitManager.gitCommand(command);
    } catch (error) {
      if (error.code === 'EAIAGET') {
        const conflictHead = childProcess.execSync('git show --format=%H .git/REBASE_HEAD').toString().trim();
        const conflictedFiles = await this.getConflictFiles();
        this.gitManager.rpcEmitter.emit('rebase.conflicts', conflictedFiles);
      } else {
        throw error;
      }
    }
  }

  async getConflictFiles() {
    const output = childProcess.execSync('git diff --name-only --diff-filter=U', { encoding: 'utf8' });
    return output.split('\n').filter(Boolean);
  }
}
```  
```  
```  
```typescript
import { GitService } from './git.service';

class GitService {
  private gitManager: GitManager;

  constructor(gitManager: GitManager) {
    this.gitManager = gitManager;
  }

  async exec(command: string[]) {
    try {
      await this.gitManager.gitCommand(command);
    } catch (error) {
      if (error.code === 'EAIAGET') {
