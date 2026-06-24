import { spawn } from 'child_process';
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface.js';
import { buildCliPrompt } from '../cli-prompt.js';

// Antigravity CLI adapter — spawns the local `agy` binary (Google Antigravity CLI).
// Install: curl -fsSL https://antigravity.google/cli/install.sh | bash
// Auth:    runs `agy` once and follows the TUI setup (Google account, no API key needed).
// Free tier with generous quota.
//
// Like the claude-cli adapter: one inference call per heartbeat,
// posts output as a comment, and moves the item to "review".

const MAX_OUTPUT_CHARS = 32_000;

async function runAgy(prompt: string, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    // agy --print takes the prompt as a positional argument
    const proc = spawn('agy', ['--print', prompt, '--dangerously-skip-permissions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('agy timed out after ' + timeoutMs / 1000 + 's'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`agy exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.slice(0, MAX_OUTPUT_CHARS));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(
        `Failed to spawn agy: ${err.message}. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash`
      ));
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

export class AntigravityCliAdapter implements Adapter {
  readonly type = 'antigravity-cli';

  async checkEnvironment(): Promise<{ ok: boolean; message?: string }> {
    return new Promise((resolve) => {
      const proc = spawn('agy', ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.on('close', (code) => {
        resolve(code === 0
          ? { ok: true }
          : { ok: false, message: '`agy` not found. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash' });
      });
      proc.on('error', () => {
        resolve({ ok: false, message: '`agy` not found. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash' });
      });
      void stdout;
    });
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const prompt = buildCliPrompt(ctx);

    let outputText: string;

    try {
      outputText = await runAgy(prompt);
    } catch (err) {
      return {
        status: 'failure',
        outputText: err instanceof Error ? err.message : String(err),
        usage: { provider: 'gemini', model: 'antigravity-cli', inputTokens: 0, outputTokens: 0, cachedTokens: 0, costCents: 0 },
        costCents: 0,
        stopReason: 'error',
      };
    }

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
        provider: 'gemini',
        model: 'antigravity-cli',
        inputTokens: estimatedTokens,
        outputTokens: estimatedTokens,
        cachedTokens: 0,
        costCents: 0,
      },
      costCents: 0,
      successSummary: `${ctx.agentName} processed ${ctx.assignedWorkItems.length} item(s) via Antigravity CLI`,
      stopReason: 'task_complete',
    };
  }
}
