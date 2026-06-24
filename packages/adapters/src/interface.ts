import type { ProviderUsage } from '@aisc/types';

// ─── Execution Context ────────────────────────────────────────────────────────
// Everything an adapter needs to do its work. Assembled by the scheduler
// before each heartbeat dispatch.

export interface AdapterExecutionContext {
  agentId: string;
  agentName: string;
  agentRole: string;
  agentSystemPrompt: string | null;
  adapterConfig: Record<string, unknown>;

  // Active work items assigned to this agent, in priority order
  assignedWorkItems: AssignedWorkItem[];

  // Hierarchy-aware graph of work items: assigned (★) shown with full detail,
  // ancestor/sibling (·) shown as 1-line summaries. Use this instead of the
  // flat assignedWorkItems list to reduce prompt tokens by ~60-80%.
  workItemContextGraph?: string;

  companyContext: {
    id: string;
    name: string;
    goals: string | null;
  };

  // Filesystem path where the agent can read/write files for this run
  workspaceDirectory: string;

  // Opaque state from the previous heartbeat; null on first run
  sessionState: Record<string, unknown> | null;

  // Short-lived JWT the agent uses to call back into the AISC REST API
  apiToken: string;
  apiBaseUrl: string;
}

export interface AssignedWorkItem {
  id: string;
  identifier: string;
  type: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  parentId: string | null;
  metadata: Record<string, unknown>;
}

// ─── Execution Result ─────────────────────────────────────────────────────────

export type AdapterExecutionStatus = 'success' | 'failure' | 'timeout' | 'needs_human';

export interface AdapterExecutionResult {
  status: AdapterExecutionStatus;
  outputText: string;
  usage: ProviderUsage;
  costCents: number;

  // Persisted and passed back as sessionState on the next heartbeat
  sessionState?: Record<string, unknown>;

  // Human-readable one-liner for the dashboard
  successSummary?: string;

  // Why the adapter stopped ("max_turns" | "task_complete" | "error" | "blocked")
  stopReason?: string;
}

// ─── Adapter Interface ────────────────────────────────────────────────────────

export interface Adapter {
  readonly type: string;

  execute(context: AdapterExecutionContext): Promise<AdapterExecutionResult>;

  // Optional: verify the adapter is usable in the current environment
  checkEnvironment?(): Promise<{ ok: boolean; message?: string }>;
}
