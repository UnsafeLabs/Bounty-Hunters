 Just the improved solution. Just the solution.
``` 

### Fichier `effect-metric.ts`

```typescript
import { effect } from 'effect';

export default function(effectMetric: effect.Metric) {
  return async function handler(query: { method: string; operation: string }) {
    const { key, value } = await effectMetric(effect, query.method, query.operation);
    return { key, value };
  };
}
```

### Fichier `prometheus-format-response.ts`

```typescript
export function prometheusFormatResponse(metrics: Array<{ label: string; value: number }>) {
  return metrics.map(metric => {
    const label = metric.label;
    const value = metric.value;
    return `${label}: ${value.toFixed(2)}`;
  }).join('\n');
}
``` 

### Fichier `http.ts`

```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { effectMetric } from './effect-metric';
import { prometheusFormatResponse } from './prometheus-format-response';

// Configuration de l'authentification (facultatif)
const authEnabled = process.env.AUTH_ENABLED !== 'false';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (authEnabled && !req.headers.authorization) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  const { active_sessions } = await effectMetric