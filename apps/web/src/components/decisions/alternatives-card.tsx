/**
 * AlternativesCard (UI-004) — candidates vs decision: the non-selected
 * experiences as the deciding policy evaluated them (the frozen
 * `alternatives` array of the decision result), partitioned by the
 * contract's own signal — `excludedBy` names the constraint/gate that
 * filtered an alternative; alternatives without it were considered.
 *
 * Each alternative renders exactly the fields the record carries:
 * experienceId, score (the policy's own estimate), uncertainty
 * (confidence/spread/… as returned), reason, exclusion gate. Absent
 * fields render "not provided".
 *
 * HONESTY NOTE (Gate Q): the SUBMITTED candidate set (host retrieval
 * ids, sources, rank/score hints) is a decision-REQUEST field and is not
 * part of the retrieved record — the card says so instead of inventing
 * retrieval provenance.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceClassBadge } from "@/components/ui/evidence-class-badge";
import type { DecisionResult } from "@reckon/sdk";
import {
  formatExactNumber,
  partitionAlternatives,
  uncertaintySummary,
  type AlternativeView,
} from "@/lib/decision-view";
import { CodeValue, MutedNote, NotProvided } from "./decision-fields.js";
import styles from "./alternatives-card.module.css";

export interface AlternativesCardProps {
  decision: DecisionResult;
}

export function AlternativesCard({ decision }: AlternativesCardProps) {
  const { considered, filtered } = partitionAlternatives(decision.alternatives);
  const total = decision.alternatives.length;

  return (
    <Card>
      <CardHeader>
        <div className={styles.titleRow}>
          <CardTitle>Candidates vs decision</CardTitle>
          <EvidenceClassBadge evidenceClass="observed" />
        </div>
        <CardDescription>
          The non-selected experiences as the deciding policy evaluated them — against the
          selected experience above. Scores and uncertainty are the policy&rsquo;s reported
          estimates, not measurements.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <MutedNote>
            This decision record carries no alternatives — the policy reported only the
            selected experience (or none). When the record lists alternatives, they render
            here; the studio does not invent candidates.
          </MutedNote>
        ) : (
          <>
            <p className={styles.counts}>
              {considered.length} considered
              {filtered.length === 0 ? null : (
                <>
                  {" · "}
                  <span className={styles.filteredCount}>{filtered.length} filtered</span>
                </>
              )}
              {" · "}
              {total} total on the record
            </p>
            {considered.length === 0 ? null : (
              <section className={styles.group} aria-label="Considered alternatives">
                <h4 className={styles.groupHeading}>Considered by the policy</h4>
                <ul className={styles.list}>
                  {considered.map((view) => (
                    <AlternativeRow key={view.alternative.experienceId} view={view} />
                  ))}
                </ul>
              </section>
            )}
            {filtered.length === 0 ? null : (
              <section className={styles.group} aria-label="Filtered alternatives">
                <h4 className={styles.groupHeading}>Filtered — excluded by a gate</h4>
                <ul className={styles.list}>
                  {filtered.map((view) => (
                    <AlternativeRow key={view.alternative.experienceId} view={view} filtered />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <MutedNote>
          The submitted candidate set (retrieval sources, rank and score hints) is a
          decision-request field; the retrieval surface returns the policy&rsquo;s evaluated
          alternatives only. Request-level candidate provenance would render here when the
          API returns it — absent means not provided, not zero.
        </MutedNote>
      </CardContent>
    </Card>
  );
}

function AlternativeRow({ view, filtered = false }: { view: AlternativeView; filtered?: boolean }) {
  const { alternative } = view;
  const uncertainty =
    alternative.uncertainty === undefined ? undefined : uncertaintySummary(alternative.uncertainty);

  return (
    <li className={filtered ? `${styles.item} ${styles.itemFiltered}` : styles.item}>
      <div className={styles.itemHead}>
        <CodeValue>{alternative.experienceId}</CodeValue>
        {alternative.excludedBy === undefined ? null : (
          <Badge uppercase className={styles.excludedByBadge}>
            excluded by: {alternative.excludedBy}
          </Badge>
        )}
      </div>
      <dl className={styles.itemRows}>
        <div className={styles.itemRow}>
          <dt className={styles.itemKey}>score</dt>
          <dd className={styles.itemValue}>
            {alternative.score === undefined ? (
              <NotProvided />
            ) : (
              <CodeValue>{formatExactNumber(alternative.score)}</CodeValue>
            )}
          </dd>
        </div>
        <div className={styles.itemRow}>
          <dt className={styles.itemKey}>uncertainty</dt>
          <dd className={styles.itemValue}>
            {uncertainty === undefined ? (
              <NotProvided />
            ) : (
              <span className={styles.uncertainty}>{uncertainty}</span>
            )}
          </dd>
        </div>
        <div className={styles.itemRow}>
          <dt className={styles.itemKey}>reason</dt>
          <dd className={styles.itemValue}>
            {alternative.reason === undefined ? (
              <NotProvided />
            ) : (
              <span className={styles.reason}>{alternative.reason}</span>
            )}
          </dd>
        </div>
      </dl>
    </li>
  );
}
