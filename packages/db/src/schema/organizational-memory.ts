import { pgTable, text, timestamp, uuid, real, index } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const organizationalMemory = pgTable('organizational_memory', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  // Where this memory came from
  sourceType: text('source_type').notNull(), // "work_item" | "comment" | "adr" | "retrospective" | "manual"
  sourceId: text('source_id'),

  content: text('content').notNull(),

  // Tags for faceted retrieval before we add vector search
  tags: text('tags').array().notNull().default([]),

  // Populated once we wire up an embedding provider
  embeddingModel: text('embedding_model'),
  relevanceScore: real('relevance_score'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('org_memory_company_idx').on(table.companyId),
  index('org_memory_source_idx').on(table.sourceType, table.sourceId),
]);

export type OrganizationalMemory = typeof organizationalMemory.$inferSelect;
export type NewOrganizationalMemory = typeof organizationalMemory.$inferInsert;
