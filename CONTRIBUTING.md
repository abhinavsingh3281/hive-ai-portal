# Contributing to hive-ai-portal

Thank you for your interest in contributing! This document covers how to get involved.

## Ways to contribute

- **Bug reports** — open an issue with steps to reproduce
- **Feature requests** — open an issue describing the use case
- **Pull requests** — bug fixes, new adapters, UI improvements, docs
- **Adapters** — add support for a new AI provider

## Development setup

```bash
git clone https://github.com/abhinavsingh3281/hive-ai-portal
cd hive-ai-portal
docker run -d --name hive-postgres -p 5432:5432 \
  -e POSTGRES_DB=aisc -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres \
  postgres:16
cp .env.example .env
# set DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aisc in .env
pnpm install
pnpm dev:all
```

## Pull request process

1. Fork the repo and create a branch from `main`:
   ```bash
   git checkout -b fix/my-fix
   # or
   git checkout -b feat/my-feature
   ```

2. Make your changes. Run typecheck before pushing:
   ```bash
   pnpm typecheck
   ```

3. Write a clear PR description explaining **what** and **why**.

4. Open the pull request against `main`.

## Adding a new adapter

1. Create `packages/adapters/src/my-provider/index.ts` implementing the `Adapter` interface:
   ```typescript
   import type { Adapter, AdapterExecutionContext, AdapterExecutionResult } from '../interface';

   export class MyProviderAdapter implements Adapter {
     readonly type = 'my-provider';
     async checkEnvironment() { return { ok: true }; }
     async execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> { ... }
   }
   ```
2. Export it from `packages/adapters/src/index.ts`
3. Register it in `server/src/adapters/registry.ts`
4. Add a card entry in `ADAPTER_META` in `ui/src/App.tsx`

## Adding a new agent role

1. Add the value to `agentRoleEnum` in `packages/db/src/schema/agents.ts`
2. Add a system prompt in `packages/adapters/src/claude/role-prompts.ts`
3. Run `pnpm db:generate` to create the migration
4. Add an emoji in `ROLE_ICON` in `ui/src/App.tsx`

## Code style

- TypeScript strict mode — no `any`, no unused vars
- `pnpm typecheck` must pass — CI will reject if not
- No external UI libraries — the dashboard is intentionally dependency-light
- Prefer editing existing files over creating new ones

## Commit style

```
feat: add X
fix: resolve Y when Z
docs: update adapter guide
chore: bump deps
```

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
