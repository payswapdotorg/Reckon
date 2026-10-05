/**
 * API reference — Idempotent requests (S1-004).
 *
 * Idempotency-Key semantics per the survey §3: same key + same body →
 * the ORIGINAL response is replayed; same key + different body → 409;
 * 24h retention window. v0.1.0 already implements the store-and-replay
 * core (apps/api/src/idempotency.ts: per-tenant/route/key scoping, 2xx
 * only, conflict on digest mismatch); S2-001 unifies the surface.
 */

import type { TocEntry } from "../types.js";

export const IDEMPOTENCY_HEADINGS: readonly TocEntry[] = [
  { id: "how-it-works", label: "How it works", level: 2 },
  { id: "rules", label: "Rules", level: 2 },
  { id: "example", label: "Example: first call vs replay", level: 2 },
];

export const IDEMPOTENCY_RULES: readonly string[] = [
  "Send a fresh `Idempotency-Key` header with every POST that can have side effects (decisions, outcomes, plans, catalog upserts, replan). Generate UUIDs — keys are opaque strings, URL-safe, up to 128 characters.",
  "**Same key + same body** → the original response is replayed verbatim, with `Idempotency-Replayed: true` on the replay. State is not executed twice.",
  "**Same key + different body** → `409 idempotency_key_reused`. This is a loud bug signal in your retry logic — never silence it.",
  "Replays are stored for **24 hours**; older keys behave like first calls.",
  "Only successfully executed responses (2xx) are stored — a `501 not_wired` is never replayed, so wiring a handler later changes behavior immediately.",
  "Lookups are scoped by `(tenant, route, key)`: cross-tenant replay is structurally impossible.",
  "Request bodies are digested with the deterministic canonical JSON + sha-256 from `@reckon/contracts` — key-order differences do not count as a different body.",
];

export const IDEMPOTENCY_FIRST_CALL = {
  language: "bash" as const,
  label: "First call",
  code: `curl https://api.reckon.dev/v1/plans \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 8f3c2a90-6d2e-4f1b-9a7c-1e5d3b8a2c40" \\
  -d @- <<'JSON'
{ "planId": "plan_01J9B4M7Q2", "tenant": { "tenantId": "demo" }, "entries": [] }
JSON`,
};

export const IDEMPOTENCY_REPLAY_CALL = {
  language: "bash" as const,
  label: "Replay (same key, same body)",
  code: `curl -i https://api.reckon.dev/v1/plans \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 8f3c2a90-6d2e-4f1b-9a7c-1e5d3b8a2c40" \\
  -d @- <<'JSON'
{ "planId": "plan_01J9B4M7Q2", "tenant": { "tenantId": "demo" }, "entries": [] }
JSON`,
  caption:
    "The response body is byte-for-byte the original `200 OK` — plus `Idempotency-Replayed: true`. Nothing executes twice.",
};

export const IDEMPOTENCY_CONFLICT = {
  language: "json" as const,
  label: "409 · same key, different body",
  code: `{
  "error": {
    "type": "invalid_request_error",
    "code": "idempotency_key_reused",
    "message": "Idempotency-Key was already used with a different request body.",
    "details": {
      "idempotencyKey": "8f3c2a90-6d2e-4f1b-9a7c-1e5d3b8a2c40"
    }
  }
}`,
};

export const IDEMPOTENCY_SDK_EXAMPLE = {
  language: "typescript" as const,
  label: "SDK — explicit idempotency key",
  code: `const plan = await reckon.plans.create(payload, {
  idempotencyKey: "8f3c2a90-6d2e-4f1b-9a7c-1e5d3b8a2c40",
});`,
};

export const IDEMPOTENCY_BRIDGE: readonly string[] = [
  "The `@reckon/sdk` client already sends `Idempotency-Key` headers for routes whose frozen contract carries no body-level key (plans, catalog, preferences, resolve) — pass your own via call options to keep retry loops deterministic.",
  "The `reckon.decision-request` and `reckon.outcome-event` contracts carry a required **body-level** `idempotencyKey` field today (that is what the quickstart samples show); S2-001 unifies every route on the header while the body field stays accepted for contract compatibility.",
];
