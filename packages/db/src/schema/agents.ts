import { jsonb, pgEnum, pgTable, text, timestamp, uuid, integer } from 'drizzle-orm/pg-core';
import { companies } from './companies';

export const agentRoleEnum = pgEnum('agent_role', [
  'CTO',
  'SOLUTION_ARCHITECT',
  'PROGRAM_MANAGER',
  'BACKEND_ENGINEERING_MANAGER',
  'FRONTEND_ENGINEERING_MANAGER',
  'DEVOPS_MANAGER',
  'QA_MANAGER',
  'SECURITY_LEAD',
  'SENIOR_ENGINEER',
  'SOFTWARE_ENGINEER',
  'QA_ENGINEER',
  'RESEARCH_AGENT',
  'DEVOPS_ENGINEER',
]);

export const agentStatusEnum = pgEnum('agent_status', [
  'active',
  'paused',
  'idle',
  'running',
  'error',
  'terminated',
]);

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: agentRoleEnum('role').notNull(),
  title: text('title').notNull(),
  status: agentStatusEnum('status').notNull().default('idle'),

  // Org hierarchy — null means this agent reports directly to the CEO (human)
  reportsTo: uuid('reports_to'),

  // Which AI adapter backs this agent (e.g., "claude_code", "gemini", "gateway")
  adapterType: text('adapter_type').notNull().default('claude_code'),
  adapterConfig: jsonb('adapter_config').$type<Record<string, unknown>>().default({}),
  runtimeConfig: jsonb('runtime_config').$type<Record<string, unknown>>().default({}),

  capabilities: text('capabilities'),
  systemPrompt: text('system_prompt'),

  // Monthly token budget in cents; null = unlimited
  budgetMonthlyCents: integer('budget_monthly_cents'),

  lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
