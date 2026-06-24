import { eq, and, inArray, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { agents, companies, workItems, heartbeatRuns, costEvents } from '@aisc/db';
import type { Db, Agent, WorkItem } from '@aisc/db';
import type { Config } from '../config.js';
import { AdapterRegistry } from '../adapters/registry.js';
import type { AdapterExecutionContext } from '@aisc/adapters';
import { logActivity } from '../services/activity-log.js';
import { buildContextGraph, serializeContextGraph } from '../services/context-graph.js';

export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private registry: AdapterRegistry;

  constructor(private db: Db, private config: Config, registry?: AdapterRegistry) {
    this.registry = registry ?? new AdapterRegistry(config);
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.SCHEDULER_INTERVAL_MS);
    console.log(`[Scheduler] Started — polling every ${this.config.SCHEDULER_INTERVAL_MS}ms`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log('[Scheduler] Stopped');
  }

  private async tick() {
    if (this.running) return; // Skip if previous tick is still in flight
    this.running = true;

    try {
      const readyAgents = await this.findReadyAgents();
      await Promise.allSettled(readyAgents.map((a) => this.dispatchHeartbeat(a)));
    } catch (err) {
      console.error('[Scheduler] Tick error:', err);
    } finally {
      this.running = false;
    }
  }

  // Find agents that are active, not already running, and have assigned work
  private async findReadyAgents(): Promise<Agent[]> {
    const activeAgents = await this.db.query.agents.findMany({
      where: inArray(agents.status, ['active', 'idle']),
    });

    const ready: Agent[] = [];
    for (const agent of activeAgents) {
      const hasWork = await this.db.query.workItems.findFirst({
        where: and(
          eq(workItems.assigneeAgentId, agent.id),
          inArray(workItems.status, ['assigned', 'in_progress']),
        ),
      });
      if (hasWork) ready.push(agent);
    }

    return ready;
  }

  async wake(agentId: string) {
    const agent = await this.db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    if (!agent) throw new Error(`Agent ${agentId} not found`);
    // Fire-and-forget; errors are logged inside dispatchHeartbeat
    void this.dispatchHeartbeat(agent);
  }

  private async dispatchHeartbeat(agent: Agent) {
    const runId = uuidv4();

    // Create the run record before dispatching so we have a lock anchor
    await this.db.insert(heartbeatRuns).values({
      id: runId,
      companyId: agent.companyId,
      agentId: agent.id,
      status: 'running',
      startedAt: new Date(),
    });

    await this.db.update(agents).set({ status: 'running', updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    const startMs = Date.now();

    try {
      let context: AdapterExecutionContext;
      try {
        context = await this.buildContext(agent, runId);
      } catch (err) {
        // All items are blocked — abort cleanly without writing a failure run
        if (err instanceof Error && err.message === 'all_items_blocked') {
          await this.db.update(heartbeatRuns)
            .set({ status: 'cancelled', completedAt: new Date(), durationMs: 0, stopReason: 'blocked', updatedAt: new Date() })
            .where(eq(heartbeatRuns.id, runId));
          return;
        }
        throw err;
      }

      const adapter = this.registry.get(agent.adapterType);

      if (!adapter) {
        throw new Error(`No adapter registered for type: ${agent.adapterType}`);
      }

      const result = await adapter.execute(context);

      const durationMs = Date.now() - startMs;

      await this.db.update(heartbeatRuns)
        .set({
          status: result.status === 'success' ? 'succeeded' : 'failed',
          completedAt: new Date(),
          durationMs,
          provider: result.usage.provider,
          model: result.usage.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedInputTokens: result.usage.cachedTokens,
          costCents: result.costCents,
          successSummary: result.successSummary,
          stopReason: result.stopReason,
          sessionState: result.sessionState,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      if (result.costCents > 0) {
        await this.db.insert(costEvents).values({
          companyId: agent.companyId,
          agentId: agent.id,
          heartbeatRunId: runId,
          provider: result.usage.provider,
          model: result.usage.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          cachedTokens: result.usage.cachedTokens,
          costCents: result.costCents,
        });
      }

      await logActivity({
        db: this.db,
        companyId: agent.companyId,
        actorType: 'system',
        actorId: 'scheduler',
        action: 'heartbeat.completed',
        resourceType: 'agent',
        resourceId: agent.id,
        details: { runId, status: result.status, durationMs, costCents: result.costCents },
      });

    } catch (err) {
      const durationMs = Date.now() - startMs;
      const message = err instanceof Error ? err.message : String(err);

      await this.db.update(heartbeatRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          durationMs,
          errorMessage: message,
          updatedAt: new Date(),
        })
        .where(eq(heartbeatRuns.id, runId));

      console.error(`[Scheduler] Heartbeat failed for agent ${agent.id}:`, message);
    } finally {
      await this.db.update(agents)
        .set({ status: 'idle', lastHeartbeatAt: new Date(), updatedAt: new Date() })
        .where(eq(agents.id, agent.id));
    }
  }

  // Walk the parent chain; return true if the item should be skipped because
  // an ancestor is rejected, cancelled, or doesn't exist.
  private async isBlocked(item: WorkItem): Promise<boolean> {
    if (!item.parentId) return false;

    const parent = await this.db.query.workItems.findFirst({
      where: eq(workItems.id, item.parentId),
    });

    if (!parent) return true; // orphan — skip
    if (parent.status === 'rejected' || parent.status === 'cancelled') return true;

    return this.isBlocked(parent);
  }

  private async buildContext(agent: Agent, runId: string): Promise<AdapterExecutionContext> {
    const company = await this.db.query.companies.findFirst({
      where: eq(companies.id, agent.companyId),
    });

    if (!company) throw new Error(`Company ${agent.companyId} not found`);

    const rawAssigned = await this.db.query.workItems.findMany({
      where: and(
        eq(workItems.assigneeAgentId, agent.id),
        inArray(workItems.status, ['assigned', 'in_progress']),
      ),
      orderBy: workItems.createdAt,
    });

    // Filter out items whose ancestor chain is rejected or cancelled
    const blockedResults = await Promise.all(rawAssigned.map((i) => this.isBlocked(i)));
    const assignedItems = rawAssigned.filter((_, idx) => !blockedResults[idx]);

    if (assignedItems.length === 0 && rawAssigned.length > 0) {
      console.log(`[Scheduler] Agent ${agent.id}: all ${rawAssigned.length} item(s) are blocked — skipping dispatch`);
      throw new Error('all_items_blocked');
    }

    // Build a hierarchy-aware context graph: assigned items (full detail) +
    // ancestor/sibling summaries via recursive CTE. Far fewer tokens than a flat list.
    const contextRoots = await buildContextGraph(
      this.db,
      assignedItems.map((i) => i.id),
      agent.companyId,
    );
    const contextGraphText = serializeContextGraph(contextRoots);

    // Load last session state from the most recent successful run
    const lastRun = await this.db
      .select()
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.agentId, agent.id), eq(heartbeatRuns.status, 'succeeded')))
      .orderBy(desc(heartbeatRuns.completedAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    return {
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      agentSystemPrompt: agent.systemPrompt,
      adapterConfig: (agent.adapterConfig as Record<string, unknown>) ?? {},
      assignedWorkItems: assignedItems.map((item) => ({
        id: item.id,
        identifier: item.identifier,
        type: item.type,
        title: item.title,
        description: item.description,
        status: item.status,
        priority: item.priority,
        parentId: item.parentId,
        metadata: (item.metadata as Record<string, unknown>) ?? {},
      })),
      // Compact graph text passed alongside flat list so adapters can use either.
      // CLI adapters use this directly; the Claude agentic adapter uses both.
      workItemContextGraph: contextGraphText,
      companyContext: {
        id: company.id,
        name: company.name,
        goals: company.goals,
      },
      workspaceDirectory: `.aisc/workspaces/${agent.id}`,
      sessionState: (lastRun?.sessionState as Record<string, unknown>) ?? null,
      apiToken: this.generateAgentToken(agent.id),
      apiBaseUrl: `http://localhost:${this.config.PORT}`,
    };
  }

  private generateAgentToken(agentId: string): string {
    // For V1: simple bearer token. Replace with JWT signing in production.
    return Buffer.from(`agent:${agentId}:${this.config.JWT_SECRET}`).toString('base64');
  }
}
