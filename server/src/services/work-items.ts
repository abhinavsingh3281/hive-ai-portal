import { eq, and, isNull, sql } from 'drizzle-orm';
import { workItems, agents, type NewWorkItem } from '@aisc/db';
import type { Db } from '@aisc/db';
import { WORK_ITEM_TYPE_PREFIX, REQUIRED_ANCESTOR } from '@aisc/types';
import type { WorkItemType } from '@aisc/types';
import { logActivity } from './activity-log.js';

export class WorkItemService {
  constructor(private db: Db) {}

  async list(companyId: string) {
    return this.db.query.workItems.findMany({
      where: eq(workItems.companyId, companyId),
      orderBy: workItems.createdAt,
    });
  }

  async get(companyId: string, id: string) {
    const item = await this.db.query.workItems.findFirst({
      where: and(eq(workItems.id, id), eq(workItems.companyId, companyId)),
    });
    return item ?? null;
  }

  async create(
    companyId: string,
    actorId: string,
    data: Omit<NewWorkItem, 'id' | 'companyId' | 'identifier' | 'itemNumber'>,
  ) {
    // Enforce research-first pipeline
    if (data.parentId && data.type) {
      await this.assertAncestorRequirements(companyId, data.parentId, data.type as WorkItemType);
    }

    const number = await this.nextItemNumber(companyId);
    const prefix = WORK_ITEM_TYPE_PREFIX[data.type as WorkItemType];
    const identifier = `${prefix}-${number}`;

    const [item] = await this.db
      .insert(workItems)
      .values({ ...data, companyId, identifier, itemNumber: number })
      .returning();

    if (!item) throw new Error('Failed to create work item');

    await logActivity({
      db: this.db,
      companyId,
      actorType: 'user',
      actorId,
      action: 'work_item.created',
      resourceType: 'work_item',
      resourceId: item.id,
      details: { type: item.type, identifier: item.identifier },
    });

    return item;
  }

  // Atomic checkout — only one agent can claim an item at a time.
  // Returns the updated item or null if the checkout failed (conflict).
  async checkout(companyId: string, itemId: string, agentId: string, runId: string) {
    const [updated] = await this.db
      .update(workItems)
      .set({
        assigneeAgentId: agentId,
        status: 'in_progress',
        checkoutRunId: runId,
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(workItems.id, itemId),
          eq(workItems.companyId, companyId),
          // Only claim items that are unowned and in a startable state
          isNull(workItems.checkoutRunId),
          sql`${workItems.status} IN ('created', 'assigned')`,
        ),
      )
      .returning();

    return updated ?? null;
  }

  async updateStatus(
    companyId: string,
    itemId: string,
    status: string,
    actorId: string,
    actorType: 'agent' | 'user' | 'system' = 'system',
  ) {
    const prev = await this.get(companyId, itemId);
    if (!prev) throw new Error(`Work item ${itemId} not found`);

    const [updated] = await this.db
      .update(workItems)
      .set({
        status: status as NewWorkItem['status'],
        completedAt: status === 'completed' ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(workItems.id, itemId), eq(workItems.companyId, companyId)))
      .returning();

    if (!updated) throw new Error('Failed to update work item status');

    await logActivity({
      db: this.db,
      companyId,
      actorType,
      actorId,
      action: 'work_item.status_changed',
      resourceType: 'work_item',
      resourceId: itemId,
      details: { from: prev.status, to: status },
    });

    return updated;
  }

  private async nextItemNumber(companyId: string): Promise<number> {
    const result = await this.db
      .select({ max: sql<number>`COALESCE(MAX(${workItems.itemNumber}), 0)` })
      .from(workItems)
      .where(eq(workItems.companyId, companyId));

    return (result[0]?.max ?? 0) + 1;
  }

  private async assertAncestorRequirements(
    companyId: string,
    parentId: string,
    type: WorkItemType,
  ): Promise<void> {
    const required = REQUIRED_ANCESTOR[type];
    if (!required || required.length === 0) return;

    // Walk the parent chain and collect ancestor types
    const ancestorTypes = new Set<string>();
    let currentId: string | null = parentId;

    while (currentId) {
      const ancestor = await this.get(companyId, currentId);
      if (!ancestor) break;
      ancestorTypes.add(ancestor.type);
      currentId = ancestor.parentId;
    }

    for (const req of required) {
      if (!ancestorTypes.has(req)) {
        throw new Error(
          `Cannot create ${type}: ancestor chain must include ${req}. ` +
          `This enforces the research-first pipeline.`,
        );
      }
    }
  }
}
