/**
 * AdDetail (AD-005) — the remembered-ad record workspace: the full
 * evidence trail, encounter context, rights/retention state and the
 * permission/consent history for one Personal Ad Memory record, plus the
 * per-record forget affordance. Every card renders ONLY what the frozen
 * `AdMemoryRecord` carried (Gate Q): lineage refs stay opaque (host
 * authority), context stays BY REFERENCE (law 5), rights are verbatim
 * (law 4), retention carries its explicit basis (law 1) and the
 * permission history is append-only.
 *
 * Composition: server component (data in via props) + the mode-gated
 * ForgetAdButton (client) for the terminal permission action.
 */
"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdvertisingMark } from "./advertising-mark.js";
import { AdProvenanceBadge } from "./ad-provenance-badge.js";
import { AdFactRow, AdFactRows, AdCodeValue, AdMutedNote } from "./ad-facts.js";
import { ForgetAdButton, type ForgetOutcome } from "./forget-ad-button.js";
import {
  evidenceTrailRows,
  lineageRows,
  permissionView,
  retentionDetailRows,
  rightsDetailRows,
  adOriginForRecord,
  type FactRow,
} from "@/lib/ads-view";
import type { AdMemoryRecord } from "@reckon/contracts";
import styles from "./ad-detail.module.css";

export interface AdDetailProps {
  readonly record: AdMemoryRecord;
  /** The evaluation clock label (the record was resolved at this clock). */
  readonly clockLabel: string;
}

export function AdDetail({ record, clockLabel }: AdDetailProps) {
  const [outcome, setOutcome] = useState<ForgetOutcome | null>(null);
  const onOutcome = useCallback((result: ForgetOutcome) => setOutcome(result), []);
  const origin = adOriginForRecord(record);
  const permissions = permissionView(record);

  return (
    <div className={styles.detail}>
      <Card>
        <CardHeader>
          <div className={styles.marksRow}>
            <AdvertisingMark />
            <AdProvenanceBadge origin={origin} />
          </div>
          <CardTitle className={styles.title}>
            Remembered ad <AdCodeValue>{record.ad.itemId}</AdCodeValue>
          </CardTitle>
          <CardDescription>
            One Personal Ad Memory record — the ad as it was when retained, with its full
            provenance, retention, permissions and rights. Resolved at the evaluation clock{" "}
            {clockLabel} (expiry and availability were evaluated against it, deterministically).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdMutedNote>
            Records are content-addressed: <AdCodeValue>{record.recordId}</AdCodeValue> ={" "}
            <AdCodeValue>{record.contentDigest.slice(0, 16)}…</AdCodeValue> (sha256 over the
            canonical record content — same content, same id, idempotent writes).
          </AdMutedNote>
        </CardContent>
      </Card>

      <FactCard
        title="Evidence trail"
        description="How this ad entered memory (law 9): an observed encounter, or a provider availability declaration. Encounter evidence is observed-class only (law 10); context is referenced by id, never embedded (law 5)."
        rows={evidenceTrailRows(record)}
      />

      <FactCard
        title="Identity and lineage"
        description="Host-owned ad identity: source, advertiser, campaign and creative refs stay opaque — the host ad system is the identity authority; Reckon never resolves or enriches them."
        rows={lineageRows(record)}
      />

      <FactCard
        title="Retention"
        description="What the agent retains, on which explicit basis (law 1), and for how long. Expiry is evaluated against the caller-supplied clock (law 3); forgotten is terminal (law 2)."
        rows={retentionDetailRows(record)}
      />

      <Card>
        <CardHeader>
          <CardTitle>Permissions (consent)</CardTitle>
          <CardDescription>
            What the agent is permitted to do with this memory. History is append-only —
            corrections never rewrite earlier transitions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdFactRows>
            <AdFactRow label="Retain (hold in memory)">
              <span className={permissions.retain.granted ? styles.granted : styles.revoked}>
                {permissions.retain.granted ? "granted" : "revoked"} — {permissions.retain.meaning}
              </span>
            </AdFactRow>
            <AdFactRow label="Present (re-show to you)">
              <span className={permissions.present.granted ? styles.granted : styles.revoked}>
                {permissions.present.granted ? "granted" : "revoked"} — {permissions.present.meaning}
              </span>
            </AdFactRow>
          </AdFactRows>
          {permissions.history.length > 0 ? (
            <div className={styles.historyBlock}>
              <h4 className={styles.historyTitle}>Transition history (append-only)</h4>
              <ul className={styles.historyList}>
                {permissions.history.map((transition, index) => (
                  <li key={index} className={styles.historyItem}>
                    <AdCodeValue>
                      {transition.capability} {transition.from}→{transition.to}
                    </AdCodeValue>{" "}
                    at {transition.atLabel}
                    {transition.reason !== null ? <> — {transition.reason}</> : null}
                    {transition.consentRef !== null ? (
                      <> (consent ref {transition.consentRef})</>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <AdMutedNote>
              No permission transitions recorded — the record was written with its current grants.
            </AdMutedNote>
          )}
          <div className={styles.forgetRow}>
            <ForgetAdButton target={{ kind: "record", recordId: record.recordId }} onOutcome={onOutcome} />
            <p className={styles.forgetNote}>
              Revoking <strong>retain</strong> means forgetting: terminal, the record can never be
              retrieved again (law 2). Changing the <strong>present</strong> grant alone requires a
              permission-transition surface the public API does not expose yet (see the Consent
              page).
            </p>
          </div>
          {outcome !== null ? (
            <div className={outcome.ok ? styles.outcomeOk : styles.outcomeFailed} role="status">
              <strong>{outcome.title}.</strong> <span>{outcome.detail}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <FactCard
        title="Rights"
        description="Rights constraints ride verbatim from the host (law 4): an encounter is never a redistribution license, and rights are never inferred from availability."
        rows={rightsDetailRows(record.rights)}
      />
    </div>
  );
}

function FactCard({
  title,
  description,
  rows,
}: {
  readonly title: string;
  readonly description: string;
  readonly rows: readonly FactRow[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <AdFactRows>
          {rows.map((row) => (
            <AdFactRow key={row.label} label={row.label}>
              {row.value}
            </AdFactRow>
          ))}
        </AdFactRows>
      </CardContent>
    </Card>
  );
}
