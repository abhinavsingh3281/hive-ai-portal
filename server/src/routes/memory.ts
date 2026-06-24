import type { FastifyPluginAsync } from 'fastify';
import { MemoryService } from '../services/memory.js';

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: { companyId: string; tags?: string; limit?: string };
  }>('/', async (req, reply) => {
    const { companyId, tags, limit } = req.query;
    if (!companyId) return reply.badRequest('companyId query param required');

    const svc = new MemoryService(app.db);
    const parsedTags = tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined;
    const parsedLimit = limit ? parseInt(limit, 10) : undefined;

    return svc.list(companyId, {
      ...(parsedTags ? { tags: parsedTags } : {}),
      ...(parsedLimit !== undefined ? { limit: parsedLimit } : {}),
    });
  });

  app.post<{
    Body: {
      companyId: string;
      content: string;
      sourceType: string;
      sourceId?: string;
      tags?: string[];
    };
  }>('/', async (req, reply) => {
    const { companyId, content, sourceType, sourceId, tags } = req.body;
    if (!companyId) return reply.badRequest('companyId required');
    if (!content) return reply.badRequest('content required');
    if (!sourceType) return reply.badRequest('sourceType required');

    const svc = new MemoryService(app.db);
    try {
      const entry = await svc.create(companyId, {
        content,
        sourceType,
        ...(sourceId ? { sourceId } : {}),
        ...(tags ? { tags } : {}),
      });
      return reply.status(201).send(entry);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create memory entry';
      return reply.badRequest(message);
    }
  });
};
