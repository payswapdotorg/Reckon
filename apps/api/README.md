# @reckon/api — HTTP API skeleton + auth/tenant boundary (W3-001)

Reckon's consumer-facing HTTP surface: a fastify composition root where
every route is validated against the FROZEN contracts from
`@reckon/contracts` (imported — never re-declared), every failure uses one
typed error envelope, and the decision kernel is behind injectable handler
ports that default to deterministic `NotWired` (501) responders.

The API makes **zero LLM calls** (architecture lock #6). Identity authority
stays with the host (lock #4): the static API-key map is an explicit
boundary seam for this wave, not an identity system.

## Routes

| Route | Scope | Request schema | Response schema |
|---|---|---|---|
| `POST /v1/decisions` | `decisions` | `DecisionRequestSchema` | `DecisionResultSchema` |
| `GET /v1/decisions/{id}` | `decisions` | — (path id) | `DecisionResultSchema` (404 unknown, 501 no store) |
| `POST /v1/outcomes` | `outcomes` | `OutcomeEventSchema` | `OutcomeEventSchema` (accepted echo) |
| `POST /v1/preferences/events` | `outcomes` | `PreferenceDeltaSchema` | `PreferenceDeltaSchema` (accepted echo) |
| `POST /v1/plans` | `plans` | `ExperiencePlanSchema` | `ExperiencePlanSchema` |
| `POST /v1/plans/{id}/replan` | `plans` | `ReplanRequestSchema` (envelope) | `ExperiencePlanSchema` |
| `POST /v1/catalog/items` | `catalog` | `CatalogItemSchema` | `CatalogItemSchema` |
| `POST /v1/catalog/realizations` | `catalog` | `RealizationSchema` | `RealizationSchema` |
| `POST /v1/candidates` | `decisions` | `CandidateSetSchema` | `CandidateSetSchema` + API schema echo |
| `POST /v1/experiences/resolve` | `decisions` | `ResolveRequestSchema` (envelope) | `ResolveResponseSchema` + API schema echo |
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

## Auth (static API keys)

`Authorization: Bearer <key>`. Keys come from `RECKON_API_KEYS`
(`key1:tenant1:scope1,scope2;key2:tenant2:...`) or `RECKON_API_KEYS_FILE`
(same format, one entry per line; file wins). Keys are hashed (sha256) at
rest in memory; the raw key is never stored, logged, or echoed.

Scopes: `decisions`, `outcomes`, `plans`, `catalog`, `research` (research
routes arrive in later waves).

## Tenant boundary

`tenantId` is authenticated from the API key — never from the body:

- contracts that carry `tenant` (decisions, outcomes, preferences, plans):
  body tenant must match the authenticated tenant → else `403
  TENANT_MISMATCH` (checked on the RAW body before deep validation);
- contracts without a tenant field (catalog, candidates, resolve, replan):
  the authenticated tenant is authoritative; an advisory `X-Reckon-Tenant`
  header, if present, must match → else 403;
- workspace-scoped keys must operate within their workspace;
- `GET /v1/decisions/{id}` is tenant-scoped by port interface (cross-tenant
  reads are invisible → 404);
- handler outputs are re-checked: a handler answering for another tenant →
  `500 HANDLER_TENANT_VIOLATION`, response withheld.

## Error model (one typed envelope, every failure)

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "...", "details": {} } }
```

| Status | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | body failed contract validation; malformed JSON; non-JSON content type; idempotency-key rules |
| 401 | `UNAUTHENTICATED` | missing/malformed/unknown bearer key |
| 403 | `TENANT_MISMATCH` | body/header tenant ≠ authenticated tenant (incl. workspace rules) |
| 403 | `INSUFFICIENT_SCOPE` | key lacks the route's scope |
| 404 | `NOT_FOUND` | unknown decision id; unknown route |
| 409 | `IDEMPOTENCY_CONFLICT` | key reused with a different body |
| 501 | `NOT_WIRED` | no handler mounted (details.port names the port) |
| 500 | `HANDLER_RESPONSE_INVALID` / `HANDLER_TENANT_VIOLATION` / `INTERNAL` | handler invariant violations |

## Idempotency (determinism)

- `DecisionRequest`/`OutcomeEvent` carry a body `idempotencyKey` (frozen):
  it is authoritative; a header, if present, must agree;
- every other POST requires the `Idempotency-Key` header (validated with
  the real `IdSchema`);
- a repeated key (same tenant + route + key) replays the ORIGINAL response
  (`Idempotent-Replay: true`); semantically identical bodies with reordered
  JSON keys replay too (digest = `contentDigest` of the parsed body);
- the same key with a different body → `409 IDEMPOTENCY_CONFLICT`;
- replays are tenant- and route-scoped; only 2xx responses are stored
  (501s never are).

The key is echoed on every POST response via the `Idempotency-Key` header
(and in the body wherever the frozen contract carries it).

## Handler ports (composition)

`buildServer(config): FastifyInstance` — everything injectable: handler
ports (`config.handlers`), key store (`config.keyStore`), idempotency map
(`config.idempotencyStore`). Missing ports default to `NotWired` (501).
`GET /readyz` reports each port as `wired` / `not-wired`.

Ports: `DecisionHandler`, `DecisionStore` (tenant-scoped `get`),
`OutcomeIngestHandler`, `PreferenceIngestHandler`, `PlanHandler`
(create/replan), `CatalogItemIngestHandler`, `RealizationIngestHandler`,
`CandidatesHandler`, `ExperienceResolveHandler`. All port signatures take
the `AuthContext` (tenant from the key).

The runnable app (`src/main.ts`) wires env config + NotWired defaults:
`pnpm --filter @reckon/api start` (RECKON_PORT, default 8080).

## Schema echo

Every success response carries `schema` + `schemaVersion`: contract objects
get them from the frozen schemas themselves (zod defaults, applied by
server-side parse); the candidate-set response gets an API-level echo
(`schema: "reckon.candidate-set"`, `schemaVersion: CONTRACTS_VERSION`) and
the resolve response echoes the registered Experience contract id/version.
`"reckon.candidate-set"` is an API-level label, not a CONTRACT_IDS registry
entry (flagged for TL3).

## Tests

`pnpm --filter @reckon/api test` — colocated in `test/`, using
`fastify.inject` only (no real sockets): the full route × failure-mode
matrix, auth (401 family, key hashing, RECKON_API_KEYS parsing), tenant
boundary (body/header/workspace/cross-tenant/handler invariants),
validation (400 family), idempotency (replay/conflict/isolation),
health/readyz, and success shapes validated with imported contract
schemas.

## Limitations (this wave)

- static API keys only (config-provided; no rotation, no identity system);
- all handler ports default to NotWired (501) — no decision kernel, no
  persistence (ADR-001 Postgres adapters arrive in later waves);
- in-memory idempotency map only (single process);
- no CORS/rate limiting/OpenAPI generation yet (later W3 waves);
- `schemaVersion` is accepted as any string per the frozen schemas (no
  major-version negotiation yet).
