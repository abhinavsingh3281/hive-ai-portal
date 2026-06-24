import Anthropic from '@anthropic-ai/sdk';
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface.js';
import { getRolePrompt } from './role-prompts.js';

// Pricing: Opus 4.8 = $5/M input, $25/M output (in microdollars → cents: /10)
const INPUT_COST_PER_1M_CENTS = 500;   // $5.00 = 500 cents
const OUTPUT_COST_PER_1M_CENTS = 2500; // $25.00 = 2500 cents

const MAX_TURNS = 20;
const MAX_TOKENS = 16_000;

// ─── AISC API Tool Definitions ────────────────────────────────────────────────

const AISC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_work_item',
    description: 'Retrieve a work item including its full description, status, and metadata.',
    input_schema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'string', description: 'UUID of the work item' },
        company_id: { type: 'string', description: 'UUID of the company' },
      },
      required: ['work_item_id', 'company_id'],
    },
  },
  {
    name: 'post_comment',
    description: 'Post a comment on a work item to record progress, findings, decisions, or blockers. Use this to keep stakeholders informed as you work.',
    input_schema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'string', description: 'UUID of the work item to comment on' },
        company_id: { type: 'string', description: 'UUID of the company' },
        content: { type: 'string', description: 'Comment body (Markdown supported)' },
      },
      required: ['work_item_id', 'company_id', 'content'],
    },
  },
  {
    name: 'update_work_item_status',
    description: 'Transition a work item to a new status. Call with "in_progress" when you start, "completed" when work is done, "review" when it needs human review.',
    input_schema: {
      type: 'object',
      properties: {
        work_item_id: { type: 'string', description: 'UUID of the work item' },
        company_id: { type: 'string', description: 'UUID of the company' },
        status: {
          type: 'string',
          enum: ['in_progress', 'review', 'completed', 'reworking'],
          description: 'Target status',
        },
      },
      required: ['work_item_id', 'company_id', 'status'],
    },
  },
  {
    name: 'create_work_item',
    description: 'Create a child work item under a parent to decompose complex tasks. Only create items you intend to work on in this session or want to hand off to other agents.',
    input_schema: {
      type: 'object',
      properties: {
        company_id: { type: 'string', description: 'UUID of the company' },
        type: {
          type: 'string',
          enum: ['TASK', 'BUG', 'TEST', 'REVIEW'],
          description: 'Type of work item to create',
        },
        title: { type: 'string', description: 'Short, imperative title' },
        description: { type: 'string', description: 'Full description of what needs to be done' },
        parent_id: { type: 'string', description: 'UUID of the parent work item' },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'critical'],
          description: 'Priority level (default: medium)',
        },
      },
      required: ['company_id', 'type', 'title'],
    },
  },
  {
    name: 'post_to_memory',
    description: 'Persist an important finding, decision, or piece of knowledge to the organizational memory. Use this for insights that should inform future work across the company — architectural decisions, research conclusions, lessons learned, key constraints.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The knowledge to persist (Markdown supported)' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Searchable tags, e.g. ["authentication", "security", "database"]',
        },
        source_type: {
          type: 'string',
          enum: ['research', 'architecture', 'adr', 'retrospective', 'decision', 'manual'],
          description: 'Category of memory',
        },
      },
      required: ['content', 'source_type'],
    },
  },
];

// ─── Tool Executor ────────────────────────────────────────────────────────────

type ToolInput = Record<string, unknown>;

