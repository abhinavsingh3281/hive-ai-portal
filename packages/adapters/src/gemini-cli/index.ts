import { spawn } from 'child_process';
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface.js';
import { buildCliPrompt } from '../cli-prompt.js';

// Gemini CLI adapter — spawns the local `gemini` binary.
// Install: npm install -g @google/gemini-cli
// Auth:    Pass GEMINI_API_KEY (preferred) or set GEMINI_API_KEY env var.
//          Google OAuth sign-in is no longer supported for individuals.
//
// Free tier: generous daily quota via API key from aistudio.google.com/apikey

const MAX_OUTPUT_CHARS = 32_000;

async function runGemini(prompt: string, apiKey: string | undefined, timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (apiKey) env['GEMINI_API_KEY'] = apiKey;

    const proc = spawn('gemini', ['--prompt', prompt], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('gemini CLI timed out'));
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`gemini exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.slice(0, MAX_OUTPUT_CHARS));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn gemini: ${err.message}. Run: npm install -g @google/gemini-cli`));
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

export class GeminiCliAdapter implements Adapter {
  readonly type = 'gemini-cli';

  constructor(private apiKey?: string) {}

  async checkEnvironment(): Promise<{ ok: boolean; message?: string }> {
    const key = this.apiKey ?? process.env['GEMINI_API_KEY'];
    if (!key) {
      return { ok: false, message: 'No Gemini API key set. Enter your key from aistudio.google.com/apikey.' };
    }
    return new Promise((resolve) => {
      const proc = spawn('gemini', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, GEMINI_API_KEY: key },
      });
      proc.on('close', (code) => {
        resolve(code === 0
          ? { ok: true }
          : { ok: false, message: '`gemini` binary not found. Run: npm install -g @google/gemini-cli' });
      });
      proc.on('error', () => {
        resolve({ ok: false, message: '`gemini` binary not found. Run: npm install -g @google/gemini-cli' });
      });
    });
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    const prompt = buildCliPrompt(ctx);
    const key = this.apiKey ?? process.env['GEMINI_API_KEY'];
    let outputText: string;

    try {
      outputText = await runGemini(prompt, key);
    } catch (err) {
      return {
        status: 'failure',
        outputText: err instanceof Error ? err.message : String(err),
        usage: { provider: 'gemini', model: 'gemini-cli', inputTokens: 0, outputTokens: 0, cachedTokens: 0, costCents: 0 },
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
      usage: { provider: 'gemini', model: 'gemini-cli', inputTokens: estimatedTokens, outputTokens: estimatedTokens, cachedTokens: 0, costCents: 0 },
      costCents: 0,
      successSummary: `${ctx.agentName} processed ${ctx.assignedWorkItems.length} item(s) via Gemini CLI`,
      stopReason: 'task_complete',
    };
  }
}
