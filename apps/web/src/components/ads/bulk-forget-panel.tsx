/**
 * BulkForgetPanel (AD-005) — the retention workspace's bulk forget
 * surface: the frozen forget target vocabulary (item / advertiser / all
 — per-record forget lives on each record's own row/button) composed
 * with the mode-gated ForgetAdButton. Targets are typed by the frozen
 * vocabulary; the observed outcome renders inline and the server tree
 * refreshes so the lanes tell the truth afterwards.
 *
 * Client component: the target kind/ref inputs and the outcome banner.
 */
"use client";

import { useCallback, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ForgetAdButton, type ForgetOutcome } from "./forget-ad-button.js";
import { type AdForgetTargetLike } from "@/lib/ads-view";
import styles from "./bulk-forget-panel.module.css";

type BulkKind = "item" | "advertiser" | "all";

const KIND_LABELS: Readonly<Record<BulkKind, string>> = {
  item: "One ad (by item id)",
  advertiser: "An advertiser's ads (by advertiser ref)",
  all: "Everything (all remembered ads)",
};

export function BulkForgetPanel() {
  const [kind, setKind] = useState<BulkKind>("item");
  const [ref, setRef] = useState("");
  const [reason, setReason] = useState("");
  const [outcome, setOutcome] = useState<ForgetOutcome | null>(null);

  const onOutcome = useCallback((result: ForgetOutcome) => {
    setOutcome(result);
  }, []);

  const target = buildTarget(kind, ref.trim());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bulk forget</CardTitle>
        <CardDescription>
          Forget is TERMINAL (law 2): after it commits, these records can never be retrieved from
          Personal Ad Memory again. Forgetting removes them from your agent&rsquo;s memory only —
          it does not rewrite host ad systems or outcome streams. Idempotent: re-forgetting an
          already-forgotten target reports zero.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={styles.controls}>
          <div className={styles.kindControls} role="radiogroup" aria-label="Forget target kind">
            {(Object.keys(KIND_LABELS) as BulkKind[]).map((option) => (
              <label key={option} className={styles.kindOption}>
                <input
                  type="radio"
                  name="forget-kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => {
                    setKind(option);
                  }}
                />
                <span>{KIND_LABELS[option]}</span>
              </label>
            ))}
          </div>
          {kind !== "all" ? (
            <div className={styles.refWrap}>
              <label htmlFor="bulk-forget-ref" className={styles.label}>
                {kind === "item" ? "Item id" : "Advertiser ref"}
              </label>
              <input
                id="bulk-forget-ref"
                type="text"
                className={styles.input}
                value={ref}
                onChange={(event) => setRef(event.target.value)}
                placeholder={kind === "item" ? "ad-hotel-accra" : "adv-42"}
                autoComplete="off"
                spellCheck={false}
                maxLength={128}
                pattern="[A-Za-z0-9][A-Za-z0-9._:-]*"
              />
            </div>
          ) : null}
          <div className={styles.reasonWrap}>
            <label htmlFor="bulk-forget-reason" className={styles.label}>
              Reason (optional, kept on the audit trail)
            </label>
            <input
              id="bulk-forget-reason"
              type="text"
              className={styles.input}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="why these ads are being forgotten"
              autoComplete="off"
              maxLength={256}
            />
          </div>
        </div>
        <div className={styles.actionRow}>
          {target !== null ? (
            <ForgetAdButton
              target={target}
              reason={reason.trim().length > 0 ? reason.trim().slice(0, 256) : undefined}
              onOutcome={onOutcome}
            />
          ) : (
            <p className={styles.validation}>
              {kind === "item"
                ? "Enter the ad's item id (url-safe: letters, digits, . _ : -) to forget."
                : "Enter the advertiser ref (url-safe: letters, digits, . _ : -) to forget."}
            </p>
          )}
        </div>
        {outcome !== null ? (
          <div className={outcome.ok ? styles.outcomeOk : styles.outcomeFailed} role="status">
            <strong>{outcome.title}.</strong> <span>{outcome.detail}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function buildTarget(kind: BulkKind, ref: string): AdForgetTargetLike | null {
  if (kind === "all") {
    return { kind: "all" };
  }
  const trimmed = ref.trim();
  if (!isValidAdId(trimmed)) {
    return null;
  }
  return kind === "item" ? { kind: "item", itemId: trimmed } : { kind: "advertiser", advertiserRef: trimmed };
}

/** url-safe id check (the frozen IdSchema vocabulary: 1–128 chars). */
function isValidAdId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}
