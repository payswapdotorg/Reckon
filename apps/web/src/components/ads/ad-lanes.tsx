/**
 * AdLanes (AD-005) — the law 9 presentation: the remembered lane and the
 * provider-supplied lane render as SEPARATE, clearly-labeled sections.
 * The two candidate arrays are NEVER merged into one list — each lane
 * keeps its own header, its own provenance vocabulary and its own
 * honest-empty state. An available candidate that links to a memory
 * record shows that link on its own card (in the provider-supplied
 * lane) — it never migrates between lanes.
 *
 * Server component by design: view rows in, cards out.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { AdCard } from "./ad-card.js";
import type { AdCardView } from "@/lib/ads-view";
import styles from "./ad-lanes.module.css";

export interface AdLanesProps {
  readonly remembered: readonly AdCardView[];
  readonly available: readonly AdCardView[];
  /** Optional extra fact line under each lane header (query echo, clock). */
  readonly clockLabel?: string;
}

export function AdLanes({ remembered, available, clockLabel }: AdLanesProps) {
  return (
    <div className={styles.lanes}>
      <section aria-labelledby="ads-remembered-heading" className={styles.lane}>
        <div className={styles.laneHeader}>
          <h2 id="ads-remembered-heading" className={styles.laneTitle}>
            Remembered
          </h2>
          <p className={styles.laneSubtitle}>
            Personal Ad Memory — ads your agent retains from observed encounters (or, when seeded
            from supply, retained-from-supply records).{" "}
            <span className={styles.laneLaw}>Never merged with newly available supply (law 9).</span>
          </p>
        </div>
        {remembered.length === 0 ? (
          <EmptyState
            title="No remembered ads answered"
            reason="the remembered lane is empty for this subject at the evaluation clock — nothing retained, or every record is expired/revoked/forgotten (law 2)"
            note="Remembered ads appear here as encounters are captured with an explicit retention basis."
            actionLabel="Re-query"
          />
        ) : (
          <div className={styles.cards}>
            {remembered.map((ad) => (
              <AdCard key={ad.key} ad={ad} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="ads-available-heading" className={styles.lane}>
        <div className={styles.laneHeader}>
          <h2 id="ads-available-heading" className={styles.laneTitle}>
            Provider-supplied
          </h2>
          <p className={styles.laneSubtitle}>
            Current availability declarations — what host/provider channels are willing to serve
            right now.{" "}
            <span className={styles.laneLaw}>
              A declaration, never an observation, and never in memory until retained.
            </span>
          </p>
        </div>
        {available.length === 0 ? (
          <EmptyState
            title="No provider-supplied ads answered"
            reason="no availability channel declared eligible ads at the evaluation clock — the lane is honestly empty (rights are never inferred from catalog presence)"
            note="When host channels declare availability, current supply appears here with its own provenance."
            actionLabel="Re-query"
          />
        ) : (
          <div className={styles.cards}>
            {available.map((ad) => (
              <AdCard key={ad.key} ad={ad} />
            ))}
          </div>
        )}
      </section>

      {clockLabel !== undefined ? (
        <Card>
          <CardHeader>
            <CardTitle>Evaluation clock</CardTitle>
            <CardDescription>
              Expiry, availability and temporal relevance were all evaluated against the
              caller-supplied clock — deterministically, for replay.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className={styles.clock}>{clockLabel}</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
