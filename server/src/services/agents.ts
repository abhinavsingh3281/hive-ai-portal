import { eq, and } from 'drizzle-orm';
import { agents, type NewAgent } from '@aisc/db';
import type { Db } from '@aisc/db';
import { logActivity } from './activity-log.js';

export class AgentService {
  constructor(private db: Db) {}

  async list(companyId: string) {
    return this.db.query.agents.findMany({
      where: eq(agents.companyId, companyId),
      orderBy: agents.createdAt,
    });
  }

  async get(companyId: string, id: string) {
    const agent = await this.db.query.agents.findFirst({
      where: and(eq(agents.id, id), eq(agents.companyId, companyId)),
    });
    return agent ?? null;
  }

  async create(companyId: string, actorId: string, data: Omit<NewAgent, 'id' | 'companyId'>) {
    const [agent] = await this.db
      .insert(agents)
      .values({ ...data, companyId })
      .returning();

    if (!agent) throw new Error('Failed to create agent');

    await logActivity({
      db: this.db,
      companyId,
      actorType: 'user',
      actorId,
      action: 'agent.created',
      resourceType: 'agent',
      resourceId: agent.id,
      details: { role: agent.role, name: agent.name },
    });

    return agent;
  }

  async updateStatus(companyId: string, agentId: string, status: NewAgent['status']) {
    const [updated] = await this.db
      .update(agents)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(agents.id, agentId), eq(agents.companyId, companyId)))
      .returning();

    return updated ?? null;
  }

  async touch(agentId: string) {
    await this.db
      .update(agents)
      .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
      .where(eq(agents.id, agentId));
  }
}
