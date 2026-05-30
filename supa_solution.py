import { Command } from 'effect-cli';
import * as fs from 'fs';
import * as path from 'path';

const version = require('./package.json').version;

export function command() {
  return new Command()
    .add('version', 'outputs detailed version info including runtime and platform')
    .action(async () => {
      console.log(`t3code v${version} (bun ${process.version}, ${process.platform})`);
    });
}

// Add a `--version` flag to the root CLI command in `t3code/apps/server/src/bin.ts`
Command.addVersionFlag();

// Read the version from `package.json` at build time and embed it in the binary
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
fs.writeFileSync(path.join(__dirname, '../build/binary.bin'), Buffer.from(version));

export default Command;