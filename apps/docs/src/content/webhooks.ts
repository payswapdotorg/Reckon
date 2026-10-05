/**
 * Webhooks content (S1-004): event catalog, HMAC signature verification,
 * replay. TARGET contract per the survey §3 — S2-002 implements the
 * delivery machinery; the payloads mirror the frozen contracts.
 */

import type { TocEntry, WebhookEventEntry } from "./types.js";

export const WEBHOOKS_HEADINGS: readonly TocEntry[] = [
  { id: "how-webhooks-work", label: "How webhooks work", level: 2 },
  { id: "event-catalog", label: "Event catalog", level: 2 },
  { id: "recommendation-delivered", label: "recommendation.delivered", level: 3 },
  { id: "model-drift-detected", label: "model.drift.detected", level: 3 },
  { id: "schedule-executed", label: "schedule.executed", level: 3 },
  { id: "preference-updated", label: "preference.updated", level: 3 },
  { id: "verify-signatures", label: "Verify signatures", level: 2 },
  { id: "retries-and-replay", label: "Retries, replay & dedupe", level: 2 },
];

export const WEBHOOK_ENVELOPE_NOTE: readonly string[] = [
  "Events are **thin by default**: `data.object` carries the ids and timestamps you need to react, and one `GET` (or an `?expand[]`) fetches the full frozen contract. Thin events keep delivery small and stable while contracts evolve.",
  "Delivery is **at-least-once**: the same event can arrive more than once. Deduplicate on `event.id`.",
];

export const WEBHOOK_EVENTS: readonly WebhookEventEntry[] = [
  {
    id: "recommendation.delivered",
    when: "A decision's experience was confirmed delivered to the subject.",
    description: [
      "Fires after your delivery confirmation for a `SUGGEST`/`SWITCH` decision — the moment the recommendation became user-visible.",
      "React to it for delivery analytics, A/B bookkeeping, or reconciliation between your logs and Reckon's.",
    ],
    payload: `{
  "id": "evt_01J9C4F7K3",
  "object": "event",
  "type": "recommendation.delivered",
  "created": 1769997722000,
  "tenant": { "tenantId": "demo" },
  "data": {
    "object": {
      "decisionId": "dec_01J8ZWM6X4",
      "requestId": "req_01J8ZWK3Q7",
      "experienceId": "exp_01J8ZWM8T2",
      "itemId": "item_reef_doc",
      "action": "SUGGEST",
      "deliveredAt": 1769997721500
    }
  }
}`,
  },
  {
    id: "model.drift.detected",
    when: "A model's evaluation score drifted beyond its policy threshold.",
    description: [
      "Fires from the research runtime when a monitored model (ranking, preference, calibration) crosses its drift threshold over the evaluation window.",
      "React to it by re-running evaluation, alerting your on-call, or pinning the previous model version.",
    ],
    payload: `{
  "id": "evt_01J9C7H2M8",
  "object": "event",
  "type": "model.drift.detected",
  "created": 1770084120000,
  "tenant": { "tenantId": "demo" },
  "data": {
    "object": {
      "modelId": "pref-embed-v3",
      "modelVersion": "12",
      "driftScore": 0.41,
      "threshold": 0.35,
      "window": "72h",
      "metric": "calibration_error",
      "evaluatedAt": 1770084000000
    }
  }
}`,
  },
  {
    id: "schedule.executed",
    when: "The scheduler executed an action against an experience plan.",
    description: [
      "Fires when a plan's schedule delta executes — queued experiences enter the plan, a `SWITCH` replaces the current experience, or an `INTERRUPT` pauses it with a resume checkpoint.",
      "React to it to sync your own playback queue or notification planner with Reckon's plan.",
    ],
    payload: `{
  "id": "evt_01J9C9J5N2",
  "object": "event",
  "type": "schedule.executed",
  "created": 1769997720400,
  "tenant": { "tenantId": "demo" },
  "data": {
    "object": {
      "planId": "plan_01J9B4M7Q2",
      "decisionId": "dec_01J8ZWM6X4",
      "action": "QUEUE",
      "enqueued": ["exp_01J8ZWM9F7"],
      "dequeued": [],
      "executedAt": 1769997720123
    }
  }
}`,
  },
  {
    id: "preference.updated",
    when: "A preference delta was appended for a subject.",
    description: [
      "Fires whenever learning writes a preference delta — the loop closing in real time.",
      "React to it for explainability feeds, personalization dashboards, or exporting deltas to your data warehouse.",
    ],
    payload: `{
  "id": "evt_01J9CAK8P4",
  "object": "event",
  "type": "preference.updated",
  "created": 1769998921000,
  "tenant": { "tenantId": "demo" },
  "data": {
    "object": {
      "deltaId": "pfd_01J9A7C2M6",
      "subject": { "kind": "user", "ref": "usr_88213" },
      "dimension": "topic.calm-nature",
      "op": "add",
      "resultingConfidence": 0.61,
      "modelId": "pref-embed-v3",
      "modelVersion": "12"
    }
  }
}`,
  },
];

export const SIGNATURE_HEADER_EXAMPLE = {
  language: "text" as const,
  label: "Header",
  code: `Reckon-Signature: t=1769997725,v1=6f1d9c2a8b4e7f30a5c9d8b1e4f7a2c6d9e0b3f5a8c1d4e7b0a3c6f9d2e5b8a1`,
  caption:
    "One signed timestamp and one hex HMAC-SHA256 signature — the same scheme for every event type.",
};

export const SIGNATURE_VERIFY_TS = {
  language: "typescript" as const,
  label: "verify-reckon-signature.ts",
  code: `import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Reckon webhook signature (HMAC-SHA256 over "\${t}.\${rawBody}").
 * Prefer the official SDK helper — this is the reference implementation.
 */
export function verifyReckonSignature(
  rawBody: string,
  header: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const parts = new Map<string, string>();
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0) parts.set(piece.slice(0, eq).trim(), piece.slice(eq + 1).trim());
  }
  const timestamp = parts.get("t");
  const signature = parts.get("v1");
  if (timestamp === undefined || signature === undefined) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > toleranceSeconds) return false; // replay guard

  const expected = createHmac("sha256", secret)
    .update(\`\${timestamp}.\${rawBody}\`, "utf8")
    .digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}`,
  caption:
    "Always compare in constant time, always sign over the **raw** request body (re-parsed JSON re-serializes differently), and enforce the timestamp tolerance.",
};

export const SIGNATURE_VERIFY_PY = {
  language: "python" as const,
  label: "verify_reckon_signature.py",
  code: `import hashlib
import hmac
import time


def verify_reckon_signature(
    raw_body: bytes, header: str, secret: str, tolerance: int = 300
) -> bool:
    parts = dict(
        piece.split("=", 1) for piece in header.split(",") if "=" in piece
    )
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1:
        return False
    if abs(time.time() - int(t)) > tolerance:
        return False
    expected = hmac.new(
        secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256
    ).hexdigest()
    return hmac.compare_digest(expected, v1)`,
};

export const WEBHOOK_SECURITY_BULLETS: readonly string[] = [
  "Use the official verification helper from the SDKs (`verifyWebhook` in TypeScript, `verify_webhook` in Python) — it is exactly the reference implementation above, maintained with the API.",
  "Use the **raw** request body, before any JSON parsing or re-serialization.",
  "Enforce the 5-minute tolerance on `t=` and reject older events — that is your replay window guard.",
  "Never ship your own string comparison; a non-constant-time check leaks timing information.",
  "Return `2xx` quickly. Do your work async — a slow handler looks like a failure and triggers retries.",
];

export const WEBHOOK_RETRY_BULLETS: readonly string[] = [
  "Failed deliveries retry with exponential backoff for up to 3 days.",
  "Replays (from the events console) reuse the **same event id** — idempotent handling is mandatory, dedupe on `event.id`.",
  "Events are retained for replay for 30 days.",
];
