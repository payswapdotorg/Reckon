/**
 * RetentionView (AD-005) — the retention management surface: what the
 * agent retains, on which explicit basis (law 1), for how long (expiry
 * shown, evaluated against the caller clock — law 3), with per-record
 * AND bulk forget (the frozen target vocabulary: record / item /
 * advertiser / all — law 2 terminal).
 *
 * Honoring host-owned rights boundaries: the rights constraints ride
 * verbatim on every record (law 4) and the host ad system stays the
 * identity/rights authority — nothing here presumes reuse rights.
 *
 * UX_DX_GAP-2 (recorded, never worked around): the public API exposes
 * no route to CHANGE a record's retention expiry — expiry is set by the
 * host write path (the retention basis's owner). The surface shows the
 * expiry verbatim and offers forget; it never fakes an expiry edit.
 *
 * Client component: per-record + bulk forget affordances, outcome banner.
 */
"use client";

import { useCallback, useState } from "react";
import { CalendarClock, Landmark } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdvertisingMark } from "./advertising-mark.js";
import { AdProvenanceBadge } from "./ad-provenance-badge.js";
import { AdCodeValue, AdMutedNote } from "./ad-facts.js";
import { BulkForgetPanel } from "./bulk-forget-panel.js";
import { ForgetAdButton, type ForgetOutcome } from "./forget-ad-button.js";
import { adOriginForRecord, adTitleOf, retentionSummary } from "@/lib/ads-view";
import type { AdMemoryRecord } from "@reckon/contracts";
import styles from "./retention-view.module.css";

export interface RetentionViewProps {
  readonly records: readonly AdMemoryRecord[];
  readonly scopeLabel: string;
  readonly clockLabel: string;
}

export function RetentionView({ records, scopeLabel, clockLabel }: RetentionViewProps) {
  const [outcome, setOutcome] = useState<ForgetOutcome | null>(null);
  const onOutcome = useCallback((result: ForgetOutcome) => setOutcome(result), []);

  return (
    <div className={styles.retention}>
      <Card>
        <CardHeader>
          <CardTitle>What your agent retains, and for how long</CardTitle>
          <CardDescription>
            Every retained ad carries an explicit basis (law 1 — public observability is never a
            basis), an optional expiry evaluated against the caller clock (law 3), and host-owned
            rights constraints (law 4). Expiry is set by the retention basis&rsquo;s owner on the
            write path — the public API offers no expiry-edit route, so this surface shows it
            verbatim (UX_DX_GAP-2, docs/ux/ad-005-ux.md).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdMutedNote>
            Scope: {scopeLabel} · state read at {clockLabel} through{" "}
            <AdCodeValue>POST /v1/ads/query</AdCodeValue> (mode remembered). Records absent here
            are not retained at this clock: expired (lapsed basis), forgotten (terminal) or
            retain-revoked.
          </AdMutedNote>
        </CardContent>
      </Card>

      {records.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Nothing retained</CardTitle>
            <CardDescription>
              The remembered lane answered empty at the evaluation clock — there is no retention to
              manage. Ads enter memory only through encounters captured with an explicit basis.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className={styles.records}>
          {records.map((record) => (
            <RetentionRecordCard key={record.recordId} record={record} onOutcome={onOutcome} />
          ))}
        </div>
      )}

      <BulkForgetPanel />

      {outcome !== null ? (
        <div className={outcome.ok ? styles.outcomeOk : styles.outcomeFailed} role="status">
          <strong>{outcome.title}.</strong> <span>{outcome.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

function RetentionRecordCard({
  record,
  onOutcome,
}: {
  readonly record: AdMemoryRecord;
  readonly onOutcome: (outcome: ForgetOutcome) => void;
}) {
  const retention = retentionSummary(record.retention);
  const origin = adOriginForRecord(record);
  return (
    <Card>
      <CardHeader>
        <div className={styles.marksRow}>
          <AdvertisingMark compact />
          <AdProvenanceBadge origin={origin} />
        </div>
        <CardTitle className={styles.recordTitle}>
          <AdCodeValue>{record.ad.itemId}</AdCodeValue>
          <span className={styles.recordTitleText}>{adTitleOf(record.ad)}</span>
        </CardTitle>
        <CardDescription>
          record <AdCodeValue>{record.recordId}</AdCodeValue>
          {record.lineage.advertiserRef !== undefined ? (
            <>
              {" "}
              · advertiser <AdCodeValue>{record.lineage.advertiserRef}</AdCodeValue>
            </>
          ) : null}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className={styles.retentionRows}>
          <div className={styles.retentionRow}>
            <dt className={styles.retentionKey}>
              <Landmark className={styles.rowIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
              Basis
            </dt>
            <dd className={styles.retentionValue}>
              {retention.basisKind}
              {retention.basisDetail !== null ? <> — {retention.basisDetail}</> : null}
              {retention.retainedLabel !== null ? <> (retained {retention.retainedLabel})</> : null}
            </dd>
          </div>
          <div className={styles.retentionRow}>
            <dt className={styles.retentionKey}>
              <CalendarClock className={styles.rowIcon} aria-hidden="true" size={13} strokeWidth={1.75} />
              Expiry
            </dt>
            <dd className={styles.retentionValue}>
              {retention.expiryLabel !== null ? (
                <>
                  {retention.expiryLabel} — evaluated against the caller clock; past it, the record
                  is not retrievable (law 3)
                </>
              ) : (
                "no expiry declared — retained until forgotten (terminal)"
              )}
            </dd>
          </div>
        </dl>
        <AdMutedNote>
          Rights: redistribution {record.rights.redistributionPermitted ? "permitted (explicit)" : "not permitted (default)"} — host-owned constraints ride verbatim (law 4).
        </AdMutedNote>
        <div className={styles.actionRow}>
          <ForgetAdButton
            target={{ kind: "record", recordId: record.recordId }}
            onOutcome={onOutcome}
            compact
          />
        </div>
      </CardContent>
    </Card>
  );
}
