import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const dbPath = resolve(process.env.DB_PATH ?? join(here, '..', 'data', 'huddle.db'));
const staticDir = resolve(process.env.STATIC_DIR ?? join(here, '..', '..', 'web', 'dist'));

const app = await buildApp({ dbPath, staticDir, seed: process.env.SEED !== '0', logger: true });

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port, host });
  app.log.info(`Huddle running at http://localhost:${port} (db: ${dbPath})`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
