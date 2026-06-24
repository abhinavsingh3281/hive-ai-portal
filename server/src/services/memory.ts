import { eq, and, desc, sql } from 'drizzle-orm';
import { organizationalMemory, type NewOrganizationalMemory } from '@aisc/db';
import type { Db } from '@aisc/db';

export class MemoryService {
  constructor(private db: Db) {}

  async list(companyId: string, opts: { tags?: string[]; limit?: number } = {}) {
    const limit = Math.min(opts.limit ?? 50, 200);

    if (opts.tags && opts.tags.length > 0) {
      // Filter entries that contain at least one of the requested tags
      return this.db.query.organizationalMemory.findMany({
        where: and(
          eq(organizationalMemory.companyId, companyId),
          sql`${organizationalMemory.tags} && ${opts.tags}`,
        ),
        orderBy: desc(organizationalMemory.createdAt),
        limit,
      });
    }

    return this.db.query.organizationalMemory.findMany({
      where: eq(organizationalMemory.companyId, companyId),
      orderBy: desc(organizationalMemory.createdAt),
      limit,
    });
  }

  async create(
    companyId: string,
    data: {
      content: string;
      sourceType: string;
      sourceId?: string;
      tags?: string[];
    },
  ) {
    const insert: Omit<NewOrganizationalMemory, 'id'> = {
      companyId,
      content: data.content,
      sourceType: data.sourceType,
      sourceId: data.sourceId ?? null,
      tags: data.tags ?? [],
    };

    const [entry] = await this.db
      .insert(organizationalMemory)
      .values(insert)
      .returning();

    if (!entry) throw new Error('Failed to create memory entry');
    return entry;
  }
}