async function callApi(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  body: unknown,
  apiBaseUrl: string,
  apiToken: string,
): Promise<unknown> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiToken}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AISC API ${method} ${path} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function executeTool(
  name: string,
  input: ToolInput,
  apiBaseUrl: string,
  apiToken: string,
  companyId: string,
): Promise<string> {
  try {
    let result: unknown;

    if (name === 'get_work_item') {
      result = await callApi(
        'GET',
        `/api/work-items/${input.work_item_id}?companyId=${input.company_id}`,
        undefined,
        apiBaseUrl,
        apiToken,
      );
    } else if (name === 'post_comment') {
      result = await callApi(
        'POST',
        `/api/work-items/${input.work_item_id}/comments`,
        { companyId: input.company_id, content: input.content },
        apiBaseUrl,
        apiToken,
      );
    } else if (name === 'update_work_item_status') {
      result = await callApi(
        'PATCH',
        `/api/work-items/${input.work_item_id}/status`,
        { companyId: input.company_id, status: input.status },
        apiBaseUrl,
        apiToken,
      );
    } else if (name === 'create_work_item') {
      result = await callApi(
        'POST',
        `/api/work-items`,
        {
          companyId: input.company_id,
          type: input.type,
          title: input.title,
          description: input.description,
          parentId: input.parent_id,
          priority: input.priority ?? 'medium',
        },
        apiBaseUrl,
        apiToken,
      );
    } else if (name === 'post_to_memory') {
      result = await callApi(
        'POST',
        `/api/memory`,
        {
          companyId,
          content: input.content,
          tags: input.tags ?? [],
          sourceType: input.source_type,
        },
        apiBaseUrl,
        apiToken,
      );
    } else {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return JSON.stringify({ error: message });
  }
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AdapterExecutionContext): string {
  const lines: string[] = [
    `You are ${ctx.agentName}, ${ctx.agentRole} at ${ctx.companyContext.name}.`,
    '',
  ];

  if (ctx.companyContext.goals) {
    lines.push(`**Company goals:** ${ctx.companyContext.goals}`, '');
  }

  // Custom prompt takes precedence; fall back to the role default
  const roleOrCustomPrompt = ctx.agentSystemPrompt ?? getRolePrompt(ctx.agentRole);
  if (roleOrCustomPrompt) {
    lines.push(roleOrCustomPrompt, '');
  }

  lines.push(
    '## How to use your tools',
    '- Call `update_work_item_status` with `in_progress` before starting any item.',
    '- Call `post_comment` as you work — record findings, decisions, and blockers.',
    '- Call `post_to_memory` for insights that should inform future work company-wide.',
    '- Call `create_work_item` to decompose complex items into smaller sub-tasks.',
    '- Mark items `completed` only when the work is genuinely done per the acceptance criteria.',
    '- If blocked, mark the item `review` and leave a detailed comment explaining what you need.',
  );

  return lines.join('\n');
}

function buildInitialMessage(ctx: AdapterExecutionContext): string {
  const lines: string[] = [];

  // Use the graph view when available — shows hierarchy context with fewer tokens
  if (ctx.workItemContextGraph) {
    lines.push(
      'Here is your work item hierarchy (★ = assigned to you, · = parent/sibling context):',
      '',
      ctx.workItemContextGraph,
      '',
      'Your assigned items (full detail for tool calls):',
      '',
    );
  } else {
    lines.push('You have the following work items assigned to you:', '');
  }

  for (const item of ctx.assignedWorkItems) {
    lines.push(
      `### [${item.identifier}] ${item.title}`,
      `- **ID:** ${item.id}`,
      `- **Company ID:** ${ctx.companyContext.id}`,
      `- **Type:** ${item.type}`,
      `- **Status:** ${item.status}`,
      `- **Priority:** ${item.priority}`,
      item.description ? `- **Description:** ${item.description}` : '',
      item.parentId ? `- **Parent ID:** ${item.parentId}` : '',
      '',
    );
  }

  lines.push('Please work through these items. Start each item by calling `update_work_item_status` to mark it `in_progress`, then do the work and post comments as you go.');

  return lines.filter((l) => l !== null).join('\n');
}

// ─── Claude Adapter ───────────────────────────────────────────────────────────

export class ClaudeAdapter implements Adapter {
  readonly type = 'claude';

  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async checkEnvironment(): Promise<{ ok: boolean; message?: string }> {
    try {
      await this.client.models.retrieve('claude-opus-4-8');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: buildInitialMessage(ctx) },
    ];

    // Restore session — inject prior conversation turns if present
    if (ctx.sessionState?.messages) {
      const prior = ctx.sessionState.messages as Anthropic.MessageParam[];
      messages.unshift(...prior);
    }

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turns = 0;
    let stopReason = 'max_turns';
    let lastText = '';

    while (turns < MAX_TURNS) {
      turns++;

      const stream = this.client.messages.stream({
        model: 'claude-opus-4-8',
        thinking: { type: 'enabled', budget_tokens: 5000 },
        max_tokens: MAX_TOKENS,
        system: buildSystemPrompt(ctx),
        messages,
        tools: AISC_TOOLS,
      });

      const msg = await stream.finalMessage();

      totalInputTokens += msg.usage.input_tokens;
      totalOutputTokens += msg.usage.output_tokens;

      // Collect assistant turn
      messages.push({ role: 'assistant', content: msg.content });

      // Accumulate text output
      for (const block of msg.content) {
        if (block.type === 'text') {
          lastText = block.text;
        }
      }

      if (msg.stop_reason === 'end_turn') {
        stopReason = 'task_complete';
        break;
      }

      if (msg.stop_reason !== 'tool_use') {
        stopReason = msg.stop_reason ?? 'unknown';
        break;
      }

      // Execute tool calls and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of msg.content) {
        if (block.type !== 'tool_use') continue;

        const output = await executeTool(
          block.name,
          block.input as ToolInput,
          ctx.apiBaseUrl,
          ctx.apiToken,
          ctx.companyContext.id,
        );

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: output,
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    const costCents = Math.round(
      (totalInputTokens / 1_000_000) * INPUT_COST_PER_1M_CENTS +
      (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_1M_CENTS,
    );

    return {
      status: 'success',
      outputText: lastText || `[${ctx.agentName}] Completed ${turns} turn(s).`,
      usage: {
        provider: 'claude',
        model: 'claude-opus-4-8',
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cachedTokens: 0,
        costCents,
      },
      costCents,
      successSummary: `${ctx.agentName} processed ${ctx.assignedWorkItems.length} item(s) in ${turns} turn(s)`,
      stopReason,
      // Persist last N messages so agent can resume with context
      sessionState: { messages: messages.slice(-40) },
    };
  }
}
