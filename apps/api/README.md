# @reckon/api — HTTP API + developer-platform boundary (W3-001, hardened S2-001, webhooks S2-002, test mode S2-003)

Reckon's consumer-facing HTTP surface: a fastify composition root where
every route is validated against the FROZEN contracts from
`@reckon/contracts` (imported — never re-declared), every failure uses one
typed error envelope, and the decision kernel is behind injectable handler
ports that default to deterministic `NotWired` (501) responders.

The API makes **zero LLM calls** (architecture lock #6). Identity authority
stays with the host (lock #4): the static API-key map is an explicit
boundary seam for this wave, not an identity system.

S2-001 hardens this surface to the Stripe developer-platform bar
(docs/surveys/stripe-com-survey.md §3, "API reference discipline"):
key model, API versioning, idempotency keys, response expansion, cursor
pagination and a typed error catalog. S2-002 adds the recommendation
webhook system on those seams (event catalog, HMAC signatures, replay,
delivery log) — implemented to the contract the docs portal already
publishes (`apps/docs/src/content/webhooks.ts`; the lockstep is enforced
by `test/webhook-catalog.test.ts` + `test/webhook-signature-docs.test.ts`).
**S2-003 adds Stripe-style TEST MODE** — test keys, canned scenarios,
complete test/live separation — documented in the “Test mode” section
below.

## Routes

| Route | Scope | Request schema | Response schema |
|---|---|---|---|
| `POST /v1/decisions` | `decisions` | `DecisionRequestSchema` | `DecisionResultSchema` |
| `GET /v1/decisions/{id}` | `decisions` | — (path id) + `?expand[]` | `DecisionResultSchema` (404 unknown, 501 no store) |
| `POST /v1/outcomes` | `outcomes` | `OutcomeEventSchema` | `OutcomeEventSchema` (accepted echo) |
| `POST /v1/preferences/events` | `outcomes` | `PreferenceDeltaSchema` | `PreferenceDeltaSchema` (accepted echo) |
| `POST /v1/plans` | `plans` | `ExperiencePlanSchema` | `ExperiencePlanSchema` |
| `POST /v1/plans/{id}/replan` | `plans` | `ReplanRequestSchema` (envelope) | `ExperiencePlanSchema` |
| `GET /v1/plans/{id}` | `plans` | — + `?expand[]` | `ExperiencePlanSchema` + expansions |
| `GET /v1/plans/{id}/history` | `plans` | — | `{ versions }` (version chain + reasons) |
| `GET /v1/plans` | `plans` | `limit`/`starting_after` + `?expand[]` | `{ plans, has_more, next_cursor }` |
| `POST /v1/catalog/items` | `catalog` | `CatalogItemSchema` | `CatalogItemSchema` |
| `POST /v1/catalog/realizations` | `catalog` | `RealizationSchema` | `RealizationSchema` |
| `POST /v1/candidates` | `decisions` | `CandidateSetSchema` | `CandidateSetSchema` + API schema echo |
| `POST /v1/experiences/resolve` | `decisions` | `ResolveRequestSchema` (envelope) | `ResolveResponseSchema` + API schema echo |
| `POST /v1/agents/bodies` | `agents` | `AgentBodySchema` | `AgentBodySchema` |
| `GET /v1/agents/bodies` | `agents` | `limit`/`starting_after` | `{ bodies, has_more, next_cursor }` |
| `POST /v1/agents/organizations` | `agents` | `AgentOrganizationSchema` | `AgentOrganizationSchema` |
| `GET /v1/agents/organizations` | `agents` | `limit`/`starting_after` | `{ organizations, has_more, next_cursor }` |
| `POST /v1/research/jobs` | `research` | enqueue envelope (ids + opaque payload) | job view |
| `GET /v1/research/jobs/{id}` | `research` | — | job view |
| `GET /v1/research/jobs` | `research` | `limit`/`starting_after`/`state` | `{ jobs, has_more, next_cursor }` |
| `GET /v1/integrations/adapters` | `integrations` | — | `{ adapters }` (static declarations) |
| `POST /v1/webhooks/endpoints` | `webhooks` | `WebhookEndpointCreateSchema` + `Idempotency-Key` | `WebhookEndpointCreatedSchema` (view + ONE-TIME `whsec_` secret) |
| `GET /v1/webhooks/endpoints` | `webhooks` | `limit`/`starting_after` | `{ endpoints, has_more, next_cursor }` |
| `GET /v1/webhooks/endpoints/{id}` | `webhooks` | — | `WebhookEndpointViewSchema` (404 unknown) |
| `DELETE /v1/webhooks/endpoints/{id}` | `webhooks` | — | `WebhookEndpointViewSchema` (removed view; 404 unknown) |
| `GET /v1/webhooks/events/{id}` | `webhooks` | — | the stored thin `ReckonEvent` (30-day retention) |
| `POST /v1/webhooks/events/{id}/replay` | `webhooks` | empty body `{}` + `Idempotency-Key` | `WebhookReplayResponseSchema` (event + replay deliveries) |
| `GET /v1/webhooks/deliveries` | `webhooks` | `limit`/`starting_after` + `endpoint_id`/`event_id` filters | `{ deliveries, has_more, next_cursor }` |
| `GET /healthz` | none | — | `{ ok, version, contractsVersion }` |
| `GET /readyz` | none | — | `{ ok, version, contractsVersion, handlers }` |

Scope mapping notes (W3-001 choices, TL3 review per public-contract-map):
`preferences/events` is gated by `outcomes` (event-ingestion family);
`candidates` and `experiences/resolve` are gated by `decisions`
(decision-input surfaces).

Request/response envelopes (`ReplanRequestSchema`, `ResolveRequestSchema`,
`ResolveResponseSchema`) are composed ONLY from imported frozen schema
objects (`.omit`/`.extend`/`.optional`/`.array` on real contract schemas) —
no field type is hand-written; apps/api adds no zod dependency (the
approved toolchain extension is fastify only).

## Auth (API keys — S2-001 key model)

`Authorization: Bearer <key>`. Two key families:

- **Secret keys** `sk_live_<token>` / `sk_test_<token>` — the ONLY valid
  API credentials (40+ base62 chars; generated by
  `generateSecretKey()` / provisioned via `mintKeyConfig()`).
- **Publishable keys** `pk_live_<token>` / `pk_test_<token>` — client-side
  identification only. A `pk_` key on ANY API route is a typed 401
  `authentication_error` (dedicated message, even if configured).

Key-scoped mode (live vs test) is carried IN the key and propagated to
every handler through `AuthContext.mode`. S2-003 owns the behavioral
separation — see **Test mode** below: a test key runs against fully
separated test state, gets deterministic canned decision behavior, and
marks every response with its mode. The mode is echoed on every
authenticated response as the `X-Reckon-Mode: live|test` header.

**Transition policy (documented for TL3):** legacy opaque keys (anything
not matching the `sk_/pk_` format) are accepted unchanged and behave as
live-mode secret keys unless their config entry pins `mode: "test"`.
Keys that LOOK like Reckon keys but are malformed fail fast at startup
(ConfigError); an entry pinning a mode that contradicts the key's
in-band mode is a ConfigError.

Keys come from `RECKON_API_KEYS`
(`key1:tenant1:scope1,scope2;key2:tenant2:...`) or `RECKON_API_KEYS_FILE`
(same format, one entry per line; file wins). Keys are hashed (sha256) at
rest in memory; the raw key is never stored, logged, or echoed.

Scopes: `decisions`, `outcomes`, `plans`, `catalog`, `research`,
`agents`, `integrations`.

## Test mode (S2-003 — Stripe-style test/live separation)

Build your whole integration in test mode with deterministic responses,
then flip to live keys. Test mode is entered **per key** — never per
request: an `sk_test_` key (or a legacy key pinned `mode: "test"`) runs
every request in test mode. Keys are issued by the (future) dashboard;
provisioning today is `mintKeyConfig`:

```ts
import { mintKeyConfig } from "@reckon/api"; // or the host's own generator

const testKey = mintKeyConfig("secret", "test", "tenant-42", ["decisions", "outcomes"]);
// → { apiKey: "sk_test_…40 base62 chars…", tenantId: "tenant-42", … }
```

### Separated test state (the isolation law)

A test-mode request runs against state that is **separate by
construction** — test tenants' data never mixes with live data, and live
keys can never read test state (nor the reverse):

| Surface | Live mode | Test mode |
|---|---|---|
| Idempotency replay map | the configured store (`config.idempotencyStore`) | a **separate store instance** (`config.testIdempotencyStore`, default: its own in-memory map) — same tenant + same `Idempotency-Key` never replays across modes |
| Decision path (`POST /v1/decisions`) | the mounted (live) decision handler | the **canned scenario engine** — the live handler is NEVER executed from test mode |
| Decision reads (`GET /v1/decisions/{id}`) | the mounted decision store | the mode-isolated in-process test decision store |
| Catalog expansion reads (`?expand[]=selectedExperience.item`) | tenant-scoped live catalog | never read from test mode — the expanded item is an explicit `null` (honest absence) |

Cross-mode violations are **typed errors, both directions** (see the
catalog below): a test key reading a live decision (same tenant) → `403
MODE_MISMATCH`; a live key reading a test-mode (canned) decision → `403
MODE_MISMATCH`; a live key carrying test-mode-only hints → `403
MODE_MISMATCH`. Cross-mode ids are only visible within the SAME tenant —
cross-tenant reads stay invisible (`404`), mode or not.

### Mode markers (test traffic is always identifiable)

- **`X-Reckon-Mode: live|test`** — on EVERY authenticated `/v1` response
  (successes AND typed errors; set right after key authentication, so
  even a later 400/404/422/500 carries it). Unauthenticated 401s carry
  no mode (an unknown key has no mode).
- **`mode: "test"`** — a top-level sibling field on test-mode decision
  payloads (POST and GET), additive next to the schema-validated
  contract object. Live responses carry no `mode` field.
- **In-schema markers** — canned decisions carry
  `provenance.system: "reckon-api-test-mode"` and
  `reasons[].code: "test.mode"` / `"test.scenario.<name>"` INSIDE the
  frozen `DecisionResult` contract (schema-valid, unambiguous).

### Canned scenarios (the deterministic decision vocabulary)

In test mode the recommendation path never executes live state: every
`POST /v1/decisions` resolves ONE scenario and returns a stable,
contract-valid `DecisionResult`. The vocabulary is FROZEN in
`@reckon/contracts` (`TEST_SCENARIOS`, `packages/contracts/src/api-platform.ts`)
— this table is the spec the docs portal's future test-mode page will be
generated from:

| Scenario | Action | Selected experience | scheduleDelta | Notes |
|---|---|---|---|---|
| `default` | `SUGGEST` | first candidate | — | the no-hint fallback |
| `suggest` | `SUGGEST` | first candidate | — | |
| `decline` | `HOLD` | none | — | the "card declined" analogue |
| `hold` | `HOLD` | none | — | |
| `queue` | `QUEUE` | none | `enqueue`: every candidate experience id | |
| `continue` | `CONTINUE` | none | — | keep the current experience |
| `switch` | `SWITCH` | second candidate (first when only one) | — | |
| `interrupt` | `INTERRUPT` | none | `resumeCheckpoint` on the first candidate | `resumeToken: "test-resume-token"` |
| `resume` | `RESUME` | first candidate | — | |
| `end` | `END` | none | — | |
| `error` | — | — | — | typed `500 api_error` (`INTERNAL`, `details.scenario: "error"`) for client error-path testing |

**How a scenario is selected** (priority order):

1. **Body field**: `"scenario": "<name>"` on the decision request body.
   The frozen `DecisionRequestSchema` strips the unknown field, so the
   hint rides pre-validation (the API peeks the raw body). An unknown
   value → `400 VALIDATION_ERROR` with `param: "scenario"` and the
   supported list in `details.supportedScenarios`.
2. **Magic test item id**: a candidate `itemId` of
   `itm_test_<scenario>` (e.g. `itm_test_decline`) — the analogue of
   Stripe's magic test card numbers. The `itm_test_` prefix is RESERVED
   on the decision path. An unknown suffix → `400 VALIDATION_ERROR`
   with `param: "candidates"`.
3. **Fallback**: `default`.

**Determinism guarantees** (integration-test grade):

- `decisionId` is `dec-test-<24 hex>` = contentDigest of
  `{requestId, scenario, tenant, candidate itemIds}` — a pure function
  of the request content; canned experience ids
  (`exp-test-<20 hex>`) likewise. No sequences, no randomness.
- `at` comes from the request (`at: 0` when omitted) — never the wall
  clock.
- Same input → byte-identical response body, whether repeated with
  fresh idempotency keys (fresh execution, same output) or the same key
  (replay). Canned decisions re-POST to the same store entry — no
  persistence drift.
- Test-mode decisions work on a DEFAULT server with zero handlers
  mounted (the canned engine is wired by `buildServer`) — live mode on
  the same server is still `501 NOT_WIRED`.

**Live-mode hint guard**: scenario hints are test-mode-only. A LIVE key
carrying a `scenario` field or an `itm_test_` candidate item id on the
decision path is rejected `403 MODE_MISMATCH` (raw-body peek,
pre-validation — the same ordering law as the tenant peek). Test keys
carrying hints is the intended usage; live keys carrying them is a mode
mixup the API names explicitly.

## API versioning (S2-001)

Every `/v1` request negotiates its version through the
`X-Reckon-Version` header against the version registry
(`src/versioning.ts`; registry type in `@reckon/contracts`):

- no header → the pinned default (`0.1.0`), echoed as `X-Reckon-Version`
  on every `/v1` response;
- a registered non-retired version → honored + echoed;
- unknown/malformed/retired → `400 VALIDATION_ERROR` (class
  `invalid_request_error`) with `param: "X-Reckon-Version"` and the
  supported list in `details`;
- `config.apiVersions` replaces the registry (the pinned default must
  then be an explicit entry — incoherent registries fail at boot);
  `config.apiVersion` remains the free-form BUILD LABEL for /healthz and
  auto-pins negotiation when it is a valid version string.

## Pagination (S2-001 — list endpoints)

`limit` (integer 1..100, default 20) + `starting_after` (an OBJECT-ID
cursor: the last id of the previous page, returned as `next_cursor`).
Responses carry `has_more` + `next_cursor` next to the collection field.
Malformed `limit`/`starting_after` → typed 400 naming the param; a
well-formed cursor that cannot be resolved inside the most recent
PAGINATION_SCAN_MAX (1000) items → typed 400 (covers cross-tenant and
aged-out cursors). STABLE ORDERING: list endpoints return items
newest-first (creation/update recency per handler); pagination is a
stable slice of that order (the engine fetches `limit + 1` items so
`has_more` is exact and pages never overlap).

## Response expansion (S2-001)

`?expand[]=field.subfield` on hardened read endpoints. Resolved
references are EMBEDDED additively (non-expanding clients see no change);
embedded objects are validated against their frozen schemas; expansion
reads are auth-tenant-scoped (TENANT LAW); unknown fields → typed 400
with `param: expand[i]`.

| Endpoint | Expandable |
|---|---|
| `GET /v1/plans/{id}` | `history`, `queuedExperiences.item` |
| `GET /v1/plans` | `queuedExperiences.item` (per element) |
| `GET /v1/decisions/{id}` | `selectedExperience.item` |

An unknown catalog item expands to `item: null` (visible, honest). An
expansion whose read port is unmounted → `501 NOT_WIRED`
(`details.port: "CatalogReader"`).

## Tenant boundary

`tenantId` is authenticated from the API key — never from the body:

- contracts that carry `tenant` (decisions, outcomes, preferences, plans):
  body tenant must match the authenticated tenant → else `403
  TENANT_MISMATCH` (checked on the RAW body before deep validation);
- contracts without a tenant field (catalog, candidates, resolve, replan,
  agents, research): the authenticated tenant is authoritative; an
  advisory `X-Reckon-Tenant` header, if present, must match → else 403;
- workspace-scoped keys must operate within their workspace;
- `GET /v1/decisions/{id}` is tenant-scoped by port interface (cross-tenant
  reads are invisible → 404);
- handler outputs are re-checked: a handler answering for another tenant →
  `500 HANDLER_TENANT_VIOLATION`, response withheld.

## Error model (one typed envelope, every failure — S2-001 catalog)

```json
{
  "error": {
    "class": "invalid_request_error",
    "code": "VALIDATION_ERROR",
    "message": "…",
    "param": "limit",
    "doc_url": "https://docs.reckon.dev/errors/validation-error",
    "details": {}
  }
}
```

`class` is one of the five stable Stripe-style classes; `code` is the
stable machine code (pre-S2-001 SCREAMING_CASE codes kept verbatim —
existing clients and the SDK error mapping keep working); `param` names
the offending request parameter; `doc_url` is composed from the catalog
(base configurable via `config.docsBaseUrl`; the docs host itself is
S1-004's surface). The catalog (single source of truth:
`@reckon/contracts` `ERROR_CATALOG`, docs table in
`packages/contracts/src/api-platform.ts`):

| Status | Class | Code | When |
|---|---|---|---|
| 400 | `invalid_request_error` | `VALIDATION_ERROR` | body/query failed contract validation; malformed JSON; non-JSON content type; bad `limit`/`starting_after`/`expand[]`; idempotency-key rules; bad `X-Reckon-Version`; unknown test scenario (test mode) |
| 401 | `authentication_error` | `UNAUTHENTICATED` | missing/malformed/unknown bearer key; publishable key used as a secret |
| 403 | `permission_error` | `TENANT_MISMATCH` | body/header tenant ≠ authenticated tenant (incl. workspace rules) |
| 403 | `permission_error` | `MODE_MISMATCH` | cross-mode violation (S2-003): test key reading live data, live key reading test data, or a live key carrying test-mode-only hints (`scenario` field / `itm_test_` ids) |
| 403 | `permission_error` | `INSUFFICIENT_SCOPE` | key lacks the route's scope |
| 404 | `invalid_request_error` | `NOT_FOUND` | unknown id inside the tenant; unknown route |
| 422 | `invalid_request_error` | `IDEMPOTENCY_CONFLICT` | `Idempotency-Key` reused with a different body (S2-001: was 409) |
| 429 | `rate_limit_error` | `RATE_LIMIT_EXCEEDED` | per-key rate limit exceeded — honor `Retry-After` |
| 501 | `api_error` | `NOT_WIRED` | no handler mounted (`details.port` names the port) |
| 500 | `api_error` | `HANDLER_RESPONSE_INVALID` / `HANDLER_TENANT_VIOLATION` / `INTERNAL` | handler invariant violations |

### Rate limiting (opt-in)

Off unless configured. `RECKON_RATE_LIMIT_MAX` (max requests per
window per key) + optional `RECKON_RATE_LIMIT_WINDOW_MS` (default
60 000) — or programmatically via `config.rateLimit`. Fixed window,
keyed by the key's sha256 hash; over-limit → `429 RATE_LIMIT_EXCEEDED`
with a `Retry-After` header (seconds to window reset).

## Idempotency (determinism — S2-001 full semantics)

- `DecisionRequest`/`OutcomeEvent` carry a body `idempotencyKey` (frozen):
  it is authoritative; a header, if present, must agree;
- every other POST requires the `Idempotency-Key` header (validated with
  the real `IdSchema`);
- a repeated key (same tenant + route + key) replays the ORIGINAL response
  with `Idempotent-Replayed: true` (the legacy lowercase
  `idempotent-replay: true` header is also sent during the transition);
  semantically identical bodies with reordered JSON keys replay too
  (digest = `contentDigest` of the parsed body);
- the same key with a different body → `422 IDEMPOTENCY_CONFLICT`
  (S2-001; was 409);
- stored responses are replayable for **24 hours** (`IDEMPOTENCY_WINDOW_MS`);
  after the window the key is forgotten — even a different body executes
  fresh. The clock is injectable (`config.clock`); the in-memory store
  evicts expired entries, and the pipeline double-checks window age for
  external stores (entries without `storedAt` are treated as
  non-expiring — the Pg store's existing rows stay compatible);
- replays are tenant- and route-scoped; only 2xx responses are stored
  (501s never are).

The key is echoed on every POST response via the `Idempotency-Key` header
(and in the body wherever the frozen contract carries it).

## Handler ports (composition)

`buildServer(config): FastifyInstance` — everything injectable: handler
ports (`config.handlers`), key store (`config.keyStore`), idempotency map
(`config.idempotencyStore`), TEST-mode idempotency map
(`config.testIdempotencyStore` — S2-003; defaults to its own in-memory
instance so test state never mixes with live state), version registry
(`config.apiVersions` + `config.defaultApiVersion`), rate limiter
(`config.rateLimit`), clock (`config.clock`), docs base
(`config.docsBaseUrl`). Missing ports default to `NotWired` (501).
`GET /readyz` reports each port as `wired` / `not-wired`. The S2-003
test-mode state (separate test idempotency scope + the canned-decision
test store + the canned engine) is wired by `buildServer` itself and is
NOT a mountable port — it is always available.

Ports: `DecisionHandler`, `DecisionStore` (tenant-scoped `get`),
`OutcomeIngestHandler`, `PreferenceIngestHandler`, `PlanHandler`
(create/replan/get/history/listRecent), `CatalogItemIngestHandler`,
`CatalogReader` (S2-001 expansion reads: tenant-scoped
`getItem`/`getRealization`), `RealizationIngestHandler`,
`CandidatesHandler`, `ExperienceResolveHandler`, `AgentHandler`,
`ResearchHandler`, `IntegrationHandler`. All port signatures take the
`AuthContext` (tenant + key mode from the key).

The runnable app (`src/main.ts`) wires env config + the production
composition (real W2 kernels over PostgreSQL per ADR-001):
`pnpm --filter @reckon/api start` (RECKON_PORT, default 8080).

## Schema echo

Every success response carries `schema` + `schemaVersion`: contract objects
get them from the frozen schemas themselves (zod defaults, applied by
server-side parse); the candidate-set response gets an API-level echo
(`schema: "reckon.candidate-set"`, `schemaVersion: CONTRACTS_VERSION`) and
the resolve response echoes the registered Experience contract id/version.
`"reckon.candidate-set"` is an API-level label, not a CONTRACT_IDS registry
entry (flagged for TL3).

## Webhooks (S2-002 — event catalog, signatures, replay, delivery log)

The webhook system implements the contract documented on the docs portal
(`apps/docs/src/content/webhooks.ts`): thin events, `Reckon-Signature`
HMAC delivery, at-least-once semantics with dedupe on `event.id`,
30-day replay retention, and a queryable delivery log. The contracts are
frozen in `@reckon/contracts` (`src/webhooks.ts`); the emission seam lives
in `@reckon/events` (`src/emission.ts` — domain mappers + the
`ReckonEventPublisher` port); the delivery engine is `src/webhooks/`.

### Event catalog

| Event type | Fires when | Payload anchors (`data.object`) |
|---|---|---|
| `recommendation.delivered` | an `impression` outcome confirms a `SUGGEST`/`SWITCH` decision became user-visible | `decisionId, requestId, experienceId, itemId, action, deliveredAt` |
| `model.drift.detected` | the research runtime's drift monitor crosses its threshold | `modelId, modelVersion, driftScore, threshold, window, metric, evaluatedAt` |
| `schedule.executed` | a decision's schedule delta executes against a plan | `planId, decisionId, action, enqueued, dequeued, executedAt` |
| `preference.updated` | learning appends a preference delta | `deltaId, subject, dimension, op, resultingConfidence?, modelId, modelVersion` |
| `webhook.endpoint.created` | a tenant registers an endpoint | `endpointId, url, eventTypes` |
| `webhook.endpoint.deleted` | a tenant deletes an endpoint | `endpointId, url` |

Events are **thin by construction** (the envelope schema allows only
`{id, object: "event", type, created, tenant, data: {object}}`); the four
loop events are exactly the documented ones (the lockstep test parses the
docs' payload examples and validates them against the shipped schema).

### Emission seam

When `config.webhooks` is mounted, `buildServer` decorates the WIRED
domain handlers (outermost, after the observability wrappers):

- `POST /v1/decisions` (a schedule delta with a resolvable `planId`) →
  `schedule.executed`;
- `POST /v1/outcomes` with `eventType: "impression"` + `decisionId` →
  `recommendation.delivered` (requestId/action/item anchors resolved from
  the decision store; absent anchors skip emission — fields are never
  invented);
- `POST /v1/preferences/events` → `preference.updated`;
- the drift monitor publishes `model.drift.detected` through the same
  `ReckonEventPublisher` port (research-runtime lane).

`publish` is total: delivery failures land in the delivery log and can
never break a domain route. Duplicate `(tenant, event.id)` publishes are
deduped at the seam (no second fan-out).

### Signatures

Every delivery POST carries:

```
Content-Type: application/json
Reckon-Signature: t=<unix-seconds>,v1=<hex>
```

`v1` is HMAC-SHA256 over `"{t}.{rawBody}"` with the endpoint's `whsec_…`
secret (issued ONCE in the creation response, never returned again). The
shipped verifier `verifyReckonSignature(rawBody, header, secret)` mirrors
the docs' TypeScript reference sample byte-for-byte (5-minute tolerance
on `t`, constant-time comparison). The docs' TS + Python samples are
EXECUTED by `test/webhook-signature-docs.test.ts` (the TS sample compiled
+ imported; the Python sample run via python3) and must accept/reject in
agreement with the shipped signer/verifier.

### Delivery semantics + retry policy

- At-least-once: receivers dedupe on `event.id`; replays reuse the SAME
  event id.
- The raw body is the CANONICAL JSON of the event (deterministic
  serialization law); the signature covers exactly those bytes.
- Attempt 1 runs inline at emission/replay; retries follow the shipped
  schedule — **3 total attempts, exponential backoff 100ms ×2 capped at
  30s, bounded by the documented 3-day retry window** — over the injected
  clock (deterministic, no hidden timers; `pump()`/`flush()` drive the
  worker). Every knob is configurable (`WebhookRetryOptions`).
- Terminal outcomes (success on 2xx; failure after max attempts, window
  exhaustion, or a deleted endpoint/evicted event) are recorded in the
  delivery log — never dropped.
- Events are retained for replay for 30 days (swept on publish/pump).
- An endpoint with an all-events (empty) filter receives its own
  `webhook.endpoint.created` event — a built-in secret check.

### Replay

`POST /v1/webhooks/events/{id}/replay` re-delivers the stored event to
the tenant's CURRENTLY matching endpoints; each replay creates fresh
delivery-log rows marked `replayed: true`. The route requires an
`Idempotency-Key` (same key + same path → the stored response replays
without re-delivering). Unknown/cross-tenant/retention-expired events
answer typed 404.

### Delivery log

`GET /v1/webhooks/deliveries` (cursor-paginated, newest first, optional
`endpoint_id`/`event_id` filters) returns one row per (event, endpoint)
per delivery wave: `attempts`, `status` (`pending`/`succeeded`/`failed`),
`responseCode`, `latencyMs`, `error`, `replayed`, `createdAt`, `updatedAt`.

### Composition + persistence posture

Mount the system through `buildServer({ webhooks })`:

```ts
import { createInMemoryWebhookSystem, FetchWebhookHttpClient } from "@reckon/api";

const app = buildServer({
  keys,
  webhooks: createInMemoryWebhookSystem({
    httpClient: new FetchWebhookHttpClient(), // or your own adapter
    // clock, retry schedule, id/secret generators — all injectable
  }),
});
```

Without `config.webhooks`, every `/v1/webhooks` route answers the typed
501 `NOT_WIRED` (the `webhookHandler` port default — `/readyz` reports
it). Mounting both `config.webhooks` and `handlers.webhookHandler` is a
startup `ConfigError`.

EVIDENCE LABEL: the in-memory stores are TEST INFRASTRUCTURE
(controlled-local) — the same posture as `InMemoryIdempotencyStore`.
The PG-backed stores are a later wave (the `WebhookEndpointStore` /
`WebhookEventStore` / `WebhookDeliveryStore` ports in
`src/webhooks/ports.ts` are the seam); secrets at rest, delivery-worker
scheduling and encrypted `whsec_` storage are that wave's surface.
SSRF note: `FetchWebhookHttpClient` POSTs whatever https URL the tenant
registered — hosts exposed to untrusted tenants should wrap it with
egress filtering (the host owns its security posture, never the API).

## Tests

`pnpm --filter @reckon/api test` — colocated in `test/`, using
`fastify.inject` only (no real sockets): the full route × failure-mode
matrix, auth (401 family, key hashing, RECKON_API_KEYS parsing), the
S2-001 key-model matrix (`keys.test.ts`: sk_live/sk_test/pk_ keys, mode
propagation, config discipline), the S2-003 test-mode battery
(`test-mode.test.ts`: key-mode matrix, scenario determinism, cross-mode
rejection both directions, mode marker presence), versioning matrix
(`versioning.test.ts`), idempotency (replay/conflict/isolation + 24h
window + replay headers + mode-scoped stores), expansion
(`expansion.test.ts`), pagination edges (`pagination.test.ts`), the
error catalog + rate limiting (`errors-catalog.test.ts`), tenant
boundary, validation, health/readyz, and success shapes validated with
imported contract schemas.

S2-002 adds the webhook suites: `webhook-signature-docs.test.ts` (docs
TS/Python samples executed against the shipped signer — lockstep),
`webhook-catalog.test.ts` (docs payload examples validate against the
frozen envelope), `webhook-endpoints.test.ts` (CRUD + auth matrix +
secret issuance + idempotent creation + NotWired), `webhook-delivery.test.ts`
(signed delivery E2E, filters, deterministic retries, terminal failures,
window exhaustion), `webhook-replay.test.ts` (same-id re-delivery,
route idempotency, retention sweep), `webhook-deliveries-pagination.test.ts`
(cursor walk, limit bounds, filters), `webhook-emission.test.ts` (the
seam: decisions/outcomes/preferences → events through the real routes).

## Limitations (this wave)

- static API keys only (config-provided; no rotation, no identity system;
  no key-management endpoints yet — test keys are minted via
  `mintKeyConfig` until the S3 dashboard provisions them);
- rate limiting is a single-process fixed window (off by default);
- the in-memory idempotency map is single-process; the Pg store keeps
  working but does not yet persist `storedAt` (window checks treat its
  entries as non-expiring until S2-002+ wires it);
- `doc_url` targets a placeholder docs host (`ERROR_DOC_URL_BASE`) until
  S1-004 builds the docs portal (configurable per deployment; the docs
  portal's test-mode page will be generated from `TEST_SCENARIOS` in
  `@reckon/contracts` — the README table above is that spec today);
- webhooks: the shipped stores are in-memory (TEST INFRASTRUCTURE — the
  PG-backed stores/delivery worker are a later wave; see the Webhooks
  section), and the production composition does not mount the system yet
  (routes answer 501 until then);
- S2-003 test state is per-process: the separate test idempotency scope
  and the canned-decision test store are in-memory by default (hosts can
  inject `config.testIdempotencyStore`); durable test-state
  infrastructure (a dedicated test database, dashboard test-data
  tooling) is the future dashboard wave's surface. The PRODUCTION
  composition's live handlers (catalog/plans/outcome persistence) do not
  yet segregate their own storage by mode — the API layer guarantees
  mode separation for every state surface it owns (idempotency, the
  decision path, decision reads, expansion reads); full Pg-level test/live
  table separation lands with the dashboard/host composition wave
  (documented divergence, TL3-flagged);
- no CORS/OpenAPI generation yet; no SDKs (S2-004 — the seam is the
  hardened API surface itself plus `packages/contracts`).

## RELEASE-002 (stripe phase, 2026-10-05)

Production deploy note (Lead): this release redeploys `reckon-api` unchanged-in-code
since the wave-2 merge (webhooks + test-mode + keys surface shipped there); the
bundle regenerated and verified this window per the S4-002 report. This note
exists so the Vercel rootDirectory change-detection sees a fresh deploy.

## REDEPLOY-002b (stripe phase, 2026-10-05 23:2xZ)

Production deploy note (Lead): the RELEASE-002 note above was WRONG in effect —
the serving function stayed pre-stripe-phase (S5-003 drift register, evidence
class wire+machine-verified: typed 401/404 envelopes lacked the S2-001
class/param/doc_url fields; /v1/webhooks/endpoints 404'd — the S2-002 webhook
family unregistered; pk_live_ probes got the generic unknown-key message).
This note triggers the git-path production redeploy of current main (67b9b7b:
TL4 complete + S5-001 + S5-003 + S5-002) so the wire matches the frozen
surface. Re-verify with scripts/verify-production.mjs after deploy.

## TL6-001 production deployment note (Lead, 2026-10-06)

Main `97d9fcf` merges the account surface: `/v1/account/*` routes
(signup/login/logout, keys list/mint-show-once/revoke), the
`LayeredKeyAuthenticator` (static env keys first, DB account-key fallback),
tier-aware rate limits, and the `m005_accounts` migration (applied on boot by
the composition's idempotent migrate step — no manual step). New env vars,
all optional with frozen defaults: `RECKON_TIER_RATE_LIMITS`
(`free:60,pro:600,enterprise:` — empty tier value = unlimited). The
`RECKON_API_KEYS` static map keeps byte-identical behavior and precedence
over DB-minted keys.
