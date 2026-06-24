import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Company { id: string; name: string; slug: string; goals: string | null; }
interface Agent {
  id: string; name: string; role: string; title: string; status: string;
  adapterType: string; lastHeartbeatAt: string | null; budgetMonthlyCents: number | null;
}
interface WorkItem {
  id: string; identifier: string; type: string; title: string;
  description: string | null; status: string; priority: string;
  parentId: string | null; assigneeAgentId: string | null;
}
interface HeartbeatRun {
  id: string; agentId: string; status: string; provider: string | null; model: string | null;
  inputTokens: number; outputTokens: number; costCents: number; durationMs: number | null;
  successSummary: string | null; stopReason: string | null; errorMessage: string | null; createdAt: string;
}
interface MemoryEntry { id: string; content: string; sourceType: string; tags: string[]; createdAt: string; }
interface AdapterStatus { type: string; ok: boolean; message?: string; }

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg:          '#07070f',
  surface:     '#0d0d1a',
  surface2:    '#121220',
  border:      '#1a1a2e',
  borderLight: '#252542',
  text:        '#e2e8f0',
  muted:       '#64748b',
  dimmed:      '#2d3748',
  accent:      '#4ade80',
  accentDim:   'rgba(74,222,128,0.12)',
  accentGlow:  'rgba(74,222,128,0.25)',
  amber:       '#fbbf24',
  danger:      '#f87171',
  dangerDim:   'rgba(248,113,113,0.12)',
  info:        '#60a5fa',
  infoDim:     'rgba(96,165,250,0.12)',
  purple:      '#a78bfa',
  purpleDim:   'rgba(167,139,250,0.12)',
  pink:        '#f472b6',
};

const FONT_SANS = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`;
const FONT_MONO = `'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace`;

const STATUS_COLORS: Record<string, string> = {
  active: C.accent, idle: C.muted, running: C.amber, paused: C.dimmed,
  error: C.danger, terminated: C.danger,
  created: C.muted, assigned: C.info, in_progress: C.amber,
  review: C.purple, qa: C.purple, completed: C.accent,
  rejected: C.danger, cancelled: C.dimmed, reworking: C.amber,
  succeeded: C.accent, failed: C.danger, timed_out: C.danger, queued: C.muted,
};

const TYPE_COLORS: Record<string, string> = {
  REQUIREMENT: '#f97316', RESEARCH: '#a78bfa', ARCHITECTURE: '#60a5fa',
  ADR: '#34d399', PHASE: '#fb923c', EPIC: '#f472b6',
  STORY: '#4ade80', TASK: '#94a3b8', BUG: '#f87171',
  TEST: '#fbbf24', REVIEW: '#c084fc', SECURITY: '#f87171',
  DEPLOYMENT: '#38bdf8', INCIDENT: '#f87171', RETROSPECTIVE: '#86efac',
};

const ROLE_ICON: Record<string, string> = {
  CTO: '👑', SOLUTION_ARCHITECT: '🏗️', PROGRAM_MANAGER: '📋',
  BACKEND_ENGINEERING_MANAGER: '⚙️', FRONTEND_ENGINEERING_MANAGER: '🎨',
  DEVOPS_MANAGER: '🚀', QA_MANAGER: '🔍', SECURITY_LEAD: '🔒',
  SENIOR_ENGINEER: '💡', SOFTWARE_ENGINEER: '💻', QA_ENGINEER: '🧪',
  RESEARCH_AGENT: '🔬', DEVOPS_ENGINEER: '🛠️',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const API = '/api';
async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDuration(ms: number | null) {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
function statusColor(s: string) { return STATUS_COLORS[s] ?? C.muted; }
function typeColor(t: string) { return TYPE_COLORS[t] ?? C.muted; }
function fmtCost(cents: number) { return cents === 0 ? '—' : `$${(cents / 100).toFixed(4)}`; }

// ─── Global styles ────────────────────────────────────────────────────────────

const globalStyle = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 100%; }
  body { background: ${C.bg}; color: ${C.text}; font-family: ${FONT_SANS}; }
  ::selection { background: ${C.accentDim}; color: ${C.accent}; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
  input, textarea, select { outline: none; }
  input::placeholder, textarea::placeholder { color: ${C.muted}; opacity: 0.6; }
  @keyframes pulse-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.6; transform: scale(1.3); }
  }
  @keyframes fade-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes shimmer {
    0% { background-position: -200% 0; }
    100% { background-position: 200% 0; }
  }
  .fade-in { animation: fade-in 0.25s ease forwards; }
