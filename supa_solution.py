```ts
import { Effect } from "t3code";
import * as zod from 'zod';
import * as fs from 'fs';

const server = new Effect("server");
const config = new Effect("config");

// Load environment variables from process.env (or other supported sources)
const envVars: zod.ZodValidate = zod.object({
  test: zod.string(),
  // Add more required variables here
}).safeParse(() => {
  const { success, error } = envVars.parse(process.env);
  if (!success) {
    throw new Error(`Invalid environment variable value: ${error}`);
  }
});

// Validate environment variables at startup
config.effect = {
  validate: (envVars) => {
    const missing: string[] = [];
    if (!envVars.test) {
      missing.push('test');
    }
    // Check if all required variables exist
    for (const key in config.effect.environment) {
      if (!(key in envVars)) {
        missing.push(key);
      }
    }
    return missing;
  },
  validateRequired: () => {
    const missing = config.effect.validate(envVars);
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
  }
};

// Load and validate configuration file
const configFile = 'config.ts';
try {
  const fileContent = fs.readFileSync(configFile, 'utf8');
  const configSchema = require(configFile);
  const parsedConfig = zod.parse(fileContent).safeValue();
  if (!parsedConfig) {
    throw new Error(`Invalid configuration file: ${fileContent}`);
  }
} catch (error) {
  console.error(`Error loading or parsing configuration file: ${error}`);
}

// Run validation logic
config.effect.validateRequired();

// If all checks pass, print a success message
console.log("Validation successful!");
```