import { eq, and } from 'drizzle-orm';
import { workItemComments, workItems, type NewWorkItemComment } from '@aisc/db';
import type { Db } from '@aisc/db';
import { logActivity } from './activity-log.js';

export class CommentService {
  constructor(private db: Db) {}

  async list(companyId: string, workItemId: string) {
    return this.db.query.workItemComments.findMany({
      where: and(
        eq(workItemComments.companyId, companyId),
        eq(workItemComments.workItemId, workItemId),
      ),
      orderBy: workItemComments.createdAt,
    });
  }

  async create(
    companyId: string,
    workItemId: string,
    data: { content: string; authorAgentId?: string; authorUserId?: string },
  ) {
    // Verify the work item belongs to this company
    const item = await this.db.query.workItems.findFirst({
      where: and(eq(workItems.id, workItemId), eq(workItems.companyId, companyId)),
    });
    if (!item) throw new Error('Work item not found');

    const insert: Omit<NewWorkItemComment, 'id'> = {
      companyId,
      workItemId,
      content: data.content,
      authorAgentId: data.authorAgentId ?? null,
      authorUserId: data.authorUserId ?? null,
    };

    const [comment] = await this.db
      .insert(workItemComments)
      .values(insert)
      .returning();

    if (!comment) throw new Error('Failed to create comment');

    const actorId = data.authorAgentId ?? data.authorUserId ?? 'unknown';
    const actorType = data.authorAgentId ? 'agent' : 'user';

    await logActivity({
      db: this.db,
      companyId,
      actorType,
      actorId,
      action: 'comment.created',
      resourceType: 'work_item',
      resourceId: workItemId,
      details: { commentId: comment.id },
    });

    return comment;
  }
}
