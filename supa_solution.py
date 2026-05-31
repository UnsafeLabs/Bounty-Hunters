```javascript
import { Command } from 'effect-cli';
import * as fs from 'fs';
import * as path from 'path';

const version = require('./package.json').version;

export function command() {
  return new Command()
    .add('version', 'outputs detailed version info including runtime and platform')
    .addVersionFlag((flag) => {
      if (!flag) {
        console.log(`t3code v${version} (bun ${process.version}, ${process.platform})`);
      }
    })
    .action(async () => {
      await this._action();
    });

  function _action() {
    try {
      // Read the version from `package.json` at build time and embed it in the binary
      const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
      fs.writeFileSync(path.join(__dirname, '../build/binary.bin'), Buffer.from(version));

      // Add a `--version` flag to the root CLI command in `t3code/apps/server/src/bin.ts`
      Command.addVersionFlag((flag) => {
        if (flag) {
          console.log(`t3code v${version} (bun ${process.version}, ${process.platform})`);
        }
      });

      // Add subcommand version to handle version info
      this.addSubcommand('version', 'outputs detailed version info including runtime and platform')
        .addOption(['-v', '--version'], 'output version info')
        .action(async () => {
          console.log(`t3code v${version} (bun ${process.version}, ${process.platform})`);
        });
    } catch (error) {
      console.error(error);
      process.exit(1);
    }
  }
}

// Add a `--version` flag to the root CLI command in `t3code/apps/server/src/bin.ts`
Command.addVersionFlag((flag) => {
  if (!flag) {
    console.log(`t3code v${version} (bun ${process.version}, ${process.platform})`);
  }
});

export default Command;
```