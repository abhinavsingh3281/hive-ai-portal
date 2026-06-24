import type { FastifyPluginAsync } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { heartbeatRuns, costEvents } from '@aisc/db';

export const heartbeatRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { companyId: string; agentId?: string } }>(
    '/',
    async (req, reply) => {
      const { companyId, agentId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');

      const where = agentId
        ? and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, agentId))
        : eq(heartbeatRuns.companyId, companyId);

      return app.db
        .select()
        .from(heartbeatRuns)
        .where(where)
        .orderBy(desc(heartbeatRuns.createdAt))
        .limit(100);
    },
  );

  app.get<{ Querystring: { companyId: string } }>(
    '/costs',
    async (req, reply) => {
      const { companyId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');

      return app.db
        .select()
        .from(costEvents)
        .where(eq(costEvents.companyId, companyId))
        .orderBy(desc(costEvents.createdAt))
        .limit(500);
    },
  );
};
