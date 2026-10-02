/**
 * Agent view model (UI-007) — pure mapping from the frozen
 * AgentBody/AgentOrganization contracts to the §12 workspace surfaces.
 *
 * HONESTY LAW (Gate Q): absent contract fields render as explicit
 * "not provided" rows; runtime observations (status, failures, lineage,
 * live baseline comparison) are NOT part of the declarations — their
 * absence is stated, never simulated.
 */
import type { AgentBody, AgentOrganization } from "@reckon/sdk";

export interface BodyFact {
  readonly label: string;
  readonly value: string;
}

/** §12 field list rendered from the contract, gaps explicit. */
export function bodyFacts(body: AgentBody): readonly BodyFact[] {
  const facts: BodyFact[] = [
    { label: "role", value: `${body.role.roleId} — ${body.role.description}` },
    { label: "model assignment", value: declaredModelOf(body) },
    { label: "tools", value: body.tools.length > 0 ? `${body.tools.length} declared` : "none declared" },
    {
      label: "observations",
      value: body.observations.length > 0 ? `${body.observations.length} specs` : "none declared",
    },
    {
      label: "memory",
      value:
        body.memoryInterfaces.length > 0
          ? `${body.memoryInterfaces.length} interfaces`
          : "none declared",
    },
    {
      label: "permissions",
      value: body.permissions.length > 0 ? `${body.permissions.length} grants` : "none declared",
    },
    {
      label: "budget",
      value:
        body.budgets.length > 0
          ? body.budgets.map((b) => budgetLabel(b)).join(" · ")
          : "none declared",
    },
    { label: "latency limits", value: latencyLabel(body) },
    { label: "evaluator", value: body.evaluator ? `${body.evaluator.evaluatorId} v${body.evaluator.version}` : "not provided" },
  ];
  return facts;
}

function declaredModelOf(body: AgentBody): string {
  const sim = body.simulatorImplementation;
  const real = body.realImplementation;
  const parts: string[] = [];
  if (sim !== undefined) parts.push(`simulator: ${sim.kind} ${sim.ref}`);
  if (real !== undefined) parts.push(`real: ${real.kind} ${real.ref}`);
  return parts.length > 0 ? parts.join(" · ") : "not declared on the body (organization-level assignments may exist)";
}

function budgetLabel(budget: {
  kind: string;
  customKind?: string;
  limit: number;
  currency?: string;
}): string {
  const name = budget.kind === "custom" && budget.customKind !== undefined ? budget.customKind : budget.kind;
  const unit = budget.currency ?? (budget.kind === "cost" ? "" : budget.kind === "wall-clock-ms" ? "ms" : budget.kind === "calls" ? " calls" : "");
  return `${name} ${budget.limit}${unit}`;
}

function latencyLabel(body: AgentBody): string {
  const limits = body.latencyLimits;
  if (limits === undefined) return "not provided";
  const parts: string[] = [];
  if (limits.softMs !== undefined) parts.push(`soft ${limits.softMs}ms`);
  if (limits.hardMs !== undefined) parts.push(`hard ${limits.hardMs}ms`);
  return parts.length > 0 ? parts.join(" · ") : "declared without numeric limits";
}

export interface GraphNode {
  readonly bodyId: string;
  readonly roleId: string;
  readonly x: number;
  readonly y: number;
}

export interface GraphEdge {
  readonly edgeId: string;
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly label: string;
}

export interface OrgGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

/**
 * Layout the organization as a layered left-to-right graph: bodies with
 * no incoming edges sit in column 0; each body's column = 1 + max column
 * of its predecessors (Kahn-style layering over the DAG). Cycles (which
 * the contract permits in principle) degrade by falling back to a ring.
 */
export function orgGraph(organization: AgentOrganization): OrgGraph {
  const bodies = organization.bodies;
  const byId = new Map(bodies.map((body) => [body.bodyId, body]));
  const incoming = new Map<string, string[]>();
  for (const body of bodies) incoming.set(body.bodyId, []);
  for (const edge of organization.edges) {
    if (byId.has(edge.fromBodyId) && byId.has(edge.toBodyId)) {
      incoming.get(edge.toBodyId)?.push(edge.fromBodyId);
    }
  }

  const columnOf = new Map<string, number>();
  const queue = [...bodies.map((body) => body.bodyId)];
  let guard = 0;
  while (queue.length > 0 && guard < bodies.length * 4) {
    guard += 1;
    const id = queue.shift()!;
    const preds = incoming.get(id) ?? [];
    if (preds.every((p) => columnOf.has(p))) {
      columnOf.set(id, preds.length === 0 ? 0 : Math.max(...preds.map((p) => columnOf.get(p)!)) + 1);
    } else {
      queue.push(id);
    }
  }
  // fallback for cyclic leftovers: append to the widest column + 1
  const columns = [...new Set([...columnOf.values()])];
  const nextCol = (columns.length > 0 ? Math.max(...columns) : -1) + 1;
  let ringIndex = 0;
  for (const body of bodies) {
    if (!columnOf.has(body.bodyId)) {
      columnOf.set(body.bodyId, nextCol);
      ringIndex += 1;
    }
  }

  const byColumn = new Map<number, string[]>();
  for (const body of bodies) {
    const col = columnOf.get(body.bodyId) ?? 0;
    if (!byColumn.has(col)) byColumn.set(col, []);
    byColumn.get(col)!.push(body.bodyId);
  }

  const nodes: GraphNode[] = [];
  const COL_W = 260;
  const ROW_H = 110;
  for (const [col, ids] of [...byColumn.entries()].sort((a, b) => a[0] - b[0])) {
    ids.forEach((id, row) => {
      nodes.push({
        bodyId: id,
        roleId: byId.get(id)?.role.roleId ?? "unknown",
        x: 40 + col * COL_W,
        y: 40 + row * ROW_H,
      });
    });
  }

  const pos = new Map(nodes.map((n) => [n.bodyId, n]));
  const edges: GraphEdge[] = organization.edges
    .filter((edge) => pos.has(edge.fromBodyId) && pos.has(edge.toBodyId))
    .map((edge) => ({
      edgeId: edge.edgeId,
      from: edge.fromBodyId,
      to: edge.toBodyId,
      kind: edge.kind,
      label: edge.kind,
    }));

  return { nodes, edges };
}

/** Model assignments keyed by body (organization-level). */
export function modelAssignmentsByBody(
  organization: AgentOrganization,
): ReadonlyMap<string, { modelAdapterId: string; modelId: string; version: string }> {
  return new Map(
    organization.modelAssignments.map((assignment) => [
      assignment.bodyId,
      {
        modelAdapterId: assignment.modelAdapterId,
        modelId: assignment.modelId,
        version: assignment.version,
      },
    ]),
  );
}
