 Just the final solution.
The improved solution is as follows:
```ts
// contracts/src/provider.ts

import { effectSchema } from '@effect-schematics/effect-schema';
import { validate } from 'effect-validation';

export const providerContract = {
  // ...
  apiKeys: effectSchema.string().not().min(10).error('API key must be at least 10 characters long'),
  endpointUrls: effectSchema.string()
    .url().requireHttps()
    .error('Endpoint URL must be a valid HTTPS URL')
};

export const ProviderContract = validate(providerContract);
``````ts
``` 
```ts
// contracts/src/providerInstance.ts

import { providerContract } from './provider';
import { ProviderConfigError } from './ProviderConfigError';

export type ProviderInstanceConfig = {
  apiKeys: string[];
  endpointUrls: string[];
};

export function validateProviderConfig(config: ProviderInstanceConfig): Effect.Either<ProviderConfigError, void> {
  // Check if the number of API keys is at least 1
  if (config.apiKeys.length === 0) {
    return Effect.left(new ProviderConfigError('No API keys provided'));
  }

  // Check if each API key is at least 10 characters
  for (const apiKey of config.apiKeys) {
    if (apiKey.length < 10) {
      return Effect.left(new ProviderConfigError('Each API key must be at least 10 characters