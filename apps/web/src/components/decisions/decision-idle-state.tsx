/**
 * DecisionIdleState (UI-004) — the honest-empty default for the Decisions
 * workspace (no decision id requested yet).
 *
 * NEUTRAL tone by design (reference §7 reserves the red degraded card for
 * failures): nothing has failed — nothing was requested. The card says
 * precisely what is missing (no decision loaded), why the workspace
 * starts empty (the SDK decision surface has no listing operation), and
 * what to do (the lookup field above).
 *
 * When the demo API key is not configured, an honest warning row states
 * it: lookups will report the precise configuration failure rather than
 * fabricate data (Gate Q).
 */
import { TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MutedNote } from "./decision-fields.js";
import styles from "./decision-idle-state.module.css";

export interface DecisionIdleStateProps {
  /** True when RECKON_DEMO_API_KEY is absent in the server environment. */
  apiKeyNotConfigured: boolean;
}

export function DecisionIdleState({ apiKeyNotConfigured }: DecisionIdleStateProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>No decision loaded</CardTitle>
        <CardDescription>
          Enter a decision id in the field above — this workspace renders exactly what the
          Reckon API returns for it, or says precisely what is missing.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {apiKeyNotConfigured ? (
          <div className={styles.warningRow}>
            <TriangleAlert
              className={styles.warningIcon}
              aria-hidden="true"
              strokeWidth={1.75}
              size={14}
            />
            <Badge uppercase>RECKON_DEMO_API_KEY not set</Badge>
            <span className={styles.warningText}>
              lookups will report the exact configuration failure — no data is fabricated.
            </span>
          </div>
        ) : null}
        <MutedNote>
          The SDK decision surface exposes two operations —{" "}
          <code className={styles.inlineCode}>POST /v1/decisions</code> (request a decision) and{" "}
          <code className={styles.inlineCode}>GET /v1/decisions/&#123;id&#125;</code> (lookup).
          There is no recent-decisions listing yet, so this workspace starts empty rather than
          showing a fabricated list: a decision appears here once you retrieve its id.
        </MutedNote>
      </CardContent>
    </Card>
  );
}
