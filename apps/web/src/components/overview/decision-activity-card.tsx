/**
 * DecisionActivityCard — UI-003 (FINAL TL HANDOFF §8): "current decision
 * activity" for the loaded decision.
 *
 * The SDK surface exposes NO decision list — reads are by id only — so
 * this surface inspects the one decision the Overview has actually loaded
 * (or says precisely that nothing is loaded and why). Every field is
 * rendered verbatim from the contract-validated DecisionResult; optional
 * fields the API did not attach are called out as absent, never filled in.
 * Real API data carries the `observed` evidence badge (Gate Q).
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { DecisionResult } from "@reckon/sdk";
import type { NextActionResult } from "@/lib/overview-data";
import styles from "./decision-activity-card.module.css";

export interface DecisionActivityCardProps {
  readonly result: NextActionResult;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.row}>
      <dt className={styles.rowKey}>{label}</dt>
      <dd className={styles.rowValue}>{children}</dd>
    </div>
  );
}

function Section({
  title,
  children,
  absent,
}: {
  title: string;
  children?: React.ReactNode;
  absent?: string;
}) {
  return (
    <section className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {absent !== undefined ? <p className={styles.absent}>{absent}</p> : children}
    </section>
  );
}

export function DecisionActivityCard({ result }: DecisionActivityCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>Decision activity</CardTitle>
          {result.status === "loaded" ? <EvidenceClassBadge evidenceClass="observed" /> : null}
        </div>
        <CardDescription>
          The contract-validated record behind the answer — chosen action, deciding policy, reasons,
          alternatives, uncertainty, schedule consequences and costs. Fields the API did not attach
          are named as absent, never filled in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {result.status === "loaded" ? (
          <DecisionDetail decision={result.decision} />
        ) : (
          <p className={styles.absent}>
            Nothing to inspect — no decision is loaded. The SDK surface exposes no decision list
            (reads are by id), so there is no &ldquo;recent decisions&rdquo; trail to show honestly;
            load a decision in the answer card above.
          </p>
        )}
        <p className={styles.related}>
          <Link href="/decisions" className={styles.relatedLink}>
            Open the Decisions workspace
            <ArrowRight aria-hidden="true" size={13} strokeWidth={1.75} />
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

function DecisionDetail({ decision }: { decision: DecisionResult }) {
  const delta = decision.scheduleDelta;
  const uncertainty = decision.uncertainty;
  const latency = decision.latency;
  const decidedAt = new Date(decision.at).toISOString();

  return (
    <div className={styles.detail}>
      <dl className={styles.rows}>
        <DetailRow label="Decision">
          <code className={styles.code}>{decision.decisionId}</code>
        </DetailRow>
        <DetailRow label="Request">
          <code className={styles.code}>{decision.requestId}</code>
        </DetailRow>
        <DetailRow label="Decided at">
          <time className={styles.code} dateTime={decidedAt}>
            {decidedAt}
          </time>
        </DetailRow>
        <DetailRow label="Action">
          <Badge uppercase>{decision.action}</Badge>
        </DetailRow>
        <DetailRow label="Policy">
          <code className={styles.code}>{decision.policy.policyId}</code>
          <span className={styles.dim}>@</span>
          <code className={styles.code}>{decision.policy.version}</code>
        </DetailRow>
        <DetailRow label="Tenant">
          <code className={styles.code}>{decision.tenant.tenantId}</code>
          {decision.tenant.workspaceId === undefined ? null : (
            <>
              <span className={styles.dim}>·</span>
              <code className={styles.code}>{decision.tenant.workspaceId}</code>
            </>
          )}
        </DetailRow>
        {decision.provenance === undefined ? null : (
          <DetailRow label="Provenance">
            <code className={styles.code}>{decision.provenance.system}</code>
            {decision.provenance.version === undefined ? null : (
              <>
                <span className={styles.dim}>·</span>
                <span>v{decision.provenance.version}</span>
              </>
            )}
            {decision.provenance.correlationId === undefined ? null : (
              <>
                <span className={styles.dim}>·</span>
                <code className={styles.code}>{decision.provenance.correlationId}</code>
              </>
            )}
          </DetailRow>
        )}
      </dl>

      <Section
        title="Why"
        absent={
          decision.reasons.length === 0
            ? "No reasons were attached to this decision — the contract makes them optional."
            : undefined
        }
      >
        <ul className={styles.reasons}>
          {decision.reasons.map((reason) => (
            <li key={reason.code} className={styles.reason}>
              <code className={styles.code}>{reason.code}</code>
              <span className={styles.reasonMessage}>{reason.message}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title={`Alternatives considered (${decision.alternatives.length})`}
        absent={
          decision.alternatives.length === 0
            ? "No alternatives were reported on this decision."
            : undefined
        }
      >
        <ul className={styles.alternatives}>
          {decision.alternatives.map((alternative) => (
            <li key={alternative.experienceId} className={styles.alternative}>
              <code className={styles.code}>{alternative.experienceId}</code>
              {alternative.score === undefined ? null : (
                <span className={styles.alternativeMeta}>score {alternative.score} (as reported)</span>
              )}
              {alternative.reason === undefined ? null : (
                <span className={styles.alternativeMeta}>{alternative.reason}</span>
              )}
              {alternative.excludedBy === undefined ? null : (
                <span className={styles.alternativeMeta}>excluded by: {alternative.excludedBy}</span>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Uncertainty"
        absent={
          uncertainty === undefined
            ? "Not provided on this decision — uncertainty is optional in the contract, and Reckon Studio does not invent confidence."
            : undefined
        }
      >
        <dl className={styles.rows}>
          {uncertainty?.confidence === undefined ? null : (
            <DetailRow label="Confidence">{uncertainty.confidence} (as reported)</DetailRow>
          )}
          {uncertainty?.spread === undefined ? null : (
            <DetailRow label="Spread">{uncertainty.spread} (as reported)</DetailRow>
          )}
          {uncertainty?.disagreement === undefined ? null : (
            <DetailRow label="Disagreement">{uncertainty.disagreement} (as reported)</DetailRow>
          )}
          {uncertainty?.oodScore === undefined ? null : (
            <DetailRow label="OOD score">{uncertainty.oodScore} (as reported)</DetailRow>
          )}
          {uncertainty?.method === undefined ? null : (
            <DetailRow label="Method">
              <code className={styles.code}>{uncertainty.method}</code>
            </DetailRow>
          )}
        </dl>
      </Section>

      <Section
        title="Schedule consequences"
        absent={
          delta === undefined
            ? "This decision ordered no schedule changes (no scheduleDelta attached)."
            : undefined
        }
      >
        {delta === undefined ? null : (
          <dl className={styles.rows}>
            <DetailRow label="Schedule action">
              <Badge uppercase>{delta.action}</Badge>
            </DetailRow>
            {delta.planId === undefined ? null : (
              <DetailRow label="Plan">
                <code className={styles.code}>{delta.planId}</code>
              </DetailRow>
            )}
            <DetailRow label="Enqueued">
              {delta.enqueue.length === 0 ? (
                <span className={styles.dim}>none</span>
              ) : (
                delta.enqueue.map((id) => (
                  <code key={id} className={styles.code}>
                    {id}
                  </code>
                ))
              )}
            </DetailRow>
            <DetailRow label="Dequeued">
              {delta.dequeue.length === 0 ? (
                <span className={styles.dim}>none</span>
              ) : (
                delta.dequeue.map((id) => (
                  <code key={id} className={styles.code}>
                    {id}
                  </code>
                ))
              )}
            </DetailRow>
            {delta.resumeCheckpoint === undefined ? null : (
              <DetailRow label="Resume checkpoint">
                <code className={styles.code}>{delta.resumeCheckpoint.experienceId}</code>
                <span className={styles.dim}>· resume token held by the host</span>
              </DetailRow>
            )}
          </dl>
        )}
      </Section>

      <Section
        title="Latency & cost"
        absent={
          latency === undefined
            ? "No latency or cost metadata on this decision — the cost fields are optional in the contract."
            : undefined
        }
      >
        {latency === undefined ? null : (
          <dl className={styles.rows}>
            {latency.latencyMsP50 === undefined ? null : (
              <DetailRow label="Latency p50">{latency.latencyMsP50}ms (as reported)</DetailRow>
            )}
            {latency.latencyMsP95 === undefined ? null : (
              <DetailRow label="Latency p95">{latency.latencyMsP95}ms (as reported)</DetailRow>
            )}
            {latency.inferenceCost === undefined ? null : (
              <DetailRow label="Inference cost">
                {latency.inferenceCost}
                {latency.currency === undefined ? "" : ` ${latency.currency}`} (as reported)
              </DetailRow>
            )}
          </dl>
        )}
      </Section>
    </div>
  );
}
