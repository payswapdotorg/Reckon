# @reckon/sdk

The typed host-integration SDK for the Reckon API (work item W3-002;
hardened to the full developer-platform surface by S2-004 — webhooks,
version pinning, expansion, cursor pagination, test mode, and the
webhook-signature reference helper).

**Laws**

- **No LLM anywhere** (architecture-lock #6): the client is pure plumbing over HTTP + the frozen zod contracts. It works without any model.
- **No internal schema leakage**: the public surface exposes only frozen `@reckon/contracts` types (and thin envelopes composed from those same frozen schema objects). No database or persistence shape is ever imported or re-exported.
- **Contract validation on both sides**: every request is validated against a real imported frozen schema before it is sent; every response is validated against a real frozen schema before it is returned.
- **Typed errors, never raw fetch failures**: every failure mode surfaces as a discriminated `ReckonSdkError` subclass.

## Installation / wiring

The SDK targets the Reckon HTTP API:

```
POST /v1/decisions            POST /v1/outcomes
POST /v1/preferences/events   POST /v1/plans, /v1/plans/{id}/replan
POST /v1/catalog/items        POST /v1/catalog/realizations
POST /v1/candidates           POST /v1/experiences/resolve
GET  /v1/decisions/{id}       GET/POST /v1/plans (+ /history, cursor pages)
POST/GET/DELETE /v1/webhooks/endpoints      GET /v1/webhooks/events/{id}
POST /v1/webhooks/events/{id}/replay        GET /v1/webhooks/deliveries
```

```ts
import { createReckonClient } from "@reckon/sdk";

const reckon = createReckonClient({
  baseUrl: "https://reckon.example.com",
  apiKey: process.env.RECKON_API_KEY!, // tenant identity comes EXCLUSIVELY from the key
  apiVersion: "0.1.0",                // optional: pin X-Reckon-Version on every request
});

reckon.lastResponseMode(); // "live" | "test" — the X-Reckon-Mode marker of the last response
```

## Usage examples

### Request a decision

```ts
const result = await reckon.decisions.request({
  requestId: "req-1",
  tenant: { tenantId: "my-tenant" },          // must match the key's tenant (403 otherwise)
  subject: { kind: "user", ref: "user-9" },
  objective: { objectiveId: "obj-evening", kind: "relax" },
  attentionPolicy: { policyId: "ap-balanced", style: "balanced" },
  context: { contextId: "ctx-1" },
  candidates: {
    setId: "cs-1",
    candidates: [{ itemId: "item-1", realizationIds: ["real-1"], source: "host-retrieval" }],
  },
  policySelector: { policyId: "greedy-v1", version: "1" },
  idempotencyKey: "decision-key-1",           // body-level idempotency (frozen contract)
});

result.action;          // e.g. "SUGGEST"
result.policy;          // { policyId, version }
result.uncertainty;     // confidence/spread metadata
result.scheduleDelta;   // enqueue/dequeue/resume orders, if any
```

### Append an outcome

```ts
await reckon.outcomes.append({
  eventId: "ev-1",
  tenant: { tenantId: "my-tenant" },
  decisionId: result.decisionId,              // outcome → decision linkage
  experienceId: result.selectedExperience?.experienceId,
  subject: { kind: "user", ref: "user-9" },
  eventType: "completion",
  occurredAt: 1_720_000_000_000,              // caller-supplied (deterministic replay)
  metrics: { watchRatio: 0.92 },
  evidenceClass: "production-observed",       // typed; simulated ≠ observed
  idempotencyKey: "outcome-key-1",
});
```

### Catalog, candidates, experiences, plans, preferences

```ts
// Header-keyed operations: the client generates an Idempotency-Key header
// (inject your own generator for determinism in tests).
await reckon.catalog.upsertItem({ itemId: "item-1", kind: "media", labels: ["scifi"] });
await reckon.catalog.upsertRealization({ realizationId: "real-1", itemId: "item-1", kind: "stream" });
await reckon.candidates.submit({ setId: "cs-1", candidates: [...] });
await reckon.experiences.resolve({
  items: [{ itemId: "item-1", kind: "media" }],
  realizations: [{ realizationId: "real-1", itemId: "item-1", kind: "stream" }],
}); // → { experiences: Experience[] }
await reckon.plans.create({ planId: "plan-1", tenant: {...}, ... });
await reckon.plans.replan("plan-1", { trigger: "outcome-observed" });
await reckon.preferences.appendDelta({
  deltaId: "delta-1", tenant: {...}, subject: {...},
  dimension: "genre.scifi", op: "add", value: 0.25,
  model: { modelId: "m-1", version: "3" }, timestamp: 1_720_000_000_000,
});
```

### Expansion, pagination, test mode (S2-004)

```ts
// ?expand[] — embed the selected experience's catalog item:
const decision = await reckon.decisions.get(id, { expand: ["selectedExperience.item"] });
decision.selectedExperience?.item; // CatalogItem | null | undefined (null = honest absence)

// Cursor pagination — one explicit page, or the auto-iterating loop:
const page = await reckon.plans.listPage({ limit: 20 });
page.plans; page.has_more; page.next_cursor; // feed back as startingAfter
for await (const plan of reckon.plans.list({ limit: 100 })) { ... }

// Test mode lives in the key (sk_test_…); every response is mode-marked.
// Canned scenarios ride the schema-legal magic item ids:
const declined = await reckon.decisions.request({
  ...input,
  candidates: { setId: "cs-1", candidates: [{ itemId: "itm_test_decline", source: "host-retrieval" }] },
});
declined.action; // "HOLD"
```

### Webhooks (S2-004)

```ts
import { verifyWebhook } from "@reckon/sdk"; // the docs-named alias of the canonical helper

// Register an endpoint — the ONE-TIME whsec_… secret is issued here, never again:
const endpoint = await reckon.webhookEndpoints.create({
  url: "https://hooks.example.com/reckon",
  description: "nightly reconciliation",
});

// Verify a delivery — RAW body, constant time, 5-minute tolerance:
const ok = verifyWebhook(rawBody, req.headers["reckon-signature"]!, endpoint.secret);

// Management surface:
await reckon.webhookEndpoints.listPage({ limit: 20 });   // { endpoints, has_more, next_cursor }
for await (const e of reckon.webhookEndpoints.list()) { ... }
await reckon.webhookEndpoints.get(endpoint.id);
await reckon.webhookEndpoints.delete(endpoint.id);
const event = await reckon.webhookEvents.get(eventId);      // stored thin event (30-day retention)
const replay = await reckon.webhookEvents.replay(eventId);  // same event id, at-least-once
await reckon.webhookDeliveries.listPage({ endpointId: endpoint.id });
for await (const d of reckon.webhookDeliveries.list({ eventId })) { ... }
```

### Error handling

```ts
import { isReckonSdkError, ReckonValidationError, ReckonAuthError } from "@reckon/sdk";

try {
  await reckon.decisions.request(input);
} catch (error) {
  if (error instanceof ReckonValidationError && error.code === "SDK_REQUEST_INVALID") {
    // rejected client-side before hitting the network; error.issues has the zod paths
  } else if (error instanceof ReckonAuthError) {
    // 401: unknown/missing API key
  } else if (isReckonSdkError(error)) {
    error.code;        // machine-readable discriminator
    error.statusCode;  // HTTP status when the server responded
    error.details;     // server error-envelope details
    error.errorClass;  // "invalid_request_error" | "authentication_error" | ...
    error.param;       // the offending request parameter, when named
    error.docUrl;      // the catalog docs page for this code
    error.mode;        // "live" | "test" — the failing request's key mode
    error.retryAfterSeconds; // on 429 RATE_LIMIT_EXCEEDED
  }
}
```

Mapped server failures (the frozen ERROR_CATALOG): `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `TENANT_MISMATCH` / `MODE_MISMATCH` / `INSUFFICIENT_SCOPE` (403), `NOT_FOUND` (404), `IDEMPOTENCY_CONFLICT` (422), `RATE_LIMIT_EXCEEDED` (429, + `retryAfterSeconds`), `NOT_WIRED` (501), `INTERNAL` / `HANDLER_*` (500-family). Client-side failures: `SDK_CONFIG_ERROR`, `SDK_REQUEST_INVALID`, `SDK_TRANSPORT_ERROR`, `SDK_UNEXPECTED_ERROR_SHAPE`, `SDK_RESPONSE_CONTRACT_VIOLATION`.

## In-process testing against the real API

`createInjectFetch` adapts the REAL fastify application (`apps/api` `buildServer`) to the SDK's injectable `fetchImpl` seam, so hosts (and this repository's own tests) exercise the full route pipeline — auth, scope, tenant law, zod validation, idempotent replay, typed error envelopes — without sockets or a hand-rolled API fake:

```ts
import { buildServer } from "@reckon/api";
import { createReckonClient, createInjectFetch } from "@reckon/sdk";

const app = buildServer({ keys: [{ apiKey: "test-key", tenantId: "t", scopes: ["decisions"] }] });
const reckon = createReckonClient({
  baseUrl: "http://reckon.test",
  apiKey: "test-key",
  fetchImpl: createInjectFetch(app),
});
```

The repository's own tests live in `test/` and run the real app in-process this way (evidence class: controlled-local).

## Evidence honesty

Everything in this package and its tests is **controlled-local** evidence: it proves the SDK against the repository's own API implementation and frozen contracts. It does NOT prove a live provider integration or a production deployment (AGENTS.md "Production truth").
