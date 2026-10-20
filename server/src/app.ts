import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db.js';
import { Store, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from './store.js';
import { Hub } from './hub.js';
import { registerRoutes } from './routes.js';
import { registerWs } from './ws.js';
import { seedDemoData } from './seed.js';

export interface AppOptions {
  dbPath?: string;
  seed?: boolean;
  staticDir?: string;
  logger?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    store: Store;
    hub: Hub;
  }
  interface FastifyRequest {
    userId: string;
  }
}

export async function buildApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const db = openDb(opts.dbPath ?? ':memory:');
  const store = new Store(db);
  if (opts.seed) seedDemoData(store);

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 64 * 1024 });
  const hub = new Hub(store);
  app.decorate('store', store);
  app.decorate('hub', hub);
  app.decorateRequest('userId', '');

  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-frame-options', 'DENY');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) {
      reply.header(
        'content-security-policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'none'"
      );
    }
    return payload;
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    if (err instanceof ForbiddenError) return reply.code(403).send({ error: err.message });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof BadRequestError) return reply.code(400).send({ error: err.message });
    if (err.validation) return reply.code(400).send({ error: `Invalid request: ${err.message}` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.message });
    app.log.error(err);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  await registerRoutes(app);
  await registerWs(app);

  if (opts.staticDir && existsSync(join(opts.staticDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: opts.staticDir });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Not found' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }));
  }

  return app;
}
