 Only the solution.
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
```ts
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
``` 