`;

// ─── Primitives ───────────────────────────────────────────────────────────────

function StyleInjector() {
  return <style>{globalStyle}</style>;
}

function Badge({ label, color = C.muted, size = 'sm' }: { label: string; color?: string; size?: 'xs' | 'sm' }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: size === 'xs' ? '1px 5px' : '2px 7px',
      fontSize: size === 'xs' ? 10 : 11,
      fontFamily: FONT_MONO,
      fontWeight: 500,
      background: color + '18',
      color,
      border: `1px solid ${color}35`,
      borderRadius: 4,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function Dot({ status, size = 8 }: { status: string; size?: number }) {
  const color = STATUS_COLORS[status] ?? C.muted;
  const isAnimated = status === 'running' || status === 'in_progress';
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: color,
      boxShadow: isAnimated ? `0 0 8px ${color}` : 'none',
      animation: isAnimated ? 'pulse-dot 1.5s ease-in-out infinite' : 'none',
      flexShrink: 0,
    }} />
  );
}

function Btn({
  children, onClick, variant = 'default', size = 'md', disabled = false, fullWidth = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  fullWidth?: boolean;
}) {
  const pad = size === 'sm' ? '4px 10px' : size === 'lg' ? '10px 24px' : '6px 16px';
  const fs = size === 'sm' ? 12 : size === 'lg' ? 15 : 13;

  const styles: Record<string, React.CSSProperties> = {
    primary: { background: C.accent, color: '#000', border: `1px solid ${C.accent}`, fontWeight: 700 },
    danger:  { background: C.dangerDim, color: C.danger, border: `1px solid ${C.danger}55` },
    ghost:   { background: 'transparent', color: C.muted, border: '1px solid transparent' },
    default: { background: C.surface2, color: C.text, border: `1px solid ${C.borderLight}` },
  };

  const s = disabled
    ? { background: C.surface, color: C.dimmed, border: `1px solid ${C.border}` }
    : styles[variant];

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: pad, fontSize: fs,
        fontFamily: FONT_SANS, fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        borderRadius: 6,
        transition: 'all 0.15s',
        display: 'inline-flex', alignItems: 'center', gap: 6,
        width: fullWidth ? '100%' : undefined,
        justifyContent: fullWidth ? 'center' : undefined,
        ...s,
      }}
    >
      {children}
    </button>
  );
}

function Card({ children, style, glow }: { children: React.ReactNode; style?: React.CSSProperties; glow?: string | undefined }) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '16px 18px',
      position: 'relative',
      transition: 'border-color 0.2s',
      boxShadow: glow ? `0 0 20px ${glow}22` : 'none',
      ...(glow ? { borderColor: glow + '40' } : {}),
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatCard({ label, value, color = C.text, sub }: { label: string; value: string | number; color?: string; sub?: string }) {
  return (
    <div style={{
      background: C.surface2,
      border: `1px solid ${C.border}`,
      borderRadius: 10,
      padding: '14px 18px',
    }}>
      <div style={{ fontSize: 11, color: C.muted, fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h2 style={{ fontSize: 13, fontWeight: 600, color: C.muted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</h2>
      {right}
    </div>
  );
}

function Input({ value, onChange, placeholder, onKeyDown, type = 'text', style }: {
  value: string; onChange: (v: string) => void; placeholder?: string | undefined;
  onKeyDown?: React.KeyboardEventHandler | undefined; type?: string | undefined; style?: React.CSSProperties | undefined;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      style={{
        background: C.surface2,
        border: `1px solid ${C.borderLight}`,
        color: C.text,
        padding: '8px 12px',
        fontFamily: FONT_SANS,
        fontSize: 14,
        borderRadius: 6,
        width: '100%',
        transition: 'border-color 0.15s',
        ...style,
      }}
      onFocus={(e) => { e.target.style.borderColor = C.accentGlow; }}
      onBlur={(e) => { e.target.style.borderColor = C.borderLight; }}
    />
  );
}

// ─── Hex logo ─────────────────────────────────────────────────────────────────

function HexLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none">
      <polygon
        points="14,2 25,8 25,20 14,26 3,20 3,8"
        fill={C.accentDim}
        stroke={C.accent}
        strokeWidth="1.5"
      />
      <polygon
        points="14,7 20,10.5 20,17.5 14,21 8,17.5 8,10.5"
        fill={C.accent}
        opacity="0.9"
      />
    </svg>
  );
}

// ─── Agents tab ───────────────────────────────────────────────────────────────

function AgentsTab({ company, agents, onRefresh }: { company: Company; agents: Agent[]; onRefresh: () => void }) {
  const [waking, setWaking] = useState<string | null>(null);

  async function wakeAgent(agentId: string) {
    setWaking(agentId);
    try {
      await apiFetch(`/agents/${agentId}/wake`, { method: 'POST' });
      setTimeout(onRefresh, 800);
    } catch (e) { console.error(e); }
    finally { setWaking(null); }
  }

  const byRole = agents.reduce<Record<string, Agent[]>>((acc, a) => {
    (acc[a.role] ??= []).push(a);
    return acc;
  }, {});

  const activeCount  = agents.filter((a) => a.status === 'active').length;
  const runningCount = agents.filter((a) => a.status === 'running').length;
  const errorCount   = agents.filter((a) => a.status === 'error').length;

  return (
    <div className="fade-in">
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: 24 }}>
        <StatCard label="Total" value={agents.length} sub={company.name} />
        <StatCard label="Active" value={activeCount} color={C.accent} />
        <StatCard label="Running" value={runningCount} color={C.amber} />
        {errorCount > 0 && <StatCard label="Errors" value={errorCount} color={C.danger} />}
      </div>

      <SectionHeader title="Team" right={<Btn size="sm" onClick={onRefresh}>↻ Refresh</Btn>} />

      {agents.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '60px 20px',
          border: `1px dashed ${C.border}`, borderRadius: 10,
          color: C.muted,
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>No agents yet</div>
          <div style={{ fontSize: 13 }}>POST /api/agents to hire your first AI employee.</div>
        </div>
      )}

      {Object.entries(byRole).map(([role, roleAgents]) => (
        <div key={role} style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 16 }}>{ROLE_ICON[role] ?? '🤖'}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.muted, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              {role.replace(/_/g, ' ')}
            </span>
            <span style={{ fontSize: 11, color: C.dimmed }}>· {roleAgents.length}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 10 }}>
            {roleAgents.map((a) => {
              const isRunning = a.status === 'running';
              return (
                <Card key={a.id} glow={isRunning ? C.amber : a.status === 'error' ? C.danger : undefined}>
                  {/* Top strip for running agents */}
                  {isRunning && (
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 2, borderRadius: '10px 10px 0 0',
                      background: `linear-gradient(90deg, ${C.amber}, ${C.accent})`,
                    }} />
                  )}

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
                      <div style={{
                        width: 38, height: 38, borderRadius: 8, flexShrink: 0,
                        background: C.surface2,
                        border: `1px solid ${C.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18,
                      }}>
                        {ROLE_ICON[a.role] ?? '🤖'}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <Dot status={a.status} />
                          <span style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                        </div>
                        <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.title}</div>
                      </div>
                    </div>
                    <Badge label={a.status} color={statusColor(a.status)} />
                  </div>

                  <div style={{
                    marginTop: 12, paddingTop: 12,
                    borderTop: `1px solid ${C.border}`,
                    display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <div style={{ fontSize: 11, color: C.muted, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontFamily: FONT_MONO }}>{a.adapterType}</span>
                      {a.budgetMonthlyCents && <span>${(a.budgetMonthlyCents / 100).toFixed(0)}/mo</span>}
                      {a.lastHeartbeatAt && <span>{fmtTime(a.lastHeartbeatAt)}</span>}
                    </div>
                    <Btn
                      size="sm"
                      variant="primary"
                      disabled={waking === a.id || isRunning}
                      onClick={() => wakeAgent(a.id)}
                    >
                      {waking === a.id ? '…' : '▶ Wake'}
                    </Btn>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Board tab ────────────────────────────────────────────────────────────────

const STATUS_ORDER = ['in_progress', 'assigned', 'review', 'qa', 'created', 'completed', 'reworking', 'rejected', 'cancelled'];

function WorkItemRow({ item, depth = 0, agents }: { item: WorkItem; depth?: number; agents: Agent[] }) {
  const assignee = agents.find((a) => a.id === item.assigneeAgentId);
  const tColor = typeColor(item.type);

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '90px 90px 1fr 70px 110px 110px',
      alignItems: 'center',
      gap: 8,
      padding: '8px 14px',
      paddingLeft: 14 + depth * 18,
      borderBottom: `1px solid ${C.border}`,
      fontSize: 13,
      transition: 'background 0.1s',
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.surface2; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
    >
      <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}>{item.identifier}</span>
      <Badge label={item.type} color={tColor} size="xs" />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
        {depth > 0 && <span style={{ color: C.dimmed, marginRight: 6 }}>{'└'}</span>}
        {item.title}
      </span>
      <Badge
        label={item.priority}
        color={item.priority === 'critical' ? C.danger : item.priority === 'high' ? C.amber : C.muted}
        size="xs"
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Dot status={item.status} size={6} />
        <span style={{ fontSize: 11, color: statusColor(item.status) }}>{item.status}</span>
      </div>
      <span style={{ fontSize: 11, color: C.info, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {assignee ? `@${assignee.name}` : ''}
      </span>
    </div>
  );
}

function BoardTab({ company, workItems, agents }: { company: Company; workItems: WorkItem[]; agents: Agent[] }) {
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  function flattenTree(parentId: string | null = null, depth = 0): Array<{ item: WorkItem; depth: number }> {
    return workItems
      .filter((w) => w.parentId === parentId)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status))
      .flatMap((c) => [{ item: c, depth }, ...flattenTree(c.id, depth + 1)]);
  }

  const flat = flattenTree();
  const filtered = flat.filter(({ item }) => {
    if (statusFilter !== 'all' && item.status !== statusFilter) return false;
    if (filter && !item.title.toLowerCase().includes(filter.toLowerCase()) && !item.identifier.toLowerCase().includes(filter.toLowerCase())) return false;
    return true;
  });

  const statuses = ['all', ...STATUS_ORDER];
  const inProgress = workItems.filter((w) => w.status === 'in_progress').length;

  return (
    <div className="fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 24 }}>
        <StatCard label="Total" value={workItems.length} />
        <StatCard label="In Progress" value={inProgress} color={C.amber} />
        <StatCard label="Completed" value={workItems.filter((w) => w.status === 'completed').length} color={C.accent} />
        <StatCard label="Blocked" value={workItems.filter((w) => w.status === 'rejected').length} color={C.danger} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, fontSize: 13 }}>🔍</span>
          <Input value={filter} onChange={setFilter} placeholder="Search items…" style={{ paddingLeft: 32 }} />
        </div>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {statuses.map((s) => {
            const active = statusFilter === s;
            return (
              <button key={s} onClick={() => setStatusFilter(s)} style={{
                padding: '5px 10px', fontSize: 11, fontFamily: FONT_SANS, fontWeight: 500,
                background: active ? (STATUS_COLORS[s] ?? C.accent) + '22' : 'transparent',
                color: active ? (STATUS_COLORS[s] ?? C.accent) : C.muted,
                border: `1px solid ${active ? (STATUS_COLORS[s] ?? C.accent) + '55' : C.border}`,
                cursor: 'pointer', borderRadius: 6, transition: 'all 0.15s',
              }}>
                {s}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
        {filtered.length} of {workItems.length} items
      </div>

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '90px 90px 1fr 70px 110px 110px',
          gap: 8, padding: '8px 14px',
          background: C.surface2, borderBottom: `1px solid ${C.border}`,
          fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
        }}>
          <span>ID</span><span>TYPE</span><span>TITLE</span><span>PRIORITY</span><span>STATUS</span><span>ASSIGNEE</span>
        </div>
        {filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: C.muted, fontSize: 14 }}>
            No items match.
          </div>
        )}
        {filtered.map(({ item, depth }) => (
          <WorkItemRow key={item.id} item={item} depth={depth} agents={agents} />
        ))}
      </div>
    </div>
  );
}

