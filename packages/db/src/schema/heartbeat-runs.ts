import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { agents } from './agents';

export const heartbeatStatusEnum = pgEnum('heartbeat_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'timed_out',
]);

export const heartbeatRuns = pgTable('heartbeat_runs', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),

  // Which work item this run was addressing (null = general agent wakeup)
  workItemId: uuid('work_item_id'),

  status: heartbeatStatusEnum('status').notNull().default('queued'),

  queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),

  // Provider used for this run
  provider: text('provider'),
  model: text('model'),

  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  costCents: integer('cost_cents').notNull().default(0),

  successSummary: text('success_summary'),
  stopReason: text('stop_reason'),
  errorMessage: text('error_message'),

  // Persisted so the next heartbeat can resume where this one left off
  sessionState: jsonb('session_state').$type<Record<string, unknown>>(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type HeartbeatRun = typeof heartbeatRuns.$inferSelect;
export type NewHeartbeatRun = typeof heartbeatRuns.$inferInsert;
