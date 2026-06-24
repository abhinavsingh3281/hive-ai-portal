import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const actorTypeEnum = pgEnum('actor_type', ['agent', 'user', 'system']);

export const activityLog = pgTable('activity_log', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  actorType: actorTypeEnum('actor_type').notNull(),
  actorId: text('actor_id').notNull(),

  // Dot-namespaced action, e.g. "work_item.status_changed", "agent.heartbeat_dispatched"
  action: text('action').notNull(),

  resourceType: text('resource_type').notNull(),
  resourceId: text('resource_id').notNull(),

  details: jsonb('details').$type<Record<string, unknown>>().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type ActivityLogEntry = typeof activityLog.$inferSelect;
export type NewActivityLogEntry = typeof activityLog.$inferInsert;