// ─── Runs tab ─────────────────────────────────────────────────────────────────

function RunsTab({ companyId, agents }: { companyId: string; agents: Agent[] }) {
  const [runs, setRuns] = useState<HeartbeatRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCents, setTotalCents] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<HeartbeatRun[]>(`/heartbeats?companyId=${companyId}`);
      setRuns(data);
      setTotalCents(data.reduce((s, r) => s + (r.costCents ?? 0), 0));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [companyId]);

  useEffect(() => { void load(); }, [load]);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);
  const successRate = runs.length === 0 ? null : Math.round(runs.filter((r) => r.status === 'succeeded').length / runs.length * 100);

  return (
    <div className="fade-in">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 24 }}>
        <StatCard label="Total Runs" value={runs.length} />
        <StatCard label="Total Cost" value={`$${(totalCents / 100).toFixed(4)}`} color={totalCents > 0 ? C.amber : C.text} />
        <StatCard label="Success Rate" value={successRate === null ? '—' : `${successRate}%`} color={C.accent} />
        <StatCard label="Errors" value={runs.filter((r) => r.status === 'failed').length} color={C.danger} />
      </div>

      <SectionHeader title="Run History" right={<Btn size="sm" onClick={load}>↻ Refresh</Btn>} />

      <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
              {['Agent', 'Status', 'Model', 'Tokens', 'Cost', 'Duration', 'Summary', 'When'].map((h) => (
                <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: `1px solid ${C.border}`, transition: 'background 0.1s' }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.surface2; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                <td style={{ padding: '8px 12px', fontWeight: 600, color: C.info }}>{agentName(r.agentId)}</td>
                <td style={{ padding: '8px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Dot status={r.status} size={6} />
                    <span style={{ fontSize: 12, color: STATUS_COLORS[r.status] ?? C.muted }}>{r.status}</span>
                  </div>
                </td>
                <td style={{ padding: '8px 12px', fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}>{r.model ?? '—'}</td>
                <td style={{ padding: '8px 12px', fontFamily: FONT_MONO, fontSize: 11, color: C.muted }}>
                  {r.inputTokens.toLocaleString()} / {r.outputTokens.toLocaleString()}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: FONT_MONO, fontSize: 12, color: r.costCents > 0 ? C.amber : C.muted }}>
                  {fmtCost(r.costCents)}
                </td>
                <td style={{ padding: '8px 12px', fontFamily: FONT_MONO, fontSize: 12, color: C.muted }}>{fmtDuration(r.durationMs)}</td>
                <td style={{ padding: '8px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: C.text }}>
                  {r.errorMessage
                    ? <span style={{ color: C.danger }}>{r.errorMessage}</span>
                    : (r.successSummary ?? <span style={{ color: C.muted }}>—</span>)
                  }
                </td>
                <td style={{ padding: '8px 12px', fontSize: 11, color: C.muted, whiteSpace: 'nowrap' }}>{fmtTime(r.createdAt)}</td>
              </tr>
            ))}
            {!loading && runs.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: C.muted }}>
                  No runs yet. Wake an agent to start.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Memory tab ───────────────────────────────────────────────────────────────

function MemoryTab({ companyId }: { companyId: string }) {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [tagFilter, setTagFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ companyId });
      if (tagFilter) params.set('tags', tagFilter);
      setEntries(await apiFetch<MemoryEntry[]>(`/memory?${params}`));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [companyId, tagFilter]);

  useEffect(() => { void load(); }, [load]);

  const allTags = [...new Set(entries.flatMap((e) => e.tags))].sort();

  return (
    <div className="fade-in">
      <SectionHeader
        title={`Organizational Memory · ${entries.length}`}
        right={
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={tagFilter} onChange={setTagFilter} placeholder="Filter by tags…" style={{ width: 200, fontSize: 13 }} onKeyDown={(e) => e.key === 'Enter' && load()} />
            <Btn size="sm" onClick={load}>Search</Btn>
          </div>
        }
      />

      {allTags.length > 0 && (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 16 }}>
          {allTags.map((tag) => (
            <button key={tag} onClick={() => setTagFilter(tag)} style={{
              padding: '3px 8px', fontSize: 11, fontFamily: FONT_MONO,
              background: C.purpleDim, color: C.purple, border: `1px solid ${C.purple}35`,
              cursor: 'pointer', borderRadius: 5, transition: 'all 0.15s',
            }}>
              #{tag}
            </button>
          ))}
        </div>
      )}

      {loading && <div style={{ color: C.muted, fontSize: 13, padding: '20px 0' }}>Loading…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {entries.map((e) => (
          <Card key={e.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Badge label={e.sourceType} color={C.purple} />
                {e.tags.map((t) => (
                  <span key={t} style={{ fontSize: 11, color: C.purple, fontFamily: FONT_MONO }}>#{t}</span>
                ))}
              </div>
              <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', marginLeft: 10 }}>{fmtTime(e.createdAt)}</span>
            </div>
            <div
              onClick={() => setExpanded(expanded === e.id ? null : e.id)}
              style={{
                fontSize: 13, lineHeight: 1.7, color: C.text,
                whiteSpace: 'pre-wrap',
                maxHeight: expanded === e.id ? 'none' : 100,
                overflow: 'hidden',
                cursor: 'pointer',
                maskImage: expanded === e.id ? 'none' : e.content.length > 180 ? 'linear-gradient(to bottom, black 60%, transparent)' : 'none',
                WebkitMaskImage: expanded === e.id ? 'none' : e.content.length > 180 ? 'linear-gradient(to bottom, black 60%, transparent)' : 'none',
              }}
            >
              {e.content}
            </div>
            {e.content.length > 200 && (
              <button onClick={() => setExpanded(expanded === e.id ? null : e.id)} style={{
                background: 'none', border: 'none', color: C.info, cursor: 'pointer',
                fontSize: 12, marginTop: 6, padding: 0, fontFamily: FONT_SANS,
              }}>
                {expanded === e.id ? '▲ Collapse' : '▼ Show more'}
              </button>
            )}
          </Card>
        ))}
        {!loading && entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 20px', border: `1px dashed ${C.border}`, borderRadius: 10, color: C.muted }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🧠</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>No memories yet</div>
            <div style={{ fontSize: 13 }}>Agents write here as they work.</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Settings tab ─────────────────────────────────────────────────────────────

interface AdapterMeta {
  label: string; desc: string; icon: string;
  connectType: 'cli' | 'apikey' | 'unavailable';
  keyPlaceholder?: string; keyLink?: string; keyLabel?: string; installNote?: string;
}

const ADAPTER_META: Record<string, AdapterMeta> = {
  'claude-cli': {
    label: 'Claude Code', icon: '🤖',
    desc: 'Uses your locally authenticated `claude` CLI — free, no API key needed.',
    connectType: 'cli',
    installNote: 'Authenticated via this terminal session.',
  },
  'antigravity-cli': {
    label: 'Antigravity (agy)', icon: '🪐',
    desc: "Google's next-gen agent CLI — free with a Google account. Install: curl -fsSL https://antigravity.google/cli/install.sh | bash",
    connectType: 'cli',
    installNote: 'Already installed and authenticated.',
  },
  'gemini-cli': {
    label: 'Gemini CLI', icon: '⚡',
    desc: 'Local `gemini` binary with a Google AI Studio API key (free tier).',
    connectType: 'apikey',
    keyLabel: 'Google AI API Key', keyPlaceholder: 'AIzaSy…', keyLink: 'aistudio.google.com/apikey',
  },
  claude: {
    label: 'Claude API', icon: '🧠',
    desc: 'Full agentic loop — claude-opus-4-8 with thinking + tool use.',
    connectType: 'apikey',
    keyLabel: 'Anthropic API Key', keyPlaceholder: 'sk-ant-api03-…', keyLink: 'console.anthropic.com/settings/api-keys',
  },
  gemini: {
    label: 'Gemini API', icon: '💎',
    desc: 'Full agentic loop — gemini-1.5-pro with function calling.',
    connectType: 'apikey',
    keyLabel: 'Google AI API Key', keyPlaceholder: 'AIzaSy…', keyLink: 'aistudio.google.com/apikey',
  },
  cursor: {
    label: 'Cursor', icon: '↗️',
    desc: 'Cursor has no external AI inference API yet. Use Claude Code instead.',
    connectType: 'unavailable',
  },
};

function AdapterCard({ type, meta, status, onConnected }: { type: string; meta: AdapterMeta; status: AdapterStatus | undefined; onConnected: () => void }) {
  const [apiKey, setApiKey] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [showKey, setShowKey] = useState(false);

  const connected = status?.ok ?? false;

  async function connect() {
    if (!apiKey.trim()) return;
    setConnecting(true); setError('');
    try {
      const res = await apiFetch<{ connected: boolean; message?: string }>(`/adapters/${type}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      if (res.connected) { setApiKey(''); onConnected(); }
      else setError(res.message ?? 'Connection failed');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
    } finally { setConnecting(false); }
  }

  const isUnavailable = meta.connectType === 'unavailable';

  return (
    <Card
      style={{ opacity: isUnavailable ? 0.5 : 1 }}
      glow={connected ? C.accent : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: C.surface2, border: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
        }}>
          {meta.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{meta.label}</span>
            <Badge
              label={isUnavailable ? 'unavailable' : connected ? 'connected' : 'not connected'}
              color={isUnavailable ? C.dimmed : connected ? C.accent : C.amber}
            />
            <Badge label={type} color={C.muted} size="xs" />
          </div>
          <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5, marginBottom: 10 }}>{meta.desc}</div>

          {meta.connectType === 'cli' && (
            <div style={{ fontSize: 12, color: connected ? C.accent : C.amber }}>
              {connected ? `✓ ${meta.installNote}` : meta.installNote}
            </div>
          )}

          {meta.connectType === 'apikey' && !connected && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: C.muted }}>
                {meta.keyLabel} ·{' '}
                <span style={{ color: C.info }}>{meta.keyLink}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={setApiKey}
                    placeholder={meta.keyPlaceholder}
                    style={{ fontFamily: FONT_MONO, paddingRight: 36, ...(error ? { borderColor: C.danger } : {}) }}
                    onKeyDown={(e) => e.key === 'Enter' && void connect()}
                  />
                  <button onClick={() => setShowKey((v) => !v)} style={{
                    position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 14, padding: 0,
                  }}>
                    {showKey ? '🙈' : '👁'}
                  </button>
                </div>
                <Btn variant="primary" disabled={!apiKey.trim() || connecting} onClick={() => void connect()}>
                  {connecting ? 'Testing…' : 'Connect'}
                </Btn>
              </div>
              {error && <div style={{ fontSize: 12, color: C.danger }}>{error}</div>}
            </div>
          )}

          {meta.connectType === 'apikey' && connected && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>✓ API key verified</span>
              <Btn size="sm" onClick={() => { setApiKey(''); setError(''); }}>Replace key</Btn>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function SettingsTab({ company, agents, onCompanyUpdate, onAgentUpdate }: {
  company: Company; agents: Agent[];
  onCompanyUpdate: (u: Company) => void; onAgentUpdate: (u: Agent) => void;
}) {
  const [adapters, setAdapters] = useState<AdapterStatus[]>([]);
  const [companyName, setCompanyName] = useState(company.name);
  const [companyGoals, setCompanyGoals] = useState(company.goals ?? '');
  const [saving, setSaving] = useState(false);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [agentAdapter, setAgentAdapter] = useState('');

  const loadAdapters = useCallback(() => {
    apiFetch<AdapterStatus[]>('/adapters').then(setAdapters).catch(console.error);
  }, []);
  useEffect(() => { loadAdapters(); }, [loadAdapters]);

  async function saveCompany() {
    setSaving(true);
    try {
      const updated = await apiFetch<Company>(`/companies/${company.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: companyName, goals: companyGoals }),
      });
      onCompanyUpdate(updated);
    } finally { setSaving(false); }
  }

  async function saveAgentAdapter(agentId: string) {
    const updated = await apiFetch<Agent>(`/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: company.id, adapterType: agentAdapter }),
    });
    onAgentUpdate(updated);
    setEditingAgent(null);
  }

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Company */}
      <section>
        <SectionHeader title="Company" />
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 6 }}>Name</label>
              <Input value={companyName} onChange={setCompanyName} placeholder="Company name" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 6 }}>
                Goals <span style={{ color: C.dimmed, fontWeight: 400 }}>(agents read this for context)</span>
              </label>
              <textarea
                value={companyGoals}
                onChange={(e) => setCompanyGoals(e.target.value)}
                rows={3}
                placeholder="What is this company building? What are the key objectives?"
                style={{
                  width: '100%', background: C.surface2, border: `1px solid ${C.borderLight}`,
                  color: C.text, padding: '8px 12px', fontFamily: FONT_SANS, fontSize: 14,
                  borderRadius: 6, resize: 'vertical',
                }}
              />
            </div>
            <div>
              <Btn variant="primary" onClick={saveCompany} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </Btn>
            </div>
          </div>
        </Card>
      </section>

      {/* Adapters */}
      <section>
        <SectionHeader title="AI Adapters" right={<Btn size="sm" onClick={loadAdapters}>↻ Refresh</Btn>} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {Object.entries(ADAPTER_META).map(([type, meta]) => (
            <AdapterCard key={type} type={type} meta={meta} status={adapters.find((a) => a.type === type)} onConnected={loadAdapters} />
          ))}
        </div>
      </section>

      {/* Agent adapters */}
      <section>
        <SectionHeader title="Agent Assignments" />
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.surface2, borderBottom: `1px solid ${C.border}` }}>
                {['Agent', 'Role', 'Adapter', ''].map((h, i) => (
                  <th key={i} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 10, color: C.muted, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const adStatus = adapters.find((s) => s.type === a.adapterType);
                return (
                  <tr key={a.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 16 }}>{ROLE_ICON[a.role] ?? '🤖'}</span>
                        {a.name}
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', color: C.muted, fontSize: 12 }}>{a.role.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Dot status={adStatus?.ok ? 'active' : 'error'} size={6} />
                        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: adStatus?.ok ? C.text : C.amber }}>{a.adapterType}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {editingAgent === a.id ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <select
                            value={agentAdapter}
                            onChange={(e) => setAgentAdapter(e.target.value)}
                            style={{ background: C.surface2, border: `1px solid ${C.borderLight}`, color: C.text, fontFamily: FONT_SANS, fontSize: 13, padding: '5px 8px', borderRadius: 6 }}
                          >
                            {adapters.map((s) => (
                              <option key={s.type} value={s.type}>{s.type}{s.ok ? ' ✓' : ' ✗'}</option>
                            ))}
                          </select>
                          <Btn size="sm" variant="primary" onClick={() => void saveAgentAdapter(a.id)}>Save</Btn>
                          <Btn size="sm" onClick={() => setEditingAgent(null)}>✕</Btn>
                        </div>
                      ) : (
                        <Btn size="sm" onClick={() => { setEditingAgent(a.id); setAgentAdapter(a.adapterType); }}>Change</Btn>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

function OnboardingScreen({ onCreate }: { onCreate: (c: Company) => void }) {
  const [name, setName] = useState('');
  const [goals, setGoals] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    if (!name.trim()) return;
    setCreating(true); setError('');
    try {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const company = await apiFetch<Company>('/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), slug, goals: goals.trim() || null }),
      });
      onCreate(company);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create company');
      setCreating(false);
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '80vh', padding: 24, position: 'relative',
    }}>
      {/* Background hex pattern */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-4L4 48V18L28 4l24 14v30L28 62z' fill='%234ade80'/%3E%3C/svg%3E")`,
        backgroundSize: '56px 100px',
      }} />

      <div style={{ maxWidth: 460, width: '100%', position: 'relative' }} className="fade-in">
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
            <HexLogo size={40} />
            <span style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em' }}>hive</span>
          </div>
          <div style={{
            fontSize: 16, color: C.muted, fontWeight: 400, lineHeight: 1.5,
          }}>
            Your entire engineering team.<br />
            <span style={{ color: C.accent, fontWeight: 600 }}>Zero salaries.</span>
          </div>
        </div>

        <Card>
          <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Launch your AI company</div>
          <div style={{ fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.6 }}>
            Create a company and your AI team — CTO, Architects, Engineers, QA, DevOps — will be organized under it.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>Company name</label>
              <Input
                value={name}
                onChange={setName}
                placeholder="e.g. Stealth Labs, Acme AI, …"
                onKeyDown={(e) => e.key === 'Enter' && void create()}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 6 }}>
                Goals <span style={{ fontWeight: 400, color: C.dimmed }}>— optional, agents read this</span>
              </label>
              <textarea
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="What is this company building? What are the main objectives?"
                rows={3}
                style={{
                  width: '100%', background: C.surface2, border: `1px solid ${C.borderLight}`,
                  color: C.text, padding: '8px 12px', fontFamily: FONT_SANS, fontSize: 14,
                  borderRadius: 6, resize: 'vertical',
                }}
              />
            </div>
            {error && (
              <div style={{ fontSize: 13, color: C.danger, background: C.dangerDim, border: `1px solid ${C.danger}33`, borderRadius: 6, padding: '8px 12px' }}>
                {error}
              </div>
            )}
            <Btn variant="primary" size="lg" fullWidth disabled={!name.trim() || creating} onClick={() => void create()}>
              {creating ? 'Creating…' : 'Create company →'}
            </Btn>
          </div>
        </Card>

        <div style={{ marginTop: 20, fontSize: 12, color: C.dimmed, textAlign: 'center', lineHeight: 1.7 }}>
          Next: go to <span style={{ color: C.accent }}>Settings → Adapters</span> to connect an AI provider,
          then add agents from the <span style={{ color: C.accent }}>Agents</span> tab.
        </div>
      </div>
    </div>
  );
}

