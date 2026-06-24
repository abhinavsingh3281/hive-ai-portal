import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { companies } from './companies';
import { agents } from './agents';
import { heartbeatRuns } from './heartbeat-runs';

export const costEvents = pgTable('cost_events', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  heartbeatRunId: uuid('heartbeat_run_id').references(() => heartbeatRuns.id, { onDelete: 'set null' }),

  provider: text('provider').notNull(),
  model: text('model').notNull(),

  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  costCents: integer('cost_cents').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type CostEvent = typeof costEvents.$inferSelect;
export type NewCostEvent = typeof costEvents.$inferInsert;
