/**
 * RememberedAdsList (AD-005) — the remembered lane's card list with the
 * lane's own law-9 statement: ONLY memory records here (every card a
 * Remembered/Retained-from-supply origin), each linking to its record
 * detail. Mode discipline is enforced upstream (the page pins
 * `mode: "remembered"` — available-lane candidates cannot appear).
 *
 * Server component: candidates in (the SDK's parsed
 * RememberedAdCandidate rows), AdCards out.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { AdCard } from "./ad-card.js";
import { AdMutedNote } from "./ad-facts.js";
import { rememberedAdCardView } from "@/lib/ads-view";
import { formatEpochMs } from "@/lib/auth-view";
import type { RememberedAdCandidate } from "@reckon/contracts";
import styles from "./remembered-ads-list.module.css";

export interface RememberedAdsListProps {
  readonly candidates: readonly RememberedAdCandidate[];
  readonly at: number;
  readonly scopeLabel: string;
  readonly notes: readonly string[];
}

export function RememberedAdsList({ candidates, at, scopeLabel, notes }: RememberedAdsListProps) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        title="No remembered ads answered"
        reason="the remembered lane is empty for this subject at the evaluation clock — nothing retained, or every record is expired/revoked/forgotten (law 2)"
        note="Ads enter Personal Ad Memory only through encounters captured with an explicit retention basis (law 1) — never from public observability."
        actionLabel="Re-query"
      />
    );
  }
  return (
    <div className={styles.list}>
      <Card>
        <CardHeader>
          <CardTitle>
            {candidates.length === 1 ? "1 remembered ad" : `${candidates.length} remembered ads`}
          </CardTitle>
          <CardDescription>
            Personal Ad Memory for {scopeLabel}, evaluated at {formatEpochMs(at)} — the store&rsquo;s
            deterministic chronological order (recordedAt, then record id), NOT a ranking. The
            retrieval stage has no ranking authority; any re-ranking is the decision
            kernel&rsquo;s (see Compare).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdMutedNote>
            Lane law (law 9): only memory records appear here. Provider-supplied availability
            lives in its own lane (Current ads) and never migrates into this list.
          </AdMutedNote>
        </CardContent>
      </Card>
      <div className={styles.cards}>
        {candidates.map((candidate) => (
          <AdCard key={candidate.record.recordId} ad={rememberedAdCardView(candidate)} />
        ))}
      </div>
      {notes.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Honest notes</CardTitle>
            <CardDescription>What the lane disclosed about this answer.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className={styles.notesList}>
              {notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
