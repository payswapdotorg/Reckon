"use client";

/**
 * OrganizationGraph (UI-007) — the Agent Organization as an INTERACTIVE
 * graph: bodies as nodes, delegation/communication edges as arrows
 * (Generalist → Researcher/Planner → Critic reading order emerges from
 * the layered layout computed in the pure view model).
 *
 * Pure SVG — NO new dependencies (the no-deps law). Interactivity is
 * keyboard-accessible node selection (click + Enter/Space) revealing the
 * node's detail row; no drag required. The selected node's detail card is
 * rendered by the parent (server) through a hidden detail section driven
 * by URL fragment-free client state here.
 */
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { AgentOrganization } from "@reckon/sdk";
import { modelAssignmentsByBody, orgGraph } from "@/lib/agent-view";
import styles from "./organization-graph.module.css";

const NODE_W = 168;
const NODE_H = 64;

export interface OrganizationGraphProps {
  readonly organization: AgentOrganization;
}

export function OrganizationGraph({ organization }: OrganizationGraphProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const graph = orgGraph(organization);
  const assignments = modelAssignmentsByBody(organization);
  const bodiesById = new Map(organization.bodies.map((body) => [body.bodyId, body]));

  const width = Math.max(...graph.nodes.map((n) => n.x)) + NODE_W + 40;
  const height = Math.max(...graph.nodes.map((n) => n.y)) + NODE_H + 40;

  const selectedBody = selected === null ? null : (bodiesById.get(selected) ?? null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Organization graph <code className={styles.id}>{organization.organizationId}</code>
        </CardTitle>
        <CardDescription>
          Bodies as nodes, delegation/communication edges as arrows — left-to-right layering
          follows the delegation order. Select a node (click or keyboard) to inspect that body;
          the graph is the DECLARATION, not a live runtime view.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.scroll}>
          <svg
            role="img"
            aria-label={`Agent organization ${organization.organizationId} graph`}
            viewBox={`0 0 ${width} ${height}`}
            className={styles.svg}
          >
            {graph.edges.map((edge) => {
              const from = graph.nodes.find((n) => n.bodyId === edge.from);
              const to = graph.nodes.find((n) => n.bodyId === edge.to);
              if (from === undefined || to === undefined) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x;
              const y2 = to.y + NODE_H / 2;
              const mid = (x1 + x2) / 2;
              const active = selected === edge.from || selected === edge.to;
              return (
                <g key={edge.edgeId} className={active ? styles.edgeActive : styles.edge}>
                  <path
                    d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2 - 8} ${y2}`}
                    fill="none"
                  />
                  <polygon points={`${x2},${y2} ${x2 - 9},${y2 - 4} ${x2 - 9},${y2 + 4}`} />
                  <text x={mid} y={(y1 + y2) / 2 - 6} textAnchor="middle" className={styles.edgeLabel}>
                    {edge.label}
                  </text>
                </g>
              );
            })}
            {graph.nodes.map((node) => {
              const active = selected === node.bodyId;
              const assignment = assignments.get(node.bodyId);
              return (
                <g
                  key={node.bodyId}
                  className={`${styles.node} ${active ? styles.nodeActive : ""}`}
                  onClick={() => setSelected(active ? null : node.bodyId)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(active ? null : node.bodyId);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-pressed={active}
                  aria-label={`Body ${node.bodyId} (${node.roleId})`}
                >
                  <rect x={node.x} y={node.y} width={NODE_W} height={NODE_H} rx={10} />
                  <text x={node.x + 12} y={node.y + 24} className={styles.nodeRole}>
                    {node.roleId}
                  </text>
                  <text x={node.x + 12} y={node.y + 44} className={styles.nodeId}>
                    {node.bodyId.length > 16 ? `${node.bodyId.slice(0, 14)}…` : node.bodyId}
                  </text>
                  {assignment !== undefined ? (
                    <text x={node.x + 12} y={node.y + 58} className={styles.nodeModel}>
                      {assignment.modelId}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>

        <div className={styles.selectedDetail} aria-live="polite">
          {selectedBody === null ? (
            <p className={styles.hint}>
              No body selected — select a node above to inspect its declared envelope.
            </p>
          ) : (
            <div className={styles.detailRow}>
              <Badge>v{selectedBody.version}</Badge>
              <span className={styles.detailRole}>{selectedBody.role.roleId}</span>
              <code className={styles.detailId}>{selectedBody.bodyId}</code>
              <span className={styles.detailDesc}>{selectedBody.role.description}</span>
              <span className={styles.detailModel}>
                {assignments.get(selectedBody.bodyId) === undefined
                  ? "model assignment: not declared for this body"
                  : `model: ${assignments.get(selectedBody.bodyId)?.modelId} via ${assignments.get(selectedBody.bodyId)?.modelAdapterId}`}
              </span>
            </div>
          )}
        </div>

        <div className={styles.legends}>
          <div className={styles.legend}>
            <h4 className={styles.legendTitle}>Termination rules</h4>
            <ul className={styles.legendList}>
              {organization.terminationRules.map((rule, index) => (
                <li key={index} className={styles.legendItem}>
                  {rule.kind}
                </li>
              ))}
            </ul>
          </div>
          <div className={styles.legend}>
            <h4 className={styles.legendTitle}>Memory topology</h4>
            <p className={styles.legendText}>
              {organization.memoryTopology.sharedMemories.length === 0
                ? "no shared memories declared"
                : `${organization.memoryTopology.sharedMemories.length} shared memory group(s)`}
              {" · "}
              {organization.memoryTopology.privateMemories.length === 0
                ? "no private memories declared"
                : `${organization.memoryTopology.privateMemories.length} private`}
            </p>
          </div>
          <div className={styles.legend}>
            <h4 className={styles.legendTitle}>Honesty note</h4>
            <p className={styles.legendText}>
              Runtime status, failures, lineage and live baseline comparison are observability
              surfaces, not declaration fields — they are absent here by design (Gate Q), never
              simulated.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
