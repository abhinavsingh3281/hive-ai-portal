import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Db } from '@aisc/db';
import type { Config } from './config.js';
import type { Scheduler } from './scheduler/heartbeat.js';
import { companiesRoutes } from './routes/companies.js';
import { agentsRoutes } from './routes/agents.js';
import { workItemsRoutes } from './routes/work-items.js';
import { heartbeatRoutes } from './routes/heartbeats.js';
import { memoryRoutes } from './routes/memory.js';
import { AdapterRegistry } from './adapters/registry.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    config: Config;
    scheduler: Scheduler;
    registry: AdapterRegistry;
  }
}

export async function buildApp(db: Db, config: Config) {
  const loggerConfig = config.NODE_ENV !== 'production'
    ? { level: 'debug', transport: { target: 'pino-pretty', options: { colorize: true } } }
    : { level: 'info' };

  const app = Fastify({ logger: loggerConfig });

  // Decorate with shared dependencies so routes can access them
  const registry = new AdapterRegistry(config);
  app.decorate('db', db);
  app.decorate('config', config);
  app.decorate('registry', registry);

  await app.register(cors, { origin: true });
  await app.register(sensible);

  await app.register(swagger, {
    openapi: {
      info: { title: 'AISC API', version: '0.1.0', description: 'Autonomous AI Software Company' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // ── Routes ──────────────────────────────────────────────────────────────────
  await app.register(companiesRoutes, { prefix: '/api/companies' });
  await app.register(agentsRoutes, { prefix: '/api/agents' });
  await app.register(workItemsRoutes, { prefix: '/api/work-items' });
  await app.register(heartbeatRoutes, { prefix: '/api/heartbeats' });
  await app.register(memoryRoutes, { prefix: '/api/memory' });

  // Adapter status
  app.get('/api/adapters', async () => app.registry.listWithStatus());

  // Hot-connect an API-key adapter
  app.post<{ Params: { type: string }; Body: { apiKey: string } }>(
    '/api/adapters/:type/connect',
    async (req, reply) => {
      const result = await app.registry.connect(req.params.type, req.body.apiKey);
      return result.ok
        ? reply.status(200).send({ connected: true, type: req.params.type })
        : reply.status(400).send({ connected: false, message: result.message });
    },
  );

  // Re-check a single adapter's status
  app.get<{ Params: { type: string } }>(
    '/api/adapters/:type/status',
    async (req, reply) => {
      const adapter = app.registry.get(req.params.type);
      if (!adapter) return reply.status(404).send({ ok: false, message: 'Adapter not registered' });
      if (!adapter.checkEnvironment) return { type: req.params.type, ok: true };
      const check = await adapter.checkEnvironment();
      return { type: req.params.type, ...check };
    },
  );

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  return app;
}
