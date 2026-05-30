```typescript
import { NextFunction, Request, Response } from 'express';
import * as express from 'express';

// Configuration for request body size limits with overrides per route
const requestBodySizeLimits = {
  regular: { limit: 10 * 1024 * 1024, overrideRoute: '/file-upload' },
  fileUpload: { limit: 50 * 1024 * 1024, overrideRoute: null },
};

// Expose middleware function to validate request body size
const bodyParserMiddleware = (options = {}) => {
  const defaultOptions = {
    limits: requestBodySizeLimits,
    overrideRouteLimit: 'fileUpload',
  };

  options.limits = { ...defaultOptions.limits, ...options.limits };
  options.overrideRouteLimit = options.overrideRouteLimit || defaultOptions.overrideRouteLimit;

  return (req: Request, res: Response, next: NextFunction) => {
    const route = req.url;
    let limit = options.limits[route]?.limit;

    if (!limit && options.overrideRouteLimit === 'fileUpload') {
      limit = options.limits.fileUpload.limit;
    }

    if (limit && req.body.length > limit) {
      return res.status(413).json({
        error: 'Payload Too Large',
        limit,
        receivedSize: req.body.length,
      });
    }

    next();
  };
};

// Expose Express app with middleware function enabled
const createHttpServer = (app: express.Application) => {
  const bodyParserMiddlewareInstance = bodyParserMiddleware();

  // CORS configuration (not related to request body size limits)
  const corsConfig = { origin: '*' };
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.header('Access-Control-Allow-Origin', corsConfig.origin);
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    return next();
  });

  // Enable bodyParserMiddleware with options
  app.use(bodyParserMiddlewareInstance);

  // Other routes and middleware...
};

// Expose Express app with bodyParserMiddleware enabled
const httpServer = (app: express.Application) => {
  createHttpServer(app);
};

export default httpServer;
```