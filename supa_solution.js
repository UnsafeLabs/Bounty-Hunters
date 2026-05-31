```typescript
import { Effect } from "t3code";
import * as zod from 'zod';
import * as fs from 'fs';

const server = new Effect("server");
const config = new Effect("config");

// Load environment variables from process.env (or other supported sources)
const envVars: zod.ZodValidate = zod.object({
  test: zod.string().required(),
  // Add more required variables here
}).safeParse(() => {
  const { success, error } = envVars.parse(process.env);
  if (!success) {
    throw new Error(`Invalid environment variable value: ${error}`);
  }
});

// Validate environment variables at startup using Zod's validation hooks
config.effect = {
  async validateHook(envVars: zod.ZodValidate): Promise<void> {
    const missing: string[] = [];
    for (const key in config.effect.environment) {
      if (!(key in envVars)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }
  },
};

// Load and validate configuration file using Zod's schema validation
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
config.effect.validateHook(envVars);

// If all checks pass, print a success message
if (!config.effect.validateHook || !parsedConfig) {
  console.log("Validation failed. Please check environment variables and configuration file.");
} else {
  console.log("Validation successful!");
}
```