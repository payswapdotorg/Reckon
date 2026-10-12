/**
 * AdCard (AD-005) — one ad, one card, from either query lane. The card
 * renders ONLY what the frozen ad contracts carried (Gate Q) and makes
 * the ad-memory laws visible:
 *
 *   law 8 — the AdvertisingMark is on EVERY ad card (advertising is
 *           never mistaken for an ordinary recommendation);
 *   law 9 — the AdProvenanceBadge is on EVERY ad card (origin class:
 *           remembered / retrieved / provider-supplied) plus the
 *           encounter time (remembered lane) or the availability
 *           declaration (provider-supplied lane);
 *   law 7 — user value and commercial value render as SEPARATE rows,
 *           never blended;
 *   law 4 — the rights row shows `redistributionPermitted` verbatim
 *           (default: "no").
 *
 * Server component by design (no state, no effects): the pages fetch
 * through the SDK seam and pass view rows down.
 */
import Link from "next/link";
import { Clock, Eye, Ban, Scale, TrendingUp, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AdFactRow, AdFactRows, AdCodeValue, AdNotProvided, AdMutedNote } from "./ad-facts.js";
import { AdProvenanceBadge } from "./ad-provenance-badge.js";
import { AdvertisingMark } from "./advertising-mark.js";
import type { AdCardView } from "@/lib/ads-view";
import styles from "./ad-card.module.css";

export interface AdCardProps {
  readonly ad: AdCardView;
}

export function AdCard({ ad }: AdCardProps) {
  const title = (
    <>
      {ad.title}
      {ad.labels.length > 0 ? (
        <span className={styles.labels}> · {ad.labels.join(", ")}</span>
      ) : null}
    </>
  );
  return (
    <Card className={styles.card}>
      <CardHeader className={styles.header}>
        <div className={styles.marksRow}>
          <AdvertisingMark />
          <AdProvenanceBadge origin={ad.origin} />
        </div>
        <h3 className={styles.title}>{ad.detailHref !== null ? (
          <Link href={ad.detailHref} className={styles.titleLink}>
            {title}
          </Link>
        ) : (
          title
        )}</h3>
        <p className={styles.itemId}>
          <AdCodeValue>{ad.itemId}</AdCodeValue>
        </p>
      </CardHeader>
      <CardContent>
        <AdFactRows>
          {ad.encounter !== null ? (
            <AdFactRow label="Encountered">
              <span className={styles.encounter}>
                <Clock className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                {ad.encounter.atLabel}
                <span className={styles.encounterDetail}>
                  <Eye className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                  observed <AdCodeValue>{ad.encounter.evidenceClass}</AdCodeValue> ·{" "}
                  <AdCodeValue>{ad.encounter.outcomeEventId}</AdCodeValue>
                  {ad.encounter.surface !== null ? <> · surface {ad.encounter.surface}</> : null}
                </span>
              </span>
            </AdFactRow>
          ) : null}
          {ad.availability !== null ? (
            <AdFactRow label="Declared availability">
              <span className={styles.availability}>
                <Building2 className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                {ad.availability.suppliedBy}
                {ad.availability.fromLabel !== null || ad.availability.untilLabel !== null ? (
                  <span className={styles.encounterDetail}>
                    {ad.availability.fromLabel !== null ? <>from {ad.availability.fromLabel} </> : null}
                    {ad.availability.untilLabel !== null ? <>until {ad.availability.untilLabel}</> : null}
                  </span>
                ) : null}
              </span>
            </AdFactRow>
          ) : null}
          {ad.retention !== null ? (
            <AdFactRow label="Retention">
              <span className={styles.retention}>
                {ad.retention.state} · basis {ad.retention.basisKind}
                {ad.retention.expiryLabel !== null ? <> · expires {ad.retention.expiryLabel}</> : null}
              </span>
            </AdFactRow>
          ) : null}
          <AdFactRow label="Redistribution">
            {ad.rights.redistributionPermitted ? (
              <span className={styles.rightsGranted}>permitted — explicitly granted</span>
            ) : (
              <span className={styles.rightsDefault}>
                <Ban className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                not permitted (default — an encounter is not a license)
              </span>
            )}
            {ad.rights.gates.length > 0 ? (
              <AdMutedNote>rights gates: {ad.rights.gates.join(", ")}</AdMutedNote>
            ) : null}
          </AdFactRow>
          {ad.whyRetrieved.length > 0 ? (
            <AdFactRow label="Why retrieved">
              <ul className={styles.whyList}>
                {ad.whyRetrieved.map((reason, index) => (
                  <li key={`${reason.kind}-${index}`} className={styles.whyItem}>
                    <AdCodeValue>{reason.kind}</AdCodeValue>
                    {reason.detail !== null ? <span> — {reason.detail}</span> : null}
                    {reason.score !== null ? (
                      <span className={styles.whyScore}> hint {reason.score.toFixed(2)}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </AdFactRow>
          ) : null}
          <AdFactRow label="Value to you">
            {ad.values.userValue !== null ? (
              <span className={styles.userValue}>
                <TrendingUp className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                {ad.values.userValue.score.toFixed(2)}
                {ad.values.userValue.reasons.length > 0 ? (
                  <span className={styles.valueReasons}> — {ad.values.userValue.reasons.join("; ")}</span>
                ) : null}
              </span>
            ) : (
              <AdNotProvided note="declared user value is optional on ad candidates" />
            )}
          </AdFactRow>
          <AdFactRow label="Commercial value">
            {ad.values.commercialValue !== null ? (
              <span className={styles.commercialValue}>
                <Scale className={styles.factIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
                {ad.values.commercialValue.metricsLabel}
                {ad.values.commercialValue.declaredBy !== null ? (
                  <span className={styles.valueReasons}> — declared by {ad.values.commercialValue.declaredBy}</span>
                ) : null}
              </span>
            ) : (
              <AdNotProvided note="declared input only — never a ranking authority (law 7)" />
            )}
          </AdFactRow>
          {ad.recordId !== null && ad.origin === "provider-supplied" ? (
            <AdFactRow label="Memory link">
              <span>
                remembers <AdCodeValue>{ad.recordId}</AdCodeValue>
              </span>
            </AdFactRow>
          ) : null}
        </AdFactRows>
      </CardContent>
    </Card>
  );
}
