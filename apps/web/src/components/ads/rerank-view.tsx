/**
 * RerankView (AD-005) — the compare/re-rank surface: the retrieval
 * lanes' own order (BEFORE — hints only) against the decision kernel's
 * order (AFTER — the ranking authority, presented VERBATIM, never
 * re-sorted by the UI). This is law-abiding by construction: the page
 * composes ONE CandidateSet through the SDK's frozen-semantics mapping
 * and ONE DecisionRequest through the existing kernel — there is NO
 * second ranking implementation anywhere in the web app.
 *
 * The kernel's answer is the defer/present/suppress truth: the action
 * (QUEUE = defer, SUGGEST = surface-as-suggestion, HOLD = suppress for
 * now, SWITCH/INTERRUPT = present) and the reasons carry the
 * context/attention/constraint WHY. Alternatives map back to their ads
 * (advertising + origin badges); a row mapping to no ad candidate is an
 * ordinary recommendation row WITHOUT the ad marks — the law-8
 * distinction, visible where the two could coexist.
 *
 * Server component by design: view rows in, sections out.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdvertisingMark } from "./advertising-mark.js";
import { AdProvenanceBadge } from "./ad-provenance-badge.js";
import { AdCodeValue, AdMutedNote } from "./ad-facts.js";
import { rerankView, type RerankView } from "@/lib/ads-view";
import type { AdQueryResult, DecisionResult, Experience } from "@reckon/sdk";
import styles from "./rerank-view.module.css";

export interface RerankViewProps {
  readonly queryResult: AdQueryResult;
  readonly decision: DecisionResult;
  readonly experiences: readonly Experience[];
  readonly clockLabel: string;
  readonly notes: readonly string[];
}

export function RerankCompareView({
  queryResult,
  decision,
  experiences,
  clockLabel,
  notes,
}: RerankViewProps) {
  const view: RerankView = rerankView({ queryResult, decision, experiences });
  return (
    <div className={styles.rerank}>
      <Card>
        <CardHeader>
          <CardTitle>The kernel&rsquo;s decision</CardTitle>
          <CardDescription>
            One candidate set (both lanes, provenance-carrying references) through ONE
            DecisionRequest — the EXISTING Reckon decision kernel is the ranking authority. The
            UI never re-sorts: the order below is the kernel&rsquo;s own.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className={styles.actionRow}>
            <span className={styles.actionPill}>
              action <strong>{view.action}</strong>
            </span>
            <span className={styles.actionMeaning}>{view.actionMeaning}</span>
          </div>
          {view.reasons.length > 0 ? (
            <ul className={styles.reasonList}>
              {view.reasons.map((reason, index) => (
                <li key={`${reason.code}-${index}`} className={styles.reasonItem}>
                  <AdCodeValue>{reason.code}</AdCodeValue>
                  <span> — {reason.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <AdMutedNote>The kernel returned no reason codes for this decision.</AdMutedNote>
          )}
          {view.scheduleDelta !== null ? (
            <AdMutedNote>
              Schedule delta: <AdCodeValue>{view.scheduleDelta}</AdCodeValue> — how the decision
              changed the plan (queue/suggest/switch semantics).
            </AdMutedNote>
          ) : null}
          <AdMutedNote>Decided at {clockLabel} (the caller-supplied evaluation clock).</AdMutedNote>
        </CardContent>
      </Card>

      <section aria-labelledby="rerank-before-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="rerank-before-heading" className={styles.sectionTitle}>
            Before — the retrieval lanes
          </h2>
          <p className={styles.sectionSubtitle}>
            The query&rsquo;s own order per lane (law 9: remembered first, then provider-supplied —
            shown in one table because this is exactly the candidate set handed to the kernel,
            with each candidate&rsquo;s source provenance). <AdCodeValue>rankHint</AdCodeValue> and{" "}
            <AdCodeValue>scoreHint</AdCodeValue> are RETRIEVAL HINTS — never decisions.
          </p>
        </div>
        <Card padding="none" className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Hints</th>
                  <th scope="col">Top retrieval reason</th>
                </tr>
              </thead>
              <tbody>
                {view.before.map((row) => (
                  <tr key={row.key}>
                    <td className={styles.mono}>{row.rankHint}</td>
                    <td>
                      <AdCodeValue>{row.itemId}</AdCodeValue>
                    </td>
                    <td>
                      <div className={styles.marksCell}>
                        <AdvertisingMark compact />
                        <AdProvenanceBadge origin={row.origin ?? "provider-supplied"} withTitle={false} />
                      </div>
                    </td>
                    <td className={styles.muted}>
                      rank {row.rankHint}
                      {row.scoreHint !== null ? <> · score {row.scoreHint.toFixed(2)}</> : null}
                    </td>
                    <td className={styles.muted}>{row.topReason ?? "not provided"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section aria-labelledby="rerank-after-heading" className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 id="rerank-after-heading" className={styles.sectionTitle}>
            After — the kernel&rsquo;s order
          </h2>
          <p className={styles.sectionSubtitle}>
            The decision result VERBATIM: the selected experience (the kernel&rsquo;s choice) then
            the alternatives in the kernel&rsquo;s own order. Scores carry the policy&rsquo;s
            declared-evidence evaluation; absent evidence shows honestly. Rows mapping to no ad
            candidate are ordinary recommendations — without the Advertising mark (law 8).
          </p>
        </div>
        <Card padding="none" className={styles.tableCard}>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Experience</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Origin</th>
                  <th scope="col">Score</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {view.selected !== null ? <OutcomeRow row={view.selected} /> : null}
                {view.after.map((row) => (
                  <OutcomeRow key={row.key} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        {view.selected === null && view.after.length === 0 ? (
          <AdMutedNote>
            The kernel returned no selected experience and no alternatives — the decision holds.
          </AdMutedNote>
        ) : null}
      </section>

      {notes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Honest notes</CardTitle>
            <CardDescription>
              Everything the lane disclosed: gate exclusions, unevaluated dimensions, degenerate
              inputs. Disclosed per result — never hidden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className={styles.notesList}>
              {notes.map((note, index) => (
                <li key={index} className={styles.noteItem}>
                  {note}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function OutcomeRow({ row }: { readonly row: RerankView["after"][number] }) {
  return (
    <tr className={row.selected ? styles.selectedRow : undefined}>
      <td>
        <AdCodeValue>{row.experienceId}</AdCodeValue>
        {row.selected ? <span className={styles.selectedTag}> · selected</span> : null}
      </td>
      <td>
        {row.itemId !== null ? <AdCodeValue>{row.itemId}</AdCodeValue> : <span className={styles.muted}>unmapped</span>}
      </td>
      <td>
        {row.advertising ? (
          <div className={styles.marksCell}>
            <AdvertisingMark compact />
            {row.origin !== null ? <AdProvenanceBadge origin={row.origin} withTitle={false} /> : null}
          </div>
        ) : (
          <span className={styles.nonAd}>ordinary recommendation</span>
        )}
      </td>
      <td className={styles.mono}>
        {row.score !== null ? row.score.toFixed(3) : <span className={styles.muted}>—</span>}
      </td>
      <td>
        <span className={styles.whyCell}>
          {row.reason !== null ? <>{row.reason} </> : null}
          {row.excludedBy !== null ? (
            <span className={styles.excluded}>excluded by {row.excludedBy}</span>
          ) : null}
          {row.uncertainty !== null ? <span className={styles.muted}> ({row.uncertainty})</span> : null}
          {row.reason === null && row.excludedBy === null && row.uncertainty === null ? (
            <span className={styles.muted}>no declared reason</span>
          ) : null}
        </span>
      </td>
    </tr>
  );
}
