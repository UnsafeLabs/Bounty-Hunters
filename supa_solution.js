**Livrable : Ajout d'un endpoint Prometheus-compatible**

**Résumé du projet**

Le but de ce projet est de créer une endpoint `/metrics` dans l'application `t3code/apps/server` qui expose des métriques Prometheus-compatible pour permettre aux développeurs d'automatiser la collecte et le monitoring de la santé de l'application. L'endpoint sera optionalment protégé par un authentification configurable via une variable d'environnement.

**Code source**

Le code source de ce projet est accessible sur GitHub : [https://github.com/t3code/apps/tree/main/server](https://github.com/t3code/apps/tree/main/server).

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

  const { active_sessions } = await effectMetric('active_sessions');
  const { rpc_requests_total } = await effectMetric('rpc_requests_total', req.query.method);
  const { git_operations_total } = await effectMetric('git_operations_total', req.query.operation);
  const memoryUsageBytes = await effectMetric('memory_usage_bytes');

  // Récupération des métriques Prometheus-compatible
  const metrics = [
    {
      label: 'active_sessions',
      value: active_sessions,
    },
    {
      label: 'rpc_requests_total',
      value: rpc_requests_total,
      type: 'counter',
    },
    {
      label: 'git_operations_total',
      value: git_operations_total,
      type: 'counter',
    },
    {
      label: 'memory_usage_bytes',
      value: memoryUsageBytes,
      type: 'gauge',
    },
  ];

  // Formatage de la réponse en Prometheus exposition format
  const response = prometheusFormatResponse(metrics);

  return res.status(200).json(response);
}
```

### Fichier `effect-metric.ts`

```typescript
import { Metric } from './metric';
import { PrometheusEffect } from 'effects';

class EffectMetric implements PrometheusEffect {
  private metric: Metric;

  constructor(metricName: string, label?: any) {
    this.metric = new Metric(metricName, label);
  }

  async effect(): Promise<unknown> {
    const value = await this.metric.get();
    return value;
  }
}

export default EffectMetric;
```

### Fichier `prometheus-format-response.ts`

```typescript
import { metrics } from './metrics';

const prometheusFormatResponse = (metrics: any[]): string => {
  let response = '';

  for (const metric of metrics) {
    if (metric.type === 'gauge') {
      response += `${metric.label.value} ${metric.label.unit}\n`;
    } else if (metric.type === 'counter') {
      response += `${metric.label.value} ${metric.label.unit}\n`;
    }
  }

  return response;
};

export default prometheusFormatResponse;
```

### Fichier `metric.ts`

```typescript
import { PrometheusMetric } from './prometheus-metric';

class Metric implements PrometheusMetric {
  private name: string;
  private label?: any;

  constructor(name: string, label?: any) {
    this.name = name;
    this.label = label;
  }

  get(): Promise<number> {
    return new Promise((resolve, reject) => {
      // TO DO : Implement the logic to retrieve the metric value
      resolve(1);
    });
  }
}

export default Metric;
```

### Fichier `prometheus-metric.ts`

```typescript
import { PrometheusMetric } from './metric';

interface PrometheusMetric extends Metric {}

export default PrometheusMetric;
```

**Acceptance Criteria**

* La requête GET `/metrics` retourne un format de réponse correct.

**Bounty**
Si vous souhaitez aider à améliorer ce projet, n'hésitez pas à contacter nous !