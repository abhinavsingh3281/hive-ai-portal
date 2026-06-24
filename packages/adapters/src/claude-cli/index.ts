import { spawn } from 'child_process';
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface.js';
import { buildCliPrompt } from '../cli-prompt.js';

// Claude Code CLI adapter — spawns the local `claude` binary with --print.
// Agents get text output only (no tool-use loop); the adapter auto-posts
// the output as a comment and marks items in_progress → review.
// Use this when you want agents to run through the locally authenticated
// Claude Code session rather than a direct API key.

const MAX_OUTPUT_CHARS = 32_000;

async function runClaude(prompt: string, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--no-pager'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.stdin.write(prompt);
    proc.stdin.end();

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('claude CLI timed out'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.slice(0, MAX_OUTPUT_CHARS));
      }
    });
  });
}

async function callApi(
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
  apiBaseUrl: string,
  apiToken: string,
): Promise<void> {
  await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiToken}` },
    body: JSON.stringify(body),
  });
}

export class ClaudeCliAdapter implements Adapter {
  readonly type = 'claude-cli';

  async checkEnvironment(): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      proc.on('close', (code) => {
        resolve(code === 0
          ? { ok: true }
          : { ok: false, message: '`claude` CLI not found. Install Claude Code from claude.ai/code.' });
      });
      proc.on('error', () => {
        resolve({ ok: false, message: '`claude` CLI not found. Install Claude Code from claude.ai/code.' });
      });
    });
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const prompt = buildCliPrompt(ctx);

    const startMs = Date.now();
    let outputText: string;

    try {
      outputText = await runClaude(prompt);
    } catch (err) {
      return {
        status: 'failure',
        outputText: err instanceof Error ? err.message : String(err),
        usage: { provider: 'claude', model: 'claude-cli', inputTokens: 0, outputTokens: 0, cachedTokens: 0, costCents: 0 },
        costCents: 0,
        stopReason: 'error',
      };
    }

    // Post output as a comment and move items to review
    for (const item of ctx.assignedWorkItems) {
      await callApi('PATCH', `/api/work-items/${item.id}/status`, { companyId: ctx.companyContext.id, status: 'in_progress' }, ctx.apiBaseUrl, ctx.apiToken);
      await callApi('POST', `/api/work-items/${item.id}/comments`, {
        companyId: ctx.companyContext.id,
        content: outputText,
        authorAgentId: ctx.agentId,
      }, ctx.apiBaseUrl, ctx.apiToken);
      await callApi('PATCH', `/api/work-items/${item.id}/status`, { companyId: ctx.companyContext.id, status: 'review' }, ctx.apiBaseUrl, ctx.apiToken);
    }

    const words = outputText.split(/\s+/).length;
    const estimatedTokens = Math.round(words * 1.3);

    return {
      status: 'success',
      outputText,
      usage: {
        provider: 'claude',
        model: 'claude-cli',
        inputTokens: estimatedTokens,
        outputTokens: estimatedTokens,
        cachedTokens: 0,
        costCents: 0, // CLI usage is covered by the Claude subscription
      },
      costCents: 0,
      successSummary: `${ctx.agentName} processed ${ctx.assignedWorkItems.length} item(s) via local Claude Code CLI`,
      stopReason: 'task_complete',
    };
  }
}
