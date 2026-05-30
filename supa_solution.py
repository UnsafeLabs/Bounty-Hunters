 Only the new solution.
``` 

```typescript
import { NextApiRequest, NextApiResponse } from 'next';
import { effectMetric } from './effect-metric';
import { prometheusFormatResponse } from './prometheus-format-response';

// Configuration de l'authentification (facultatif)
const authEnabled = process.env.AUTH_ENABLED !== 'false';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!authEnabled || !req.headers.authorization) {
    return res.status(401).json({ error: 'Authentification requise' });
  }

  // Création du `/metrics` endpoint
  const metricsEndpoint = `/metrics`;

  // Récupération des métriques Prometheus
  const activeSessions = await effectMetric('active_sessions');
  const rpcRequestsTotal = await effectMetric('rpc_requests_total', req.query.method);
  const gitOperationsTotal = await effectMetric('git_operations_total', req.query.operation);
  const memoryUsageBytes = await effectMetric('memory_usage_bytes');

  // Formatage de la réponse en Prometheus expositio
  const metricsResponse = prometheusFormatResponse({
    metrics: [
      {
        label: 'active_sessions',
        value: activeSessions,
        type: 'counter',
      },
      {
        label: 'rpc_requests_total',
        value: rpcRequestsTotal,
        type: 'counter',
      },
      {
        label: 'git_operations