/**
 * Optional demo seed — creates a sample company with the full 13-agent org chart.
 * All data is stored in PostgreSQL/PGlite. You do not need to run this;
 * create your company through the dashboard instead.
 *
 * Usage: pnpm tsx server/src/seed.ts [company-name] [adapter-type]
 *   pnpm tsx server/src/seed.ts                        # "Demo Company" + stub adapter
 *   pnpm tsx server/src/seed.ts "Acme AI" claude-cli  # named company + Claude CLI
 */
import { getDb } from '@aisc/db';
import { companies, agents } from '@aisc/db';

const companyName = process.argv[2] ?? 'Demo Company';
const adapterType = process.argv[3] ?? 'stub';
const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const db = await getDb();

const [company] = await db
  .insert(companies)
  .values({
    name: companyName,
    slug,
    goals: 'Build production-ready software autonomously through a full AI employee hierarchy.',
  })
  .onConflictDoNothing()
  .returning();

if (!company) {
  console.log(`Company with slug "${slug}" already exists. Skipping.`);
  process.exit(0);
}

console.log(`Created company: ${company.name} (${company.id})`);
console.log(`Adapter: ${adapterType}\n`);

const orgChart: Array<{
  name: string;
  role: typeof agents.$inferInsert['role'];
  title: string;
  reportsToName?: string;
  capabilities: string;
}> = [
  {
    name: 'Alex',
    role: 'CTO',
    title: 'Chief Technology Officer',
    capabilities: 'Technical strategy, architecture review, team leadership, ADR approval',
  },
  {
    name: 'Priya',
    role: 'SOLUTION_ARCHITECT',
    title: 'Principal Solution Architect',
    reportsToName: 'Alex',
    capabilities: 'System design, architecture documents, technology selection, scalability planning',
  },
  {
    name: 'Jordan',
    role: 'RESEARCH_AGENT',
    title: 'Research Specialist',
    reportsToName: 'Alex',
    capabilities: 'GitHub research, open-source analysis, build-vs-buy recommendations, technical reports',
  },
  {
    name: 'Sam',
    role: 'PROGRAM_MANAGER',
    title: 'Program Manager',
    reportsToName: 'Alex',
    capabilities: 'Phase planning, epic decomposition, story writing, sprint management, delivery tracking',
  },
  {
    name: 'Taylor',
    role: 'BACKEND_ENGINEERING_MANAGER',
    title: 'Backend Engineering Manager',
    reportsToName: 'Alex',
    capabilities: 'Backend code review, API design, database modeling, task delegation',
  },
  {
    name: 'Morgan',
    role: 'FRONTEND_ENGINEERING_MANAGER',
    title: 'Frontend Engineering Manager',
    reportsToName: 'Alex',
    capabilities: 'Frontend architecture, UI/UX review, component design, accessibility',
  },
  {
    name: 'Casey',
    role: 'QA_MANAGER',
    title: 'QA Manager',
    reportsToName: 'Alex',
    capabilities: 'Test plan creation, QA strategy, defect management, test automation',
  },
  {
    name: 'Devon',
    role: 'DEVOPS_MANAGER',
    title: 'DevOps Manager',
    reportsToName: 'Alex',
    capabilities: 'CI/CD pipelines, Docker, infrastructure, deployment, monitoring',
  },
  {
    name: 'Riley',
    role: 'SECURITY_LEAD',
    title: 'Security Lead',
    reportsToName: 'Alex',
    capabilities: 'Security reviews, OWASP compliance, penetration testing, vulnerability assessment',
  },
  {
    name: 'Avery',
    role: 'SENIOR_ENGINEER',
    title: 'Senior Software Engineer',
    reportsToName: 'Taylor',
    capabilities: 'Backend implementation, code review, mentoring, complex problem solving',
  },
  {
    name: 'Jamie',
    role: 'SOFTWARE_ENGINEER',
    title: 'Software Engineer',
    reportsToName: 'Taylor',
    capabilities: 'Feature implementation, unit tests, bug fixes',
  },
  {
    name: 'Quinn',
    role: 'QA_ENGINEER',
    title: 'QA Engineer',
    reportsToName: 'Casey',
    capabilities: 'Test case writing, manual testing, regression testing, defect reporting',
  },
  {
    name: 'Blake',
    role: 'DEVOPS_ENGINEER',
    title: 'DevOps Engineer',
    reportsToName: 'Devon',
    capabilities: 'Container builds, deployment scripts, monitoring dashboards, alerting',
  },
];

const idByName = new Map<string, string>();

for (const spec of orgChart) {
  const reportsToId = spec.reportsToName ? idByName.get(spec.reportsToName) : undefined;

  const [agent] = await db
    .insert(agents)
    .values({
      companyId: company.id,
      name: spec.name,
      role: spec.role,
      title: spec.title,
      status: 'active',
      ...(reportsToId ? { reportsTo: reportsToId } : {}),
      adapterType,
      capabilities: spec.capabilities,
      budgetMonthlyCents: 500_00, // $500/month default
    })
    .returning();

  if (!agent) throw new Error(`Failed to create agent: ${spec.name}`);

  idByName.set(spec.name, agent.id);
  console.log(`  ${agent.role.padEnd(32)} ${agent.name}`);
}

console.log(`\nSeed complete — ${orgChart.length} agents created.`);
console.log(`Company ID: ${company.id}`);
console.log('\nNext: pnpm dev  →  open http://localhost:5173');
process.exit(0);
