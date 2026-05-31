```ts
// src/auth.ts
import { process, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const tempDir = '/tmp/ssh-askpass';

// Function to generate a prompt
function generatePrompt(prompt: string): string {
  const tempFile = path.join(tempDir, `temp-${Date.now()}`);
  
  // Create the directory if it doesn't exist
  fs.mkdirSync(tempDir, { recursive: true });
  
  try {
    // Write the password to the temp file
    spawn('sh', ['-p', prompt, '-f', tempFile]);
    
    // Clean up the temp file and directory when done
    return tempFile;
  } catch (e) {
    console.error(`Error generating prompt: ${e}`);
    throw e;
  }
}

// Function to clean up temporary files and directories
function cleanup() {
  try {
    fs.rmdirSync(tempDir, { recursive: true });
  } catch (e) {
    console.error(`Error cleaning up temp dir: ${e}`);
  }
}

// Main function to run the test
async function test() {
  try {
    const result = await generatePrompt('test');
    
    if (!result) {
      throw new Error('No prompt generated');
    }
    
    // Read and return the password from the temp file
    const password = fs.readFileSync(result, 'utf8');
    cleanup();
    return password;
  } catch (e) {
    console.error(`Error: ${e}`);
    process.exit(1);
  }
}

export default test;
```