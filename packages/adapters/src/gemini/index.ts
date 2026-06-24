import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type FunctionCall,
  SchemaType,
} from '@google/generative-ai';
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface.js';

// Gemini 1.5 Pro pricing: $1.25/M input, $5/M output
const INPUT_COST_PER_1M_CENTS = 125;
const OUTPUT_COST_PER_1M_CENTS = 500;

const MAX_TURNS = 20;
const MODEL = 'gemini-1.5-pro';

// ─── AISC tools in Gemini schema format ──────────────────────────────────────

const AISC_FUNCTIONS: FunctionDeclaration[] = [
  {
    name: 'get_work_item',
    description: 'Retrieve a work item including its full description and current status.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        work_item_id: { type: SchemaType.STRING, description: 'UUID of the work item' },
        company_id: { type: SchemaType.STRING, description: 'UUID of the company' },
      },
      required: ['work_item_id', 'company_id'],
    },
  },
  {
    name: 'post_comment',
    description: 'Post a comment on a work item to record progress, findings, or blockers.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        work_item_id: { type: SchemaType.STRING, description: 'UUID of the work item' },
        company_id: { type: SchemaType.STRING, description: 'UUID of the company' },
        content: { type: SchemaType.STRING, description: 'Comment body (Markdown supported)' },
      },
      required: ['work_item_id', 'company_id', 'content'],
    },
  },
  {
    name: 'update_work_item_status',
    description: 'Transition a work item status. Use in_progress when starting, completed when done, review when blocked.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        work_item_id: { type: SchemaType.STRING, description: 'UUID of the work item' },
        company_id: { type: SchemaType.STRING, description: 'UUID of the company' },
        status: { type: SchemaType.STRING, description: 'New status: in_progress | review | completed | reworking' },
      },
      required: ['work_item_id', 'company_id', 'status'],
    },
  },
  {
    name: 'create_work_item',
    description: 'Create a child work item to decompose complex tasks.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        company_id: { type: SchemaType.STRING, description: 'UUID of the company' },
        type: { type: SchemaType.STRING, description: 'TASK | BUG | TEST | REVIEW' },
        title: { type: SchemaType.STRING, description: 'Short imperative title' },
        description: { type: SchemaType.STRING, description: 'Full description' },
        parent_id: { type: SchemaType.STRING, description: 'UUID of parent work item' },
        priority: { type: SchemaType.STRING, description: 'low | medium | high | critical' },
      },
      required: ['company_id', 'type', 'title'],
    },
  },
  {
    name: 'post_to_memory',
    description: 'Persist an important finding or decision to organizational memory.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: { type: SchemaType.STRING, description: 'Knowledge to persist' },
        tags: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING }, description: 'Searchable tags' },
        source_type: { type: SchemaType.STRING, description: 'research | architecture | adr | decision | manual' },
      },
      required: ['content', 'source_type'],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

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
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AISC API ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function executeTool(
  name: string,
  args: ToolInput,
  apiBaseUrl: string,
  apiToken: string,
  companyId: string,
): Promise<unknown> {
  if (name === 'get_work_item') {
    return callApi('GET', `/api/work-items/${args.work_item_id}?companyId=${args.company_id}`, undefined, apiBaseUrl, apiToken);
  }
  if (name === 'post_comment') {
    return callApi('POST', `/api/work-items/${args.work_item_id}/comments`, { companyId: args.company_id, content: args.content }, apiBaseUrl, apiToken);
  }
  if (name === 'update_work_item_status') {
    return callApi('PATCH', `/api/work-items/${args.work_item_id}/status`, { companyId: args.company_id, status: args.status }, apiBaseUrl, apiToken);
  }
  if (name === 'create_work_item') {
    return callApi('POST', `/api/work-items`, { companyId: args.company_id, type: args.type, title: args.title, description: args.description, parentId: args.parent_id, priority: args.priority ?? 'medium' }, apiBaseUrl, apiToken);
  }
  if (name === 'post_to_memory') {
    return callApi('POST', `/api/memory`, { companyId, content: args.content, tags: args.tags ?? [], sourceType: args.source_type }, apiBaseUrl, apiToken);
  }
  return { error: `Unknown tool: ${name}` };
}

// ─── Gemini Adapter ───────────────────────────────────────────────────────────

export class GeminiAdapter implements Adapter {
  readonly type = 'gemini';

  private genai: GoogleGenerativeAI;

  constructor(apiKey: string) {
    this.genai = new GoogleGenerativeAI(apiKey);
  }

  async checkEnvironment(): Promise<{ ok: boolean; message?: string }> {
    try {
      const model = this.genai.getGenerativeModel({ model: MODEL });
      await model.generateContent('ping');
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const { getRolePrompt } = await import('../claude/role-prompts.js');
    const rolePrompt = ctx.agentSystemPrompt ?? getRolePrompt(ctx.agentRole);

    const systemInstruction = [
      `You are ${ctx.agentName}, ${ctx.agentRole} at ${ctx.companyContext.name}.`,
      ctx.companyContext.goals ? `Company goals: ${ctx.companyContext.goals}` : '',
      rolePrompt,
      '\nHow to use your tools:',
      '- Call update_work_item_status("in_progress") before starting any item.',
      '- Call post_comment frequently to record findings, decisions, and blockers.',
      '- Call post_to_memory for insights that should inform future work.',
      '- Mark items "completed" only when genuinely done.',
    ].filter(Boolean).join('\n');

    const initialUser = [
      'You have the following work items assigned:\n',
      ...ctx.assignedWorkItems.map((item) =>
        `### [${item.identifier}] ${item.title}\n- ID: ${item.id}\n- Company ID: ${ctx.companyContext.id}\n- Type: ${item.type}\n- Status: ${item.status}\n- Priority: ${item.priority}\n${item.description ? `- Description: ${item.description}\n` : ''}`,
      ),
      '\nWork through these items. Start each by calling update_work_item_status to mark it in_progress.',
    ].join('\n');

    const model = this.genai.getGenerativeModel({
      model: MODEL,
      systemInstruction,
      tools: [{ functionDeclarations: AISC_FUNCTIONS }],
    });

    const history: Content[] = ctx.sessionState?.history as Content[] ?? [];
    const chat = model.startChat({ history });

    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let turns = 0;
    let stopReason = 'max_turns';
    let lastText = '';

    let currentMessage: string | Part[] = initialUser;

    while (turns < MAX_TURNS) {
      turns++;

      const result = await chat.sendMessage(currentMessage);
      const response = result.response;

      totalInputTokens += response.usageMetadata?.promptTokenCount ?? 0;
      totalOutputTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

      const parts = response.candidates?.[0]?.content.parts ?? [];
      const functionCalls = parts.filter((p): p is Part & { functionCall: FunctionCall } => !!p.functionCall);
      const textParts = parts.filter((p) => p.text);

      if (textParts.length > 0) {
        lastText = textParts.map((p) => p.text ?? '').join('');
      }

      if (functionCalls.length === 0) {
        stopReason = 'task_complete';
        break;
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        functionCalls.map(async (part) => {
          const fnName = part.functionCall.name;
          const fnArgs = part.functionCall.args as ToolInput;
          let output: unknown;
          try {
            output = await executeTool(fnName, fnArgs, ctx.apiBaseUrl, ctx.apiToken, ctx.companyContext.id);
          } catch (err) {
            output = { error: err instanceof Error ? err.message : String(err) };
          }
          return { functionResponse: { name: fnName, response: { content: output } } } as Part;
        }),
      );

      currentMessage = toolResults;
    }

    const history2 = await chat.getHistory();
    const costCents = Math.round(
      (totalInputTokens / 1_000_000) * INPUT_COST_PER_1M_CENTS +
      (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_1M_CENTS,
    );

    return {
      status: 'success',
      outputText: lastText || `[${ctx.agentName}] Completed ${turns} turn(s) via Gemini.`,
      usage: {
        provider: 'gemini',
        model: MODEL,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cachedTokens: 0,
        costCents,
      },
      costCents,
      successSummary: `${ctx.agentName} processed ${ctx.assignedWorkItems.length} item(s) in ${turns} turn(s) via Gemini`,
      stopReason,
      sessionState: { history: history2.slice(-30) },
    };
  }
}
