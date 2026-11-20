import { existsSync } from 'node:fs';
import { join } from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { csrfGuard } from './auth.js';
import { config } from './config.js';
import { HttpError } from './errors.js';
import adminRouter from './routes/admin.js';
import authRouter from './routes/auth.js';
import chatRouter from './routes/chat.js';
import cookingRouter from './routes/cooking.js';
import membersRouter from './routes/members.js';
import metaRouter from './routes/meta.js';
import notificationsRouter from './routes/notifications.js';
import washingRouter from './routes/washing.js';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '3mb' }));
  app.use(cookieParser());
  app.use('/api', csrfGuard);

  app.use('/api', metaRouter()); // /api/health (public), /api/meta
  app.use('/api/auth', authRouter());
  app.use('/api/members', membersRouter());
  app.use('/api/notifications', notificationsRouter());
  app.use('/api/admin', adminRouter());
  app.use('/api/cooking', cookingRouter);
  app.use('/api/washing', washingRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found', message: 'No such API endpoint.' } });
  });

  // Built React app (production). Hashed assets are immutable; index.html is never cached.
  if (existsSync(config.clientDist)) {
    app.use('/assets', express.static(join(config.clientDist, 'assets'), { immutable: true, maxAge: '1y' }));
    app.use('/avatars', express.static(join(config.clientDist, 'avatars'), { maxAge: '1d' }));
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(join(config.clientDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'too_large', message: 'That upload is too large (3 MB max).' } });
      return;
    }
    if (e?.type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'bad_json', message: 'The request body is not valid JSON.' } });
      return;
    }
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server. Try again.' } });
  });

  return app;
}
