import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { workItems } from './work-items';
import { agents } from './agents';

export const workItemComments = pgTable('work_item_comments', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  workItemId: uuid('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),

  // Author is either an agent or a human user
  authorAgentId: uuid('author_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  authorUserId: text('author_user_id'),

  content: text('content').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItemComment = typeof workItemComments.$inferSelect;
export type NewWorkItemComment = typeof workItemComments.$inferInsert;
