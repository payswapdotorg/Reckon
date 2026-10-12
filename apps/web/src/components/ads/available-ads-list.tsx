/**
 * AvailableAdsList (AD-005) — the provider-supplied lane's card list
 * with the lane's own law-9 statement: ONLY availability declarations
 * here (every card a Provider-supplied origin — a declaration, never an
 * observation, and never a rights grant). Mode discipline is enforced
 * upstream (the page pins `mode: "available"`).
 *
 * Server component: candidates in, AdCards out.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { AdCard } from "./ad-card.js";
import { AdMutedNote } from "./ad-facts.js";
import { availableAdCardView } from "@/lib/ads-view";
import { formatEpochMs } from "@/lib/auth-view";
import type { AvailableAdCandidate } from "@reckon/contracts";
import styles from "./available-ads-list.module.css";

export interface AvailableAdsListProps {
  readonly candidates: readonly AvailableAdCandidate[];
  readonly at: number;
  readonly notes: readonly string[];
}

export function AvailableAdsList({ candidates, at, notes }: AvailableAdsListProps) {
  if (candidates.length === 0) {
    return (
      <EmptyState
        title="No provider-supplied ads answered"
        reason="no availability channel declared eligible ads at the evaluation clock — the lane is honestly empty (rights are never inferred from catalog presence)"
        note="When host channels declare availability, current supply appears here with its own provenance — declarations, never observations."
        actionLabel="Re-query"
      />
    );
  }
  return (
    <div className={styles.list}>
      <Card>
        <CardHeader>
          <CardTitle>
            {candidates.length === 1
              ? "1 provider-supplied ad"
              : `${candidates.length} provider-supplied ads`}
          </CardTitle>
          <CardDescription>
            Current supply, gated at the evaluation clock {formatEpochMs(at)} — channel
            configuration order then channel declaration order, preserved verbatim. The engine
            never re-sorts supply; a host channel that wants an order declares it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdMutedNote>
            Lane law (law 9): only availability declarations appear here. Remembered ads live in
            their own lane. A declaration is a channel&rsquo;s willingness to serve — never an
            observation, and never a rights grant (law 4).
          </AdMutedNote>
        </CardContent>
      </Card>
      <div className={styles.cards}>
        {candidates.map((candidate) => (
          <AdCard key={`avail-${candidate.ad.itemId}`} ad={availableAdCardView(candidate)} />
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
