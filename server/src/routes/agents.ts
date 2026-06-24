import type { FastifyPluginAsync } from 'fastify';
import { eq, and } from 'drizzle-orm';
import { agents } from '@aisc/db';
import { AgentService } from '../services/agents.js';

export const agentsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { companyId: string } }>('/', async (req, reply) => {
    const { companyId } = req.query;
    if (!companyId) return reply.badRequest('companyId query param required');
    const svc = new AgentService(app.db);
    return svc.list(companyId);
  });

  app.get<{ Params: { id: string }; Querystring: { companyId: string } }>(
    '/:id',
    async (req, reply) => {
      const { companyId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');
      const svc = new AgentService(app.db);
      const agent = await svc.get(companyId, req.params.id);
      if (!agent) return reply.notFound('Agent not found');
      return agent;
    },
  );

  app.post<{
    Body: {
      companyId: string;
      name: string;
      role: string;
      title: string;
      reportsTo?: string;
      adapterType?: string;
      adapterConfig?: Record<string, unknown>;
      capabilities?: string;
      systemPrompt?: string;
      budgetMonthlyCents?: number;
    };
  }>('/', async (req, reply) => {
    const { companyId, ...data } = req.body;
    const svc = new AgentService(app.db);
    const agent = await svc.create(companyId, 'ceo', {
      ...data,
      role: data.role as Parameters<typeof svc.create>[2]['role'],
    });
    return reply.status(201).send(agent);
  });

  app.patch<{
    Params: { id: string };
    Body: { companyId: string; status: string };
  }>('/:id/status', async (req, reply) => {
    const svc = new AgentService(app.db);
    const updated = await svc.updateStatus(
      req.body.companyId,
      req.params.id,
      req.body.status as Parameters<typeof svc.updateStatus>[2],
    );
    if (!updated) return reply.notFound('Agent not found');
    return updated;
  });

  // Edit agent properties
  app.patch<{
    Params: { id: string };
    Body: {
      companyId: string;
      name?: string;
      title?: string;
      adapterType?: string;
      systemPrompt?: string;
      budgetMonthlyCents?: number;
    };
  }>('/:id', async (req, reply) => {
    const { companyId, name, title, adapterType, systemPrompt, budgetMonthlyCents } = req.body;
    const [updated] = await app.db
      .update(agents)
      .set({
        ...(name ? { name } : {}),
        ...(title ? { title } : {}),
        ...(adapterType ? { adapterType } : {}),
        ...(systemPrompt !== undefined ? { systemPrompt } : {}),
        ...(budgetMonthlyCents !== undefined ? { budgetMonthlyCents } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(agents.id, req.params.id), eq(agents.companyId, companyId)))
      .returning();
    if (!updated) return reply.notFound('Agent not found');
    return updated;
  });

  // Manually trigger a heartbeat dispatch for an agent
  app.post<{ Params: { id: string } }>('/:id/wake', async (req, reply) => {
    try {
      await app.scheduler.wake(req.params.id);
      return reply.status(202).send({ dispatched: true, agentId: req.params.id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to wake agent';
      return reply.badRequest(message);
    }
  });
};
