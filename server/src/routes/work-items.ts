import type { FastifyPluginAsync } from 'fastify';
import { WorkItemService } from '../services/work-items.js';
import { CommentService } from '../services/comments.js';

export const workItemsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { companyId: string; parentId?: string } }>(
    '/',
    async (req, reply) => {
      const { companyId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');
      const svc = new WorkItemService(app.db);
      return svc.list(companyId);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { companyId: string } }>(
    '/:id',
    async (req, reply) => {
      const { companyId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');
      const svc = new WorkItemService(app.db);
      const item = await svc.get(companyId, req.params.id);
      if (!item) return reply.notFound('Work item not found');
      return item;
    },
  );

  app.post<{
    Body: {
      companyId: string;
      type: string;
      title: string;
      description?: string;
      priority?: string;
      parentId?: string;
      assigneeAgentId?: string;
      metadata?: Record<string, unknown>;
    };
  }>('/', async (req, reply) => {
    const { companyId, ...data } = req.body;
    const svc = new WorkItemService(app.db);
    try {
      const item = await svc.create(companyId, 'ceo', {
        type: data.type as Parameters<typeof svc.create>[2]['type'],
        title: data.title,
        description: data.description,
        priority: (data.priority as Parameters<typeof svc.create>[2]['priority']) ?? 'medium',
        parentId: data.parentId,
        assigneeAgentId: data.assigneeAgentId,
        metadata: data.metadata ?? {},
      });
      return reply.status(201).send(item);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create work item';
      return reply.badRequest(message);
    }
  });

  app.patch<{
    Params: { id: string };
    Body: { companyId: string; status: string };
  }>('/:id/status', async (req, reply) => {
    const svc = new WorkItemService(app.db);
    try {
      const updated = await svc.updateStatus(
        req.body.companyId,
        req.params.id,
        req.body.status,
        'ceo',
        'user',
      );
      return updated;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update status';
      return reply.badRequest(message);
    }
  });

  // ── Comments ─────────────────────────────────────────────────────────────────

  app.get<{ Params: { id: string }; Querystring: { companyId: string } }>(
    '/:id/comments',
    async (req, reply) => {
      const { companyId } = req.query;
      if (!companyId) return reply.badRequest('companyId query param required');
      const svc = new CommentService(app.db);
      return svc.list(companyId, req.params.id);
    },
  );

  app.post<{
    Params: { id: string };
    Body: { companyId: string; content: string; authorAgentId?: string; authorUserId?: string };
  }>('/:id/comments', async (req, reply) => {
    const { companyId, content, authorAgentId, authorUserId } = req.body;
    if (!companyId) return reply.badRequest('companyId required');
    if (!content) return reply.badRequest('content required');
    const svc = new CommentService(app.db);
    try {
      const comment = await svc.create(companyId, req.params.id, {
        content,
        ...(authorAgentId ? { authorAgentId } : {}),
        ...(authorUserId ? { authorUserId } : {}),
      });
      return reply.status(201).send(comment);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create comment';
      return reply.badRequest(message);
    }
  });
};
