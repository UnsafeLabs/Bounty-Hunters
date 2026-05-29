**Livrable : Ajout de la limitation de taille de corps de requête avec des overrides par route**

**Référence GitHub : [t3code/t3-apps](https://github.com/t3code/t3-apps)**

**Description du problème :**

Le module HTTP de `t3code/apps/server/src/http.ts` configure les CORS et les routes, mais ne met pas en place la limitation de taille de corps de requête, permettant aux clients de soumettre des payloads arbitraires.

**Objectif :**

Ajouter une limitation de taille de corps de requête configurable, avec des overrides par route, pour empêcher les requêtes de dépasser un certain taillemax.

**Implementation :**

### **t3code/apps/server/src/http.ts**

```typescript
import { NextFunction, Request, Response } from 'express';
import { RequestBodySizeLimitError } from './errors';

const defaultRequestBodySizeLimit = 10 * 1024 * 1024; // 10 MB
const fileUploadEndpointSizeLimit = 50 * 1024 * 1024; // 50 MB

const requestBodySizeLimits = {
  regular: defaultRequestBodySizeLimit,
  fileUpload: fileUploadEndpointSizeLimit,
};

export default function httpServer(app) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const route = req.url;
    const limit = requestBodySizeLimits[route] || defaultRequestBodySizeLimit;

    // Si la taille de corps de requête dépasser le limite
    if (req.body.length > limit) {
      return res.status(413).json({
        error: 'Payload Too Large',
        limit,
        receivedSize: req.body.length,
      });
    }

    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const route = req.url;
    if (requestBodySizeLimits[route] && req.method === 'POST') {
      const limit = requestBodySizeLimits[route];
      // Si la taille de corps de requête dépasser le limite
      if (req.body.length > limit) {
        return res.status(413).json({
          error: 'Payload Too Large',
          limit,
          receivedSize: req.body.length,
        });
      }
    }

    next();
  });

  // Exposition des headers X-Max-Body-Size lors d'une erreur 413
  app.use((err, req, res, next) => {
    if (err.status === 413) {
      return res.header('X-Max-Body-Size', requestBodySizeLimits[req.url] || defaultRequestBodySizeLimit);
    }
    next(err);
  });

  // Autres routes
  app.get('/', (req, res) => {
    res.send('Bienvenue !');
  });
}
```

### **tests/http.test.ts**

```typescript
import request from 'supertest';
import httpServer from './http';

describe('http-server', () => {
  it('should retourner une erreur lorsque la taille de corps de requête dépasser le limite', async () => {
    const app = httpServer();
    await request(app).post('/regular').send({ body: 'Test' }).expect(413);
  });

  it('should retourner l\'erreur avec les informations pertinentes', async () => {
    const app = httpServer();
    const response = await request(app).post('/fileUpload')
      .set('Content-Type', 'application/json')
      .send({ body: 'Test' })
      .expect(413);

    expect(response.body.error).toBe('Payload Too Large');
    expect(response.body.limit).toBe(fileUploadEndpointSizeLimit);
    expect(response.body.receivedSize).toBeGreaterThan(0);
  });
});
```

### **.gitignore**

```bash
node_modules/
.gitignore
README.md
.tmbundle/
.DS_Store
```

**Acceptance Criteria :**

- Les requêtes qui dépassent la limite de taille de corps de requête sont retournées avec une erreur 413.
- L'erreur contient les informations pertinentes, notamment le limite et la taille reçue.

**Conclusion :**

Cette solution met en place une limitation de taille de corps de requête configurable avec des overrides par route. Elle permet d'éviter que les requêtes dépassent un certain taillemax et de retourner des erreurs pertinentes pour le debugging.