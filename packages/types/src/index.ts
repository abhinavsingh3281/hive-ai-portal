// ─── Work Item ────────────────────────────────────────────────────────────────

export type WorkItemType =
  | 'REQUIREMENT'
  | 'RESEARCH'
  | 'ARCHITECTURE'
  | 'ADR'
  | 'PHASE'
  | 'EPIC'
  | 'STORY'
  | 'TASK'
  | 'REVIEW'
  | 'TEST'
  | 'BUG'
  | 'SECURITY'
  | 'DEPLOYMENT'
  | 'INCIDENT'
  | 'RETROSPECTIVE';

export type WorkItemStatus =
  | 'created'
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'qa'
  | 'completed'
  | 'rejected'
  | 'reworking'
  | 'cancelled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';

// The prefix used in the human-readable identifier for each work item type
export const WORK_ITEM_TYPE_PREFIX: Record<WorkItemType, string> = {
  REQUIREMENT: 'REQ',
  RESEARCH: 'RES',
  ARCHITECTURE: 'ARCH',
  ADR: 'ADR',
  PHASE: 'PH',
  EPIC: 'EP',
  STORY: 'ST',
  TASK: 'TSK',
  REVIEW: 'REV',
  TEST: 'TEST',
  BUG: 'BUG',
  SECURITY: 'SEC',
  DEPLOYMENT: 'DEP',
  INCIDENT: 'INC',
  RETROSPECTIVE: 'RETRO',
};

// ─── Pipeline Enforcement ─────────────────────────────────────────────────────

// Required ancestor type before a given work item type can be created.
// Enforced by the work item service — no TASK without a parent chain
// that includes ARCHITECTURE and RESEARCH.
export const REQUIRED_ANCESTOR: Partial<Record<WorkItemType, WorkItemType[]>> = {
  RESEARCH: ['REQUIREMENT'],
  ARCHITECTURE: ['RESEARCH'],
  ADR: ['ARCHITECTURE'],
  PHASE: ['ARCHITECTURE'],
  EPIC: ['PHASE'],
  STORY: ['EPIC'],
  TASK: ['STORY'],
  REVIEW: ['TASK'],
  TEST: ['STORY'],
  DEPLOYMENT: ['PHASE'],
  RETROSPECTIVE: ['PHASE'],
};

// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentRole =
  | 'CTO'
  | 'SOLUTION_ARCHITECT'
  | 'PROGRAM_MANAGER'
  | 'BACKEND_ENGINEERING_MANAGER'
  | 'FRONTEND_ENGINEERING_MANAGER'
  | 'DEVOPS_MANAGER'
  | 'QA_MANAGER'
  | 'SECURITY_LEAD'
  | 'SENIOR_ENGINEER'
  | 'SOFTWARE_ENGINEER'
  | 'QA_ENGINEER'
  | 'RESEARCH_AGENT'
  | 'DEVOPS_ENGINEER';

export type AgentStatus = 'active' | 'paused' | 'idle' | 'running' | 'error' | 'terminated';

// ─── Heartbeat ────────────────────────────────────────────────────────────────

export type HeartbeatStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

// ─── Provider ─────────────────────────────────────────────────────────────────

export type ProviderName = 'claude' | 'claude_code' | 'gemini' | 'openai_codex' | 'gateway' | 'stub';

export interface ProviderUsage {
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costCents: number;
}
