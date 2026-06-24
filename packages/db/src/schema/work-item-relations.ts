import { pgEnum, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { workItems } from './work-items';

export const relationTypeEnum = pgEnum('relation_type', [
  'blocks',
  'depends_on',
  'relates_to',
  'duplicates',
  'implements',
]);

export const workItemRelations = pgTable('work_item_relations', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  fromItemId: uuid('from_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  toItemId: uuid('to_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  relationType: relationTypeEnum('relation_type').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItemRelation = typeof workItemRelations.$inferSelect;
export type NewWorkItemRelation = typeof workItemRelations.$inferInsert;
