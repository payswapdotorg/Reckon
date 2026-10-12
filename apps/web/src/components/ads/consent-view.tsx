/**
 * ConsentView (AD-005) — the permission/consent surface: what the
 * Personal Agent is permitted to RETAIN and PRESENT, per record, with
 * the append-only transition history and the actions the PUBLIC API
 * surface actually offers:
 *
 *   - `retain` — inspectable per record; revoking it through the public
 *     surface is FORGET (terminal, law 2 — the AD-002 store law binds
 *     the revoke transition to terminal forget, and /v1/ads/forget is
 *     its public expression). Offered per record below.
 *   - `present` — inspectable per record with its full history;
 *     changing it alone (revoke without forgetting, or re-grant) has NO
 *     public HTTP route today (the AD-002 `applyPermissionTransition`
 *     is a store port, not an API). The surface states this honestly
 *     and never fakes a transition — recorded as UX_DX_GAP-1 in
 *     docs/ux/ad-005-ux.md.
 *
 * Client component: the mode-gated forget affordances + outcome banner.
 * The current consent state is persisted through the public API: the
 * forget proxy commits the terminal transition server-side and the
 * refreshed server tree re-reads the state through /v1/ads/query.
 */
"use client";

import { useCallback, useState } from "react";
import { Check, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AdvertisingMark } from "./advertising-mark.js";
import { AdProvenanceBadge } from "./ad-provenance-badge.js";
import { AdCodeValue, AdMutedNote } from "./ad-facts.js";
import { ForgetAdButton, type ForgetOutcome } from "./forget-ad-button.js";
import { adOriginForRecord, adTitleOf, permissionView, type AdOriginClass } from "@/lib/ads-view";
import type { AdMemoryRecord } from "@reckon/contracts";
import styles from "./consent-view.module.css";

export interface ConsentViewProps {
  readonly records: readonly AdMemoryRecord[];
  /** The demo-lane subject/tenant labels (display-safe). */
  readonly scopeLabel: string;
  readonly clockLabel: string;
}

export function ConsentView({ records, scopeLabel, clockLabel }: ConsentViewProps) {
  const [outcome, setOutcome] = useState<ForgetOutcome | null>(null);
  const onOutcome = useCallback((result: ForgetOutcome) => setOutcome(result), []);

  return (
    <div className={styles.consent}>
      <Card>
        <CardHeader>
          <CardTitle>What your agent is permitted to do</CardTitle>
          <CardDescription>
            Two capabilities per remembered ad, each inspectable here and persisted through the
            public API surface: <strong>retain</strong> — may Personal Ad Memory hold this ad at
            all; <strong>present</strong> — may the agent re-show it to you. History is
            append-only: corrections never rewrite earlier transitions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AdMutedNote>
            Scope: {scopeLabel} · state read at {clockLabel} through{" "}
            <AdCodeValue>POST /v1/ads/query</AdCodeValue> (mode remembered). A record that does not
            appear is not consent-relevant right now: forgotten (terminal), expired at the clock,
            or retain-revoked.
          </AdMutedNote>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Changing consent</CardTitle>
          <CardDescription>
            The public surface offers one permission-changing operation: forget.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className={styles.changeList}>
            <li className={styles.changeItem}>
              <strong>Revoke retain</strong> — forgetting the record. Terminal (law 2): it can
              never be retrieved from Personal Ad Memory again. Available per record below.
            </li>
            <li className={styles.changeItem}>
              <strong>Revoke or re-grant present alone</strong> — keeps the memory but stops (or
              resumes) presentation. The public API exposes no permission-transition route yet:
              the frozen contracts define <AdCodeValue>AdPermissionTransition</AdCodeValue> and the
              store applies it, but <AdCodeValue>/v1/ads</AdCodeValue> ships only{" "}
              <AdCodeValue>query</AdCodeValue> and <AdCodeValue>forget</AdCodeValue>. Recorded as
              UX_DX_GAP-1 (docs/ux/ad-005-ux.md); never faked here.
            </li>
          </ul>
        </CardContent>
      </Card>

      {records.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No remembered ads under consent</CardTitle>
            <CardDescription>
              The remembered lane answered empty — nothing is currently retained for this subject
              at the evaluation clock, so there are no consent grants to inspect or change.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className={styles.records}>
          {records.map((record) => (
            <ConsentRecordCard
              key={record.recordId}
              record={record}
              onOutcome={onOutcome}
            />
          ))}
        </div>
      )}

      {outcome !== null ? (
        <div className={outcome.ok ? styles.outcomeOk : styles.outcomeFailed} role="status">
          <strong>{outcome.title}.</strong> <span>{outcome.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

function ConsentRecordCard({
  record,
  onOutcome,
}: {
  readonly record: AdMemoryRecord;
  readonly onOutcome: (outcome: ForgetOutcome) => void;
}) {
  const permissions = permissionView(record);
  const origin: AdOriginClass = adOriginForRecord(record);
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
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.grantsRow}>
          <GrantPill capability="retain" granted={permissions.retain.granted} meaning={permissions.retain.meaning} />
          <GrantPill capability="present" granted={permissions.present.granted} meaning={permissions.present.meaning} />
        </div>
        {permissions.history.length > 0 ? (
          <ul className={styles.historyList}>
            {permissions.history.map((transition, index) => (
              <li key={index} className={styles.historyItem}>
                <AdCodeValue>
                  {transition.capability} {transition.from}→{transition.to}
                </AdCodeValue>{" "}
                {transition.atLabel}
                {transition.reason !== null ? <> — {transition.reason}</> : null}
              </li>
            ))}
          </ul>
        ) : (
          <AdMutedNote>No transitions — written with its current grants.</AdMutedNote>
        )}
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

function GrantPill({
  capability,
  granted,
  meaning,
}: {
  readonly capability: "retain" | "present";
  readonly granted: boolean;
  readonly meaning: string;
}) {
  return (
    <span
      className={`${styles.grantPill} ${granted ? styles.grantGranted : styles.grantRevoked}`}
      title={meaning}
    >
      {granted ? (
        <Check className={styles.grantIcon} aria-hidden="true" size={12} strokeWidth={2} />
      ) : (
        <X className={styles.grantIcon} aria-hidden="true" size={12} strokeWidth={2} />
      )}
      {capability} {granted ? "granted" : "revoked"}
    </span>
  );
}
