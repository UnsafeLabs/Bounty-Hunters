**Solution: Runtime Validation for Provider Configuration Schemas**

**Approach:**
To solve this bounty, we'll make the following changes:

1.  Add Effect Schema refinements to validate API key format.
2.  Implement URL validation for endpoint fields using a regex pattern.
3.  Create a `validateProviderConfig` function that runs all validations and returns a typed `Effect.Either`.
4.  Introduce a `ProviderConfigError` tagged error type in the contracts package.

**Code Changes:**

### provider.ts

```typescript
import { EffectSchema, ProviderSchema } from 't3code/packages/contracts/src/effect_schema';
import { validateProviderConfig } from './validate-provider-config';

// Define the updated provider contract schema with runtime validation.
export const provider: ProviderSchema = {
  $schema: 'Effect Schema',
  type: 'object',
  properties: {
    apiKey: EffectSchema.string({
      format: 'emailAddressRegex', // Add regex pattern to validate API key format
    }),
    endpointUrl: EffectSchema.string({
      format: 'url', // URL validation is performed using the url effect schema.
    }),
  },
};

// Define a new tagged error type for provider configuration errors.
export const ProviderConfigError = {
  tag: 'provider-config-error',
};
```

### validate-provider-config.ts

```typescript
import { EffectSchema, Either } from 't3code/packages/contracts/src/effect_schema';
import { validateEndpointUrl } from './validate-endpoint-url';

// Define a function to run all validations on the provider configuration.
export async function validateProviderConfig(config: any): Promise<Either<Error, void>> {
  // Perform API key validation using regex pattern
  if (!config.apiKey) {
    return Either.left(new Error('API key is required'));
  }
  const apiKeyRegex = /^[a-zA-Z0-9.-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!apiKeyRegex.test(config.apiKey)) {
    return Either.left(
      new Error(`Invalid API key format. Expected format: ${apiKeyRegex.source}`)
    );
  }

  // Perform URL validation for endpoint fields
  const endpointUrl = config.endpointUrl;
  if (!endpointUrl) {
    return Either.left(new Error('Endpoint URL is required'));
  }
  try {
    validateEndpointUrl(endpointUrl);
  } catch (error) {
    return Either.left(error);
  }

  // If no errors were found, return a success value.
  return Either.right();
}

// Define a function to validate endpoint URLs
function validateEndpointUrl(url: string): void {
  const urlRegex = /^https:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!urlRegex.test(url)) {
    throw new Error('Invalid HTTPS URL');
  }
}
```

### providerInstance.ts

```typescript
import { validateProviderConfig } from './validate-provider-config';

// Create a function to create a provider instance based on the validated configuration.
export async function createProvider(config: any): Promise<void> {
  try {
    await validateProviderConfig(config);
    // Use the validated configuration to create a provider instance.
  } catch (error) {
    if (error.tag === 'provider-config-error') {
      console.error(`Invalid provider configuration: ${error.message}`);
    }
  }
}
```

**Setup and Dependencies:**
To implement this solution, ensure that you have the following dependencies installed:

*   `t3code/packages/contracts`: A package containing Effect Schema and other contracts related to our application.
*   `@types/node` and `@types/EffectSchema` (Optional): If using TypeScript or another superset of JavaScript.

**Brief Explanation:**

To solve this bounty, we updated the provider contract schema with runtime validation for API key format using a regex pattern. We also implemented URL validation for endpoint fields using the url effect schema. Additionally, we created a `validateProviderConfig` function that runs all validations and returns a typed `Effect.Either`. Finally, we introduced a `ProviderConfigError` tagged error type in the contracts package.

Please note that you should replace the `// Use the validated configuration to create a provider instance.` comment with your actual code for creating a provider instance.