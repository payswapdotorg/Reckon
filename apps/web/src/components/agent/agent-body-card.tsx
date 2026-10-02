/**
 * AgentBodyCard (UI-007) — the §12 Agent Body field list: ROLE, MODEL
 * ASSIGNMENT, TOOLS, OBSERVATIONS, MEMORY, PERMISSIONS, BUDGET, LATENCY,
 * EVALUATOR — each rendered from the frozen contract with explicit
 * "not provided" honesty for absent fields (Gate Q).
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentBody } from "@reckon/sdk";
import { bodyFacts } from "@/lib/agent-view";
import styles from "./agent-body-card.module.css";

export interface AgentBodyCardProps {
  readonly body: AgentBody;
}

export function AgentBodyCard({ body }: AgentBodyCardProps) {
  const facts = bodyFacts(body);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Agent Body <code className={styles.id}>{body.bodyId}</code>
        </CardTitle>
        <CardDescription>
          The declared capability envelope — every §12 field as the contract carries it; gaps are
          stated, never simulated. Runtime observations (status, failures, lineage) live in the
          observability surface, not the declaration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.headRow}>
          <Badge>v{body.version}</Badge>
          <span className={styles.role}>{body.role.roleId}</span>
        </div>
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
