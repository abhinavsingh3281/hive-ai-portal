import type { Adapter } from '@aisc/adapters';
import { ClaudeAdapter, GeminiAdapter, ClaudeCliAdapter, GeminiCliAdapter, AntigravityCliAdapter } from '@aisc/adapters';
import type { Config } from '../config.js';

export class AdapterRegistry {
  private adapters = new Map<string, Adapter>();

  constructor(private config: Config) {
    this.registerBuiltIns();
  }

  register(adapter: Adapter) {
    this.adapters.set(adapter.type, adapter);
  }

  get(type: string): Adapter | undefined {
    return this.adapters.get(type);
  }

  list(): string[] {
    return [...this.adapters.keys()];
  }

  // Hot-connect an API-key adapter without restarting the server.
  // Returns the new status after registering.
  async connect(type: string, apiKey: string): Promise<{ ok: boolean; message?: string }> {
    let adapter: Adapter;

    if (type === 'claude') {
      adapter = new ClaudeAdapter(apiKey);
    } else if (type === 'gemini') {
      adapter = new GeminiAdapter(apiKey);
    } else if (type === 'gemini-cli') {
      adapter = new GeminiCliAdapter(apiKey);
    } else if (type === 'antigravity-cli') {
      return { ok: false, message: 'Antigravity CLI uses Google account auth — no API key needed.' };
    } else {
      return { ok: false, message: `Cannot hot-connect adapter type: ${type}` };
    }

    const check = adapter.checkEnvironment
      ? await adapter.checkEnvironment()
      : { ok: true };

    if (check.ok) {
      this.register(adapter);
    }

    return check;
  }

  private registerBuiltIns() {
    this.register({
      type: 'stub',
      async execute(context) {
        return {
          status: 'success',
          outputText: `[stub] Agent ${context.agentName} (${context.agentRole}) processed ${context.assignedWorkItems.length} item(s).`,
          usage: { provider: 'stub', model: 'stub', inputTokens: 0, outputTokens: 0, cachedTokens: 0, costCents: 0 },
          costCents: 0,
          successSummary: `Stub run for ${context.agentName}`,
          stopReason: 'task_complete',
        };
      },
    });

    if (this.config.ANTHROPIC_API_KEY) {
      this.register(new ClaudeAdapter(this.config.ANTHROPIC_API_KEY));
    }

    if (this.config.GOOGLE_API_KEY) {
      this.register(new GeminiAdapter(this.config.GOOGLE_API_KEY));
    }

    this.register(new ClaudeCliAdapter());
    this.register(new GeminiCliAdapter());
    this.register(new AntigravityCliAdapter());
  }

  async listWithStatus(): Promise<Array<{ type: string; ok: boolean; message?: string }>> {
    return Promise.all(
      [...this.adapters.entries()].map(async ([type, adapter]) => {
        if (!adapter.checkEnvironment) return { type, ok: true };
        const check = await adapter.checkEnvironment();
        return { type, ...check };
      }),
    );
  }
}
