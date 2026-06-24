import { sql } from 'drizzle-orm';
import type { Db } from '@aisc/db';

// A node in the work-item context tree as seen by an agent.
// Assigned items get full detail; ancestors/siblings get a 1-line summary.
export interface ContextNode {
  id: string;
  identifier: string;
  type: string;
  title: string;
  status: string;
  priority: string;
  assigned: boolean;
  description?: string;
  children: ContextNode[];
}

// Compact serialization for agent prompts — tree-indented text, not raw JSON.
// Assigned nodes get full description; ancestors/siblings get title+status only.
// Saves ~60-80% tokens vs passing the raw flat work item list.
export function serializeContextGraph(roots: ContextNode[], indent = ''): string {
  const lines: string[] = [];

  for (const node of roots) {
    const marker = node.assigned ? '★' : '·';
    const detail = `[${node.identifier}] ${node.title} (${node.type} · ${node.status} · ${node.priority})`;
    lines.push(`${indent}${marker} ${detail}`);

    if (node.assigned && node.description) {
      const descLines = node.description.trim().split('\n').slice(0, 8); // cap at 8 lines
      for (const dl of descLines) {
        lines.push(`${indent}    ${dl}`);
      }
    }

    if (node.children.length > 0) {
      lines.push(serializeContextGraph(node.children, indent + '  '));
    }
  }

  return lines.join('\n');
}

// Uses a PostgreSQL recursive CTE to walk the full ancestor chain for each
// assigned work item, then re-assembles the subtree in memory.
// This replaces the flat `findMany` in buildContext and gives agents:
//   1. Their assigned items (full detail)
//   2. Parent/grandparent context (title + status only)
//   3. Siblings (title + status only) so they know what else is in the epic
export async function buildContextGraph(
  db: Db,
  assignedItemIds: string[],
  companyId: string,
): Promise<ContextNode[]> {
  if (assignedItemIds.length === 0) return [];

  // Recursive CTE: walk upward from each assigned item to the root,
  // collecting all ancestors. Then fetch siblings of every ancestor.
  const result = await db.execute(sql`
    WITH RECURSIVE ancestors AS (
      -- seed: the assigned items themselves
      SELECT
        w.id, w.identifier, w.type, w.title, w.status, w.priority,
        w.description, w.parent_id, w.company_id,
        0 AS depth,
        w.id::text AS path
      FROM work_items w
      WHERE w.id = ANY(${sql.raw(`ARRAY['${assignedItemIds.join("','")}']::uuid[]`)}
      )
        AND w.company_id = ${companyId}

      UNION ALL

      -- walk up to parents
      SELECT
        parent.id, parent.identifier, parent.type, parent.title,
        parent.status, parent.priority, parent.description,
        parent.parent_id, parent.company_id,
        a.depth + 1,
        parent.id::text || '>' || a.path
      FROM work_items parent
      JOIN ancestors a ON a.parent_id = parent.id
      WHERE parent.company_id = ${companyId}
    ),
    -- get siblings of every node in the ancestor chain
    siblings AS (
      SELECT DISTINCT
        w.id, w.identifier, w.type, w.title, w.status, w.priority,
        NULL::text AS description,
        w.parent_id, w.company_id,
        -1 AS depth,
        '' AS path
      FROM work_items w
      JOIN ancestors a ON w.parent_id = a.id
      WHERE w.company_id = ${companyId}
        AND w.id NOT IN (SELECT id FROM ancestors)
    )
    SELECT * FROM ancestors
    UNION ALL
    SELECT * FROM siblings
    ORDER BY depth DESC, path
  `);

  const rows = result as unknown as Array<{
    id: string;
    identifier: string;
    type: string;
    title: string;
    status: string;
    priority: string;
    description: string | null;
    parent_id: string | null;
    company_id: string;
    depth: number;
  }>;

  const assignedSet = new Set(assignedItemIds);
  const nodeMap = new Map<string, ContextNode>();

  // Build nodes
  for (const row of rows) {
    if (nodeMap.has(row.id)) continue;
    const isAssigned = assignedSet.has(row.id);
    nodeMap.set(row.id, {
      id: row.id,
      identifier: row.identifier,
      type: row.type,
      title: row.title,
      status: row.status,
      priority: row.priority,
      assigned: isAssigned,
      children: [],
      ...(isAssigned && row.description ? { description: row.description } : {}),
    });
  }

  // Wire parent → children
  const roots: ContextNode[] = [];
  for (const row of rows) {
    const node = nodeMap.get(row.id);
    if (!node) continue;
    if (row.parent_id && nodeMap.has(row.parent_id)) {
      const parent = nodeMap.get(row.parent_id)!;
      if (!parent.children.find((c) => c.id === row.id)) {
        parent.children.push(node);
      }
    } else if (!row.parent_id || !nodeMap.has(row.parent_id)) {
      if (!roots.find((r) => r.id === row.id)) {
        roots.push(node);
      }
    }
  }

  // Sort children: assigned items first, then by identifier
  function sortChildren(nodes: ContextNode[]) {
    nodes.sort((a, b) => {
      if (a.assigned !== b.assigned) return a.assigned ? -1 : 1;
      return a.identifier.localeCompare(b.identifier);
    });
    for (const n of nodes) sortChildren(n.children);
  }
  sortChildren(roots);

  return roots;
}
