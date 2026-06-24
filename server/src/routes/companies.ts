import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { companies } from '@aisc/db';
import { logActivity } from '../services/activity-log.js';

export const companiesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async () => {
    return app.db.query.companies.findMany({ orderBy: companies.createdAt });
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const company = await app.db.query.companies.findFirst({
      where: eq(companies.id, req.params.id),
    });
    if (!company) return reply.notFound('Company not found');
    return company;
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const [deleted] = await app.db
      .delete(companies)
      .where(eq(companies.id, req.params.id))
      .returning();
    if (!deleted) return reply.notFound('Company not found');
    return { deleted: true, id: req.params.id };
  });

  app.patch<{
    Params: { id: string };
    Body: { name?: string; goals?: string };
  }>('/:id', async (req, reply) => {
    const { name, goals } = req.body;
    const [updated] = await app.db
      .update(companies)
      .set({
        ...(name ? { name } : {}),
        ...(goals !== undefined ? { goals } : {}),
        updatedAt: new Date(),
      })
      .where(eq(companies.id, req.params.id))
      .returning();
    if (!updated) return reply.notFound('Company not found');
    return updated;
  });

  app.post<{
    Body: { name: string; slug: string; goals?: string };
  }>('/', async (req, reply) => {
    const { name, slug, goals } = req.body;

    const [company] = await app.db
      .insert(companies)
      .values({ name, slug, goals })
      .returning();

    if (!company) return reply.internalServerError('Failed to create company');

    await logActivity({
      db: app.db,
      companyId: company.id,
      actorType: 'user',
      actorId: 'ceo',
      action: 'company.created',
      resourceType: 'company',
      resourceId: company.id,
      details: { name, slug },
    });

    return reply.status(201).send(company);
  });
};
