import type { AdapterExecutionContext } from './interface.js';
import { getRolePrompt } from './claude/role-prompts.js';

// Shared prompt builder for all CLI adapters (claude-cli, gemini-cli, antigravity-cli).
// Uses workItemContextGraph (hierarchy-aware tree) when available — much fewer tokens
// than the flat item list. Falls back to flat list if graph wasn't built.
export function buildCliPrompt(ctx: AdapterExecutionContext): string {
  const rolePrompt = ctx.agentSystemPrompt ?? getRolePrompt(ctx.agentRole);

  const workSection = ctx.workItemContextGraph
    ? [
        'Work item hierarchy (★ = assigned to you, · = context):',
        ctx.workItemContextGraph,
        '',
        'Focus on the ★ items. The · items are parent/sibling context — understand where your work fits in the bigger picture.',
      ].join('\n')
    : [
        'Work items assigned to you:',
        ctx.assignedWorkItems
          .map((i) => `[${i.identifier}] ${i.title} (${i.type} · ${i.priority})\n${i.description ?? ''}`)
          .join('\n\n'),
      ].join('\n');

  return [
    `You are ${ctx.agentName}, ${ctx.agentRole} at ${ctx.companyContext.name}.`,
    ctx.companyContext.goals ? `Company goals: ${ctx.companyContext.goals}` : '',
    rolePrompt,
    '',
    workSection,
    '',
    'Produce a detailed response for each assigned work item: your analysis, findings, recommendations, and next steps. Be specific and actionable.',
  ].filter(Boolean).join('\n');
}