// ─── App shell ────────────────────────────────────────────────────────────────

type Tab = 'agents' | 'board' | 'runs' | 'memory' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'agents',   label: 'Agents',   icon: '🤖' },
  { id: 'board',    label: 'Board',    icon: '📋' },
  { id: 'runs',     label: 'Runs',     icon: '⚡' },
  { id: 'memory',   label: 'Memory',   icon: '🧠' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export function App() {
  const [companies, setCompanies]           = useState<Company[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null);
  const [agents, setAgents]                 = useState<Agent[]>([]);
  const [workItems, setWorkItems]           = useState<WorkItem[]>([]);
  const [tab, setTab]                       = useState<Tab>('agents');
  const [tick, setTick]                     = useState(0);
  const [loading, setLoading]               = useState(true);

  useEffect(() => {
    apiFetch<Company[]>('/companies')
      .then((list) => { setCompanies(list); if (list.length > 0) setSelectedCompany(list[0] ?? null); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadCompanyData = useCallback(async (company: Company) => {
    const [a, w] = await Promise.all([
      apiFetch<Agent[]>(`/agents?companyId=${company.id}`),
      apiFetch<WorkItem[]>(`/work-items?companyId=${company.id}`),
    ]);
    setAgents(a); setWorkItems(w);
  }, []);

  useEffect(() => {
    if (selectedCompany) void loadCompanyData(selectedCompany);
  }, [selectedCompany, tick, loadCompanyData]);

  useEffect(() => {
    if (!selectedCompany || (tab !== 'agents' && tab !== 'runs')) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [selectedCompany, tab]);

  const runningCount = agents.filter((a) => a.status === 'running').length;

  return (
    <>
      <StyleInjector />
      <div style={{ fontFamily: FONT_SANS, background: C.bg, color: C.text, minHeight: '100vh' }}>

        {/* ── Header ── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 28px', height: 54,
          background: C.surface,
          borderBottom: `1px solid ${C.border}`,
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <HexLogo size={26} />
            <span style={{ fontSize: 17, fontWeight: 800, letterSpacing: '-0.01em' }}>hive</span>
            <span style={{
              fontSize: 11, color: C.muted, fontWeight: 400,
              borderLeft: `1px solid ${C.border}`, paddingLeft: 12, marginLeft: 2,
            }}>
              Your entire engineering team. Zero salaries.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {runningCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.amber, fontWeight: 600 }}>
                <Dot status="running" size={7} />
                {runningCount} agent{runningCount !== 1 ? 's' : ''} running
              </div>
            )}
            <a
              href="http://localhost:3100/docs"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 12, color: C.muted, textDecoration: 'none', fontWeight: 500 }}
            >
              API docs ↗
            </a>
          </div>
        </header>

        {/* ── Company selector ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 28px',
          height: 44, background: C.surface, borderBottom: `1px solid ${C.border}`,
        }}>
          <span style={{ fontSize: 11, color: C.muted, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginRight: 4 }}>
            Company
          </span>
          {companies.map((c) => (
            <button key={c.id} onClick={() => { setSelectedCompany(c); setTab('agents'); }} style={{
              padding: '4px 12px', fontSize: 13, fontFamily: FONT_SANS, fontWeight: 600,
              background: selectedCompany?.id === c.id ? C.accentDim : 'transparent',
              color: selectedCompany?.id === c.id ? C.accent : C.text,
              border: `1px solid ${selectedCompany?.id === c.id ? C.accent + '60' : C.border}`,
              cursor: 'pointer', borderRadius: 6, transition: 'all 0.15s',
            }}>
              {c.name}
            </button>
          ))}
          <button onClick={() => setSelectedCompany(null)} style={{
            padding: '4px 12px', fontSize: 13, fontFamily: FONT_SANS,
            background: 'transparent', color: C.muted,
            border: `1px dashed ${C.border}`, cursor: 'pointer', borderRadius: 6,
          }}>
            + New company
          </button>
        </div>

        {/* ── Body ── */}
        {!loading && !selectedCompany && (
          <OnboardingScreen onCreate={(company) => {
            setCompanies((cs) => [...cs, company]);
            setSelectedCompany(company);
            setTab('settings');
          }} />
        )}

        {selectedCompany && (
          <>
            {/* Tab bar */}
            <nav style={{
              display: 'flex', padding: '0 28px',
              background: C.surface, borderBottom: `1px solid ${C.border}`,
            }}>
              {TABS.map((t) => {
                const active = tab === t.id;
                return (
                  <button key={t.id} onClick={() => setTab(t.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '0 16px', height: 44, fontSize: 13, fontFamily: FONT_SANS, fontWeight: 500,
                    background: 'transparent',
                    color: active ? C.accent : C.muted,
                    border: 'none', borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent',
                    cursor: 'pointer', transition: 'color 0.15s', marginBottom: -1,
                  }}>
                    <span style={{ fontSize: 14 }}>{t.icon}</span>
                    {t.label}
                    {t.id === 'agents' && agents.length > 0 && (
                      <span style={{ fontSize: 10, color: active ? C.accentGlow : C.dimmed, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1px 5px' }}>
                        {agents.length}
                      </span>
                    )}
                    {t.id === 'board' && workItems.length > 0 && (
                      <span style={{ fontSize: 10, color: active ? C.accentGlow : C.dimmed, background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 10, padding: '1px 5px' }}>
                        {workItems.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Content */}
            <main style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>
              {tab === 'agents' && <AgentsTab company={selectedCompany} agents={agents} onRefresh={() => setTick((t) => t + 1)} />}
              {tab === 'board'  && <BoardTab company={selectedCompany} workItems={workItems} agents={agents} />}
              {tab === 'runs'   && <RunsTab companyId={selectedCompany.id} agents={agents} />}
              {tab === 'memory' && <MemoryTab companyId={selectedCompany.id} />}
              {tab === 'settings' && (
                <SettingsTab
                  company={selectedCompany}
                  agents={agents}
                  onCompanyUpdate={(u) => { setSelectedCompany(u); setCompanies((cs) => cs.map((c) => c.id === u.id ? u : c)); }}
                  onAgentUpdate={(u) => setAgents((as) => as.map((a) => a.id === u.id ? u : a))}
                />
              )}
            </main>
          </>
        )}
      </div>
    </>
  );
}
