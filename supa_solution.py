 Only the code.
```ts
// src/auth.ts
import { process, spawn } from 'child_process';

// Function to generate a prompt
function generatePrompt(prompt: string): string {
  const temp = mktemp('-t', 'ssh-askpass');
  
  // Write the password to the temp file
  spawn('sh', ['-p', prompt, '-f', temp]);
  
  // Clean up the temp file
  spawn('trap', 'INT', 'TERM');
  
  return temp;
}

// Main function to run the test
function test() {
  const result = generatePrompt('test');
  if (!result) {
    console.error('Error: no prompt generated');
    return;
  }
  
  console.log('Password: ' + result);
}
```ts
``` 
``` 
```ts
// src/auth.ts
import { process, spawn } from 'child_process';

// Function to generate a prompt
function generatePrompt(prompt: string): string {
  const temp = mktemp('-t', 'ssh-askpass');
  
  // Write the password to the temp file
  spawn('sh', ['-p', prompt, '-f', temp]);
  
  // Clean up the temp file
  spawn('trap', 'INT', 'TERM');
  
  return temp;
}

// Main function to run the test
function test() {
  const result = generatePrompt('test');
  if (!result) {
    console.error('