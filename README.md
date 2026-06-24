<div align="center">

# 🐝 hive-ai-portal

**Your entire engineering team. Zero salaries.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-20%2B-green?logo=node.js)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-9%2B-orange?logo=pnpm)](https://pnpm.io)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

<br/>

> Give it a goal. Watch 13 AI agents plan, build, review, and ship — autonomously.

<br/>

[**Quick Install**](#-one-command-install) · [**How it works**](#-how-it-works) · [**Adapters**](#-adapters) · [**Docs**](#-api) · [**Roadmap**](#-roadmap)

</div>

---

## ✨ What is this?

AISC spins up a **virtual software company** where every role — CTO, Architect, Engineers, QA, DevOps, Security — is an AI agent with its own:

- 🧠 **Role-specific system prompt** — each agent thinks like its job title
- 💾 **Persistent organizational memory** — agents share knowledge across runs
- 💰 **Budget cap** — monthly cost limits per agent, tracked to the cent
- 🔌 **Pluggable AI backend** — swap between Claude API, Gemini, or free local CLIs per agent, without restarting

You create a company, set goals, assign work items — the agents take it from there.

---

## ⚡ One-command install

**macOS / Linux:**
```bash
git clone https://github.com/abhinavhissar/aisc.git && cd aisc
chmod +x install.sh && ./install.sh
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/abhinavhissar/aisc.git; cd aisc
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Both scripts ask for consent, then handle everything: Node.js · pnpm · PostgreSQL (Docker) · `.env` · migrations · launch.

> **Requires:** [Docker Desktop](https://docs.docker.com/get-docker/) installed and running.

---

## 🎯 How it works

```
You create a work item  →  Scheduler picks it up (every 15s)
       │
       ▼
Context Graph Builder
  Runs a PostgreSQL recursive CTE to build a hierarchy-aware
  tree of the work item and all its ancestors/siblings.
  (★ assigned item gets full detail · others are 1-line summaries)
  Result: 60–80% fewer tokens than passing raw JSON
       │
       ▼
Agent dispatched with:
  · Their role system prompt
  · The context tree
  · Org memory relevant to this item
  · A JWT token to call back into the REST API
       │
       ▼
Agent works, writes results back via API
  · Updates work item status
  · Posts comments
  · Writes to organizational memory
  · Usage + cost recorded
```

### Work item pipeline

```
REQUIREMENT → RESEARCH → ARCHITECTURE → ADR
PHASE → EPIC → STORY → TASK → BUG / REVIEW / TEST
DEPLOYMENT → INCIDENT → RETROSPECTIVE
```

Each item flows: `created → assigned → in_progress → review → qa → completed`

The scheduler **blocks downstream work** if a parent is rejected or cancelled — agents never work on orphaned tasks.

---

## 🤖 Agent roles

| Agent | What they do |
|---|---|
| `CTO` | Technical strategy, unblocking teams, big decisions |
| `SOLUTION_ARCHITECT` | System design, ADRs, cross-service consistency |
| `PROGRAM_MANAGER` | Epics, priorities, timelines, stakeholder updates |
| `BACKEND_ENGINEERING_MANAGER` | Backend coordination, code review, standards |
| `FRONTEND_ENGINEERING_MANAGER` | Frontend coordination, design system, UX quality |
| `DEVOPS_MANAGER` | CI/CD, infrastructure, deployment pipelines |
| `QA_MANAGER` | Test strategy, quality gates, bug triage |
| `SECURITY_LEAD` | Threat modeling, security reviews, compliance |
| `SENIOR_ENGINEER` | Complex implementation, architectural guidance |
| `SOFTWARE_ENGINEER` | Story-level implementation, unit tests |
| `QA_ENGINEER` | Test writing, bug reports, acceptance testing |
| `RESEARCH_AGENT` | Technology evaluation, feasibility studies |
| `DEVOPS_ENGINEER` | Infrastructure provisioning, monitoring |

System prompts are built-in but **fully overridable per agent** from the Settings UI.

---

## 🔌 Adapters

Agents can use different AI backends — swappable live from the dashboard.

| Adapter | Cost | Setup |
|---|---|---|
| `claude-cli` | Free (Claude subscription) | Install [Claude Code](https://claude.ai/code), log in once |
| `antigravity-cli` | Free (Google account) | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |
| `claude` | Pay-per-token | Add `ANTHROPIC_API_KEY` to `.env` |
| `gemini` | Pay-per-token | Add `GOOGLE_API_KEY` to `.env` |
| `gemini-cli` | Free tier | Google AI Studio key, enter in Settings UI |
| `stub` | Free | Always available — echoes context, great for testing |

**Zero-cost option:** install Claude Code (`claude-cli`) — uses your existing Claude subscription, no API key needed.

### Custom adapter

Implement the `Adapter` interface:

```typescript
import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '@aisc/adapters';

export class MyAdapter implements Adapter {
  readonly type = 'my-provider';

  async checkEnvironment() {
    return { ok: true };
  }

  async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
    // ctx.workItemContextGraph  — hierarchy-aware context tree
    // ctx.companyContext        — company name and goals
    // ctx.agentName / agentRole / agentSystemPrompt
    // ctx.apiToken / apiBaseUrl — call back into the AISC REST API
    return { status: 'success', outputText: '...', costCents: 0, stopReason: 'task_complete', usage: { ... } };
  }
}
```

Register it in `server/src/adapters/registry.ts`.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React Dashboard                  │
│         (Agents · Board · Runs · Memory · Settings) │
└────────────────────────┬────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────┐
│              Fastify Server  (port 3100)             │
│                                                     │
│  ┌─────────────┐   ┌──────────────────────────────┐ │
│  │  Scheduler  │   │       Adapter Registry       │ │
│  │  (15s tick) │   │  claude · gemini · *-cli     │ │
│  └──────┬──────┘   └──────────────────────────────┘ │
│         │                                           │
│  ┌──────▼──────────────────────────────────────┐    │
│  │            Context Graph Builder            │    │
│  │  PostgreSQL recursive CTE → tree-structured │    │
│  │  agent context (★ assigned · ancestors)     │    │
│  └─────────────────────────────────────────────┘    │
└────────────────────────┬────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────┐
│                     PostgreSQL                       │
│  companies · agents · work_items · heartbeat_runs   │
│  cost_events · org_memory · activity_log            │
└─────────────────────────────────────────────────────┘
```

### Monorepo layout

```
aisc/
├── packages/
│   ├── db/          Drizzle ORM schema + migrations
│   ├── types/       Shared TypeScript types
│   └── adapters/    AI provider adapters (claude, gemini, *-cli, stub)
├── server/          Fastify v5 API + heartbeat scheduler
├── ui/              React 19 + Vite dashboard
├── install.sh       One-command installer (macOS/Linux)
└── install.ps1      One-command installer (Windows)
```

---

## 🚀 Manual setup

### Prerequisites

- **Node.js 20+** — https://nodejs.org
- **Docker** — https://docs.docker.com/get-docker
- **pnpm** — `npm install -g pnpm`

### Steps

```bash
# 1. Clone
git clone https://github.com/abhinavhissar/aisc.git
cd aisc

# 2. Start Postgres
docker run -d --name aisc-postgres -p 5432:5432 \
  -e POSTGRES_DB=aisc -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  postgres:16

# 3. Configure
cp .env.example .env
# Set in .env:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc
# JWT_SECRET=your-secret-here

# 4. Install & migrate
pnpm install
pnpm db:migrate

# 5. Start
pnpm dev:all
```

Open **http://localhost:5173** for the dashboard · **http://localhost:3100/docs** for Swagger.

### First run

1. Dashboard → **Settings** → create your company
2. **Agents** tab → add agents (or seed a demo: `pnpm tsx server/src/seed.ts "My Co" claude-cli`)
3. **Settings → Adapters** → connect at least one adapter
4. Create a work item and assign it — the scheduler picks it up within 15 seconds

---

## 🗄️ Database

Migrations run automatically on server startup. Manual commands:

```bash
pnpm db:generate   # after schema changes
pnpm db:migrate    # run pending migrations
pnpm db:studio     # open Drizzle Studio (visual DB browser)
```

| Table | Description |
|---|---|
| `companies` | Multi-tenant root — everything scoped to a company |
| `agents` | AI agents with role, adapter, status, budget |
| `work_items` | Full hierarchy from REQUIREMENT to TASK |
| `work_item_comments` | Agent and human comments |
| `work_item_relations` | Explicit edges: blocks, depends_on, relates_to |
| `heartbeat_runs` | Every dispatch: status, duration, tokens, cost |
| `cost_events` | Per-run token usage and cost in cents |
| `organizational_memory` | Shared knowledge base across runs |
| `activity_log` | Full audit trail |

---

## 📡 API

REST API at `http://localhost:3100` · Swagger UI at `/docs`.

```
GET  /api/companies          POST /api/companies
GET  /api/companies/:id      PATCH /api/companies/:id

GET  /api/agents             POST /api/agents
PATCH /api/agents/:id        POST /api/agents/:id/wake

GET  /api/work-items         POST /api/work-items
PATCH /api/work-items/:id/status
GET  /api/work-items/:id/comments
POST /api/work-items/:id/comments

GET  /api/heartbeats         GET  /api/memory
GET  /api/adapters           POST /api/adapters/:type/connect
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | *(required)* | PostgreSQL URL e.g. `postgresql://postgres:postgres@localhost:5432/aisc` |
| `JWT_SECRET` | *(required)* | Secret for agent API tokens |
| `PORT` | `3100` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `ANTHROPIC_API_KEY` | *(optional)* | Enables `claude` adapter |
| `GOOGLE_API_KEY` | *(optional)* | Enables `gemini` adapter |
| `GEMINI_API_KEY` | *(optional)* | Enables `gemini-cli` adapter |
| `SCHEDULER_INTERVAL_MS` | `15000` | Agent polling interval (ms) |

---

## 🗺️ Roadmap

- [ ] Vector search for organizational memory (pgvector)
- [ ] ADR workflow with agent-to-agent review cycles
- [ ] Git integration — agents commit code, open PRs, respond to review comments
- [ ] Multi-company isolation with proper auth
- [ ] Webhook events for external integrations
- [ ] Agent-to-agent messaging (direct, not just shared board)
- [ ] Cost enforcement — auto-pause agents that hit monthly budget
- [ ] Retrospective agent — analyses sprints, writes ADRs automatically

---

## 🤝 Contributing

Contributions are very welcome! For big changes, open an issue first.

```bash
# Fork → clone → branch
git checkout -b feature/my-feature

# Make changes — typecheck must pass
pnpm typecheck

# Commit & push → open a pull request
```

**Adding a work item type:** `packages/db/src/schema/work-items.ts` → `pnpm db:generate` → `ui/src/App.tsx` TYPE_COLORS

**Adding an agent role:** `packages/db/src/schema/agents.ts` → `packages/adapters/src/claude/role-prompts.ts` → `pnpm db:generate`

---

## 📄 License

MIT — see [LICENSE](LICENSE)

---

<div align="center">

Built with [Claude](https://claude.ai) · [Fastify](https://fastify.dev) · [Drizzle ORM](https://orm.drizzle.team) · [React](https://react.dev) · [Vite](https://vitejs.dev)

**If this project is useful to you, consider giving it a ⭐**

</div>
