/**
 * CostsConsequencesCard (UI-004) — switching/interruption economics,
 * schedule consequences and uncertainty, exactly as the retrieved record
 * carries them:
 *
 *  - uncertainty: the full frozen `Uncertainty` breakdown, field by field
 *    (confidence, spread, disagreement, ood score, method) — present
 *    fields render their exact values, absent fields render "not
 *    provided". Nothing is aggregated, derived or inferred.
 *  - schedule consequences: the `scheduleDelta` (action, plan, enqueued,
 *    dequeued, resume checkpoint).
 *  - decision cost/latency: the optional `latency` cost metadata (p50/p95,
 *    inference cost + currency).
 *  - switching/interruption cost: the decision-result contract carries no
 *    structured switch-cost fields — when the deciding policy reports
 *    switch economics (net value, thresholds, opportunity gating), they
 *    appear in the reasons trail on the decision card. The card says
 *    exactly that instead of inventing numbers.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { DecisionResult } from "@reckon/sdk";
import { formatExactNumber, uncertaintyEntries } from "@/lib/decision-view";
import { CodeValue, FieldRow, FieldRows, MutedNote, NotProvided } from "./decision-fields.js";
import styles from "./costs-consequences-card.module.css";

export interface CostsConsequencesCardProps {
  decision: DecisionResult;
}

export function CostsConsequencesCard({ decision }: CostsConsequencesCardProps) {
  const delta = decision.scheduleDelta;

  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>Costs &amp; consequences</CardTitle>
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
        <CardDescription>
          What this decision costs and changes — uncertainty metadata, schedule consequences
          and latency/cost, each exactly as the record carries it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <section className={styles.section} aria-label="Uncertainty">
          <h4 className={styles.sectionHeading}>Uncertainty</h4>
          {decision.uncertainty === undefined ? (
            <NotProvided note="this decision record carries no uncertainty metadata — the deciding policy reported none, and the studio never infers it" />
          ) : (
            <FieldRows>
              {uncertaintyEntries(decision.uncertainty).map((entry) => (
                <FieldRow key={entry.field} label={entry.label}>
                  {entry.value === undefined ? (
                    <NotProvided />
                  ) : (
                    <CodeValue>{entry.value}</CodeValue>
                  )}
                </FieldRow>
              ))}
            </FieldRows>
          )}
          <p className={styles.sectionNote}>
            Values are the deciding policy&rsquo;s own reported estimates, verbatim — never
            recomputed, normalized or invented by the studio.
          </p>
        </section>

        <section className={styles.section} aria-label="Schedule consequences">
          <h4 className={styles.sectionHeading}>Schedule consequences</h4>
          {delta === undefined ? (
            <NotProvided note="this decision carries no schedule delta — the plan state is unchanged" />
          ) : (
            <FieldRows>
              <FieldRow label="Action">
                <CodeValue>{delta.action}</CodeValue>
              </FieldRow>
              <FieldRow label="Plan">
                {delta.planId === undefined ? (
                  <NotProvided />
                ) : (
                  <CodeValue>{delta.planId}</CodeValue>
                )}
              </FieldRow>
              <FieldRow label="Enqueued">
                {delta.enqueue.length === 0 ? (
                  <span className={styles.valueNote}>none — nothing is added to the queue</span>
                ) : (
                  delta.enqueue.map((id) => <CodeValue key={id}>{id}</CodeValue>)
                )}
              </FieldRow>
              <FieldRow label="Dequeued">
                {delta.dequeue.length === 0 ? (
                  <span className={styles.valueNote}>none — nothing is removed from the queue</span>
                ) : (
                  delta.dequeue.map((id) => <CodeValue key={id}>{id}</CodeValue>)
                )}
              </FieldRow>
              <FieldRow label="Resume checkpoint">
                {delta.resumeCheckpoint === undefined ? (
                  <NotProvided note="no interrupted experience is checkpointed by this decision" />
                ) : (
                  <>
                    <CodeValue>{delta.resumeCheckpoint.experienceId}</CodeValue>
                    <span className={styles.valueNote}>
                      host-interpreted resume token{" "}
                      <code>{delta.resumeCheckpoint.resumeToken}</code>
                    </span>
                  </>
                )}
              </FieldRow>
            </FieldRows>
          )}
        </section>

        <section className={styles.section} aria-label="Decision cost and latency">
          <h4 className={styles.sectionHeading}>Decision cost &amp; latency</h4>
          {decision.latency === undefined ? (
            <NotProvided note="the record carries no latency/cost metadata (the contract makes it optional; measured latency is an observability concern, not a percentile claim)" />
          ) : (
            <FieldRows>
              <FieldRow label="Latency p50">
                {decision.latency.latencyMsP50 === undefined ? (
                  <NotProvided />
                ) : (
                  <CodeValue>{formatExactNumber(decision.latency.latencyMsP50)}ms</CodeValue>
                )}
              </FieldRow>
              <FieldRow label="Latency p95">
                {decision.latency.latencyMsP95 === undefined ? (
                  <NotProvided />
                ) : (
                  <CodeValue>{formatExactNumber(decision.latency.latencyMsP95)}ms</CodeValue>
                )}
              </FieldRow>
              <FieldRow label="Inference cost">
                {decision.latency.inferenceCost === undefined ? (
                  <NotProvided />
                ) : (
                  <>
                    <CodeValue>{formatExactNumber(decision.latency.inferenceCost)}</CodeValue>
                    {decision.latency.currency === undefined ? null : (
                      <span className={styles.valueNote}>{decision.latency.currency}</span>
                    )}
                  </>
                )}
              </FieldRow>
            </FieldRows>
          )}
        </section>

        <section className={styles.section} aria-label="Switching and interruption cost">
          <h4 className={styles.sectionHeading}>Switching &amp; interruption cost</h4>
          <MutedNote>
            The frozen decision-result contract carries no structured switch-cost fields. When
            the deciding policy evaluates a switch, it reports the economics — net value,
            thresholds, interruption-opportunity gating — in the reasons trail on the decision
            card above. Absent there means not provided; the studio does not recompute
            interruption cost.
          </MutedNote>
        </section>
      </CardContent>
    </Card>
  );
}
