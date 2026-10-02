/**
 * DecisionSummaryCard (UI-004) — the headline answer of the retrieved
 * decision record: ACTION, confidence (only as returned — never computed,
 * never invented), the deciding policy identity/version, the record
 * identity (decision/request/tenant/time), the scheduler's own reasons
 * trail, and provenance.
 *
 * Evidence class: `observed` — the entire record was retrieved from the
 * real Reckon API runtime (the same treatment the foundation's
 * reachability probe row carries). The confidence/score VALUES are the
 * deciding policy's own reported estimates; the card copy states that so
 * an estimate is never mistaken for a measurement (Gate Q).
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { DecisionResult } from "@reckon/sdk";
import {
  ACTION_COPY,
  formatEpochMs,
  formatExactNumber,
  uncertaintySummary,
} from "@/lib/decision-view";
import { CodeValue, FieldRow, FieldRows, NotProvided } from "./decision-fields";
import styles from "./decision-summary-card.module.css";

export interface DecisionSummaryCardProps {
  decision: DecisionResult;
}

export function DecisionSummaryCard({ decision }: DecisionSummaryCardProps) {
  const confidence =
    decision.uncertainty?.confidence === undefined
      ? undefined
      : formatExactNumber(decision.uncertainty.confidence);
  const method = decision.uncertainty?.method;

  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>The decision</CardTitle>
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
        <CardDescription>
          The action the deciding policy returned for this request — retrieved from the real
          API, exactly as recorded. Confidence and scores are the policy&rsquo;s own reported
          estimates, not measurements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.actionBlock}>
          <span className={styles.actionWord}>{decision.action}</span>
          <span className={styles.actionCopy}>{ACTION_COPY[decision.action]}</span>
        </div>

        <FieldRows>
          <FieldRow label="Confidence">
            {confidence === undefined ? (
              <NotProvided note="this decision record carries no confidence — the studio never computes or infers one" />
            ) : (
              <>
                <CodeValue>{confidence}</CodeValue>
                {method === undefined ? null : (
                  <span className={styles.valueNote}>method: {method}</span>
                )}
              </>
            )}
          </FieldRow>
          <FieldRow label="Deciding policy">
            <CodeValue>
              {decision.policy.policyId}@{decision.policy.version}
            </CodeValue>
            <span className={styles.valueNote}>
              the policy identity that produced this action, as returned
            </span>
          </FieldRow>
          <FieldRow label="Decision id">
            <CodeValue>{decision.decisionId}</CodeValue>
          </FieldRow>
          <FieldRow label="Request id">
            <CodeValue>{decision.requestId}</CodeValue>
          </FieldRow>
          <FieldRow label="Tenant">
            <CodeValue>{decision.tenant.tenantId}</CodeValue>
            {decision.tenant.workspaceId === undefined ? null : (
              <span className={styles.valueNote}>
                workspace <code>{decision.tenant.workspaceId}</code>
              </span>
            )}
          </FieldRow>
          <FieldRow label="Decided at">
            <time dateTime={formatEpochMs(decision.at)} className={styles.timeValue}>
              <CodeValue>{formatEpochMs(decision.at)}</CodeValue>
            </time>
          </FieldRow>
          <FieldRow label="Record contract">
            <Badge>{decision.schema}</Badge>
            <Badge>version {decision.schemaVersion}</Badge>
          </FieldRow>
        </FieldRows>

        <section className={styles.reasonsSection} aria-label="Why this action">
          <h4 className={styles.sectionHeading}>Why this action</h4>
          {decision.reasons.length === 0 ? (
            <NotProvided note="the deciding policy reported no reasons on this record" />
          ) : (
            <ul className={styles.reasonsList}>
              {decision.reasons.map((reason) => (
                <li key={reason.code + reason.message} className={styles.reasonItem}>
                  <CodeValue>{reason.code}</CodeValue>
                  <span className={styles.reasonMessage}>{reason.message}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.reasonsNote}>
            The scheduler&rsquo;s own reason trail, verbatim — switch and interruption economics
            (net value, thresholds, gating) appear here when the policy reported them.
          </p>
        </section>

        <section className={styles.provenanceSection} aria-label="Provenance">
          <h4 className={styles.sectionHeading}>Provenance</h4>
          <FieldRows>
            <FieldRow label="Produced by">
              {decision.provenance?.system === undefined ? (
                <NotProvided />
              ) : (
                <CodeValue>{decision.provenance.system}</CodeValue>
              )}
              {decision.provenance?.version === undefined ? null : (
                <span className={styles.valueNote}>version {decision.provenance.version}</span>
              )}
            </FieldRow>
            <FieldRow label="Correlation id">
              {decision.provenance?.correlationId === undefined ? (
                <NotProvided />
              ) : (
                <CodeValue>{decision.provenance.correlationId}</CodeValue>
              )}
            </FieldRow>
            <FieldRow label="Uncertainty summary">
              {decision.uncertainty === undefined ? (
                <NotProvided note="the record carries no uncertainty metadata" />
              ) : (
                <span className={styles.valueNote}>
                  {uncertaintySummary(decision.uncertainty) ?? "carried, but with no fields set"}
                </span>
              )}
            </FieldRow>
          </FieldRows>
        </section>
      </CardContent>
    </Card>
  );
}
