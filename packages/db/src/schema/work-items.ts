import { jsonb, pgEnum, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { agents } from './agents';

export const workItemTypeEnum = pgEnum('work_item_type', [
  'REQUIREMENT',
  'RESEARCH',
  'ARCHITECTURE',
  'ADR',
  'PHASE',
  'EPIC',
  'STORY',
  'TASK',
  'REVIEW',
  'TEST',
  'BUG',
  'SECURITY',
  'DEPLOYMENT',
  'INCIDENT',
  'RETROSPECTIVE',
]);

export const workItemStatusEnum = pgEnum('work_item_status', [
  'created',
  'assigned',
  'in_progress',
  'review',
  'qa',
  'completed',
  'rejected',
  'reworking',
  'cancelled',
]);

export const priorityEnum = pgEnum('priority', ['low', 'medium', 'high', 'critical']);

export const workItems = pgTable('work_items', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),

  // Human-readable identifier, e.g. "REQ-1", "TASK-42"
  identifier: text('identifier').notNull(),
  itemNumber: integer('item_number').notNull(),

  type: workItemTypeEnum('type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  status: workItemStatusEnum('status').notNull().default('created'),
  priority: priorityEnum('priority').notNull().default('medium'),

  // Hierarchy — null means top-level
  parentId: uuid('parent_id'),

  // Single assignee: either an agent or a human, never both
  assigneeAgentId: uuid('assignee_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  assigneeUserId: text('assignee_user_id'),

  // Execution lock — set atomically when an agent checks out this item.
  // No FK here because heartbeat_runs and work_items have a circular dependency;
  // integrity is enforced at the application layer.
  checkoutRunId: uuid('checkout_run_id'),
  executionRunId: uuid('execution_run_id'),

  // Type-specific payload: ADR fields, research findings, architecture diagrams, etc.
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),

  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type WorkItem = typeof workItems.$inferSelect;
export type NewWorkItem = typeof workItems.$inferInsert;
