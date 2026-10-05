# Reckon — End-to-End Journey Proof (S4-001)

> Produced 2026-10-05 per WORK ORDER S4-001, branch `work/s4-001-journey`
> (base `ff4f9bb`). Every claim below is either machine-observed in this
> release window from a REAL run of the frozen surface or explicitly labeled
> with its evidence class. No aspirational prose (the
> `final-release-evidence.md` law).

## 1. What this proves

The complete customer journey — **signup → API key → first recommendation
call → log entry → analytics entry → webhook event** — was driven in ONE
in-process TEST-MODE run against the REAL repository stack and captured as
durable evidence:

- the **REAL apps/api** application (`buildServer` — the same injectable
  composition root `packages/sdk/test/harness.ts` boots), with the REAL
  route pipeline (bearer-key auth, mode marking, scopes, tenant law, zod
  validation, mode-scoped idempotency, typed error envelopes);
- the **REAL in-memory webhook system** mounted through the REAL
  composition path (`config.webhooks`) — endpoint CRUD, event retention,
  signed deliveries, delivery log;
- the **REAL observability composition** (`config.observability` +
  `InMemoryObservabilitySink` — the same seam `PgObservabilitySink` plugs
  into in production);
- the **REAL S3-002 analytics data layer** (`apps/web/src/lib/analytics-ctr-lift.ts`
  — the shipped wire guards + `computeCtrLift` the dashboard views render);
- the **SHIPPED signature verification** (`verifyWebhook` from
  `packages/sdk/src/webhooks.ts` — the docs-named re-export of the
  reference implementation in `@reckon/contracts`).

Honest composition caveat (evidence class: **reproduced**, controlled-local):
the handler ports are deterministic echo seams (the injectable seams by
design — exactly the harness pattern), the outbound webhook HTTP client is
a recording 200-responder, and the observability sink is in-memory. The
routes, auth, test-mode engine, webhook engine, signature scheme, and
analytics computation are the real shipped code. Nothing below is simulated
or paraphrased; every not-wired hop is named, never faked.

## 2. Re-run command (exact)

```bash
cd ~/reckon && git checkout work/s4-001-journey
pnpm install && pnpm build          # the driver loads @reckon/contracts from its built dist
node scripts/e2e-journey.mjs        # exit 0 iff all six hops assert; transcript on stdout
node scripts/e2e-journey.mjs --json # machine capture: full structured report on stdout
```

Node ≥ 22.18 (type stripping) is required — verified on v24.21.0. The
full verification battery of this work order:

```bash
cd ~/reckon && pnpm install
pnpm build && pnpm typecheck && pnpm test && node scripts/verify-repo.mjs
node scripts/e2e-journey.mjs
```

## 3. Journey map (step → surface → route → captured artifact)

Every route the driver touched, in journey order, with its status on the
frozen `ff4f9bb` surface. "not-wired" rows are the honestly pending routes —
attempted live, answered by the real API's typed 404, and named verbatim in
the shipped dashboard library that awaits them.

| Step | Stage | Surface | Route | Status on ff4f9bb | Captured artifact (this run) |
|---|---|---|---|---|---|
| 1 | signup | apps/api composition (auth.ts / server.ts) | `GET /healthz` (boot probe) | wired | 200 `{ok:true, version:"0.1.0"}` |
| 1 | signup | apps/api composition — no HTTP route (key-issuance-based) | `mintKeyConfig` + `buildServer({ keys })` (composition seam) | wired — the first key issuance IS signup | tenant `journey-s4-001` + `sk_test_…Vb4W` (redacted) |
| 2 | api-key | apps/api | `POST /v1/api-keys` | not-wired (pending) | typed 404 `NOT_FOUND` envelope + one-time secret `sk_test_…Vb4W` from the composition issuance |
| 2 | api-key | apps/api | `GET /v1/webhooks/endpoints` (authenticated key probe) | wired | 200, empty list, `X-Reckon-Mode: test` |
| 3 | decision | apps/api | `POST /v1/decisions` | wired | decisionId `dec-test-add3fafbe3fe36454935fb2a` (action SUGGEST, mode test) |
| 3 | decision | apps/api | `GET /v1/decisions/{decisionId}` | wired | read-back of the same decision row from the mode-isolated test store |
| 4 | request-log | apps/api | `GET /v1/request-logs` | not-wired (pending) | typed 404 `NOT_FOUND` envelope + the real trail rows (idempotency-replay row, test-store row) |
| 5 | analytics | apps/api | `POST /v1/outcomes` | wired | outcome `ev-journey-impression-1` linked to the decision (the funnel/CTR row) |
| 5 | analytics | apps/api | `GET /v1/decisions` | not-wired (pending — decision-trail list) | typed 404 `NOT_FOUND` envelope |
| 5 | analytics | apps/api | `GET /v1/outcomes` | not-wired (pending — outcome-trail list) | typed 404 `NOT_FOUND` envelope |
| 5 | analytics | apps/api | `GET /v1/preferences/events` | not-wired (pending — preference-trail list) | typed 404 `NOT_FOUND` envelope |
| 6 | webhook | apps/api | `POST /v1/webhooks/endpoints` | wired | endpoint `we_ckTv4kmhDWYwsWTCYyO1GgkB` + one-time `whsec_…MXr6` (redacted) |
| 6 | webhook | apps/api | `POST /v1/preferences/events` (emission trigger) | wired | delta `delta-journey-1` → event `preference.updated` |
| 6 | webhook | apps/api | `GET /v1/webhooks/events/{eventId}` | wired | event `evt_CiLvFA7elKtPR8giKbmnqgeB` (type `preference.updated`, 30-day retention) |
| 6 | webhook | apps/api | `GET /v1/webhooks/deliveries` | wired | delivery `wd_ArHiKzCPaZHkGQeAPeFQnpm6` (succeeded, attempts 1, responseCode 200) |
| 6 | webhook | apps/api | `GET /v1/events` | not-wired (pending — events-console aggregate) | typed 404 `NOT_FOUND` envelope |

Asserted journey order (lockstep-enforced in
`apps/api/test/e2e-journey-map.test.ts`): key before decision, decision
before log row, event before delivery.

## 4. Captured transcript (REAL run — evidence class: observed)

Run of 2026-10-05 ~07:27 UTC, Node v24.21.0, base `ff4f9bb`, branch
`work/s4-001-journey`, command `node scripts/e2e-journey.mjs`, exit 0.
Verbatim stdout; secrets redacted by the driver itself (`sk_test_…XXXX`,
`whsec_…XXXX` — the token bodies never reach the transcript).

```text
reckon e2e journey driver (S4-001) — evidence class: observed (real in-process run)
head: ff4f9bb · mode: test · composition: real apps/api buildServer (the harness pattern)
not-wired hops are attempted live, captured verbatim and named — never faked

STEP 1 signup (account provisioning)
  · no signup/account HTTP route exists on the frozen surface: provisioning is key-issuance-based (apps/api/src/auth.ts — keys are configured, never discovered; the host is the identity authority) — THE FIRST KEY ISSUANCE IS SIGNUP
  · minted first key for tenant journey-s4-001 → sk_test_…Vb4W (redacted; mode=test, scopes=[decisions outcomes plans catalog webhooks])
  · booted the REAL in-process API (buildServer composition) — GET /healthz → 200 (version 0.1.0)
STEP 1 OK — signup hop asserted (key-issuance-based provisioning)

STEP 2 api-key (one-time secret)
  · the Stripe-grammar key route POST /v1/api-keys is attempted verbatim (the route apps/web developers-api.ts names as pending); the working secret is the step-1 composition issuance — captured one-time, redacted
  · POST /v1/api-keys → 404 NOT_FOUND (pending route; the API-keys manager view shows this same not-wired state)
  · the one-time secret from the composition issuance (never re-displayable — the KeyStore keeps only its sha256): sk_test_…Vb4W
STEP 2 OK — api-key hop asserted (pending route named + one-time secret captured redacted)

STEP 3 decision (first recommendation)
  · POST /v1/decisions with the test key and the magic item itm_test_suggest (the quickstart's canonical first call) — the canned test-mode engine answers, never the live handler
  · decision envelope: decisionId=dec-test-add3fafbe3fe36454935fb2a · action=SUGGEST · mode=test
  · selected experience: exp-test-e5a1e700e59162c91174 (item itm_test_suggest, realization real-journey-1)
  · separation law: mounted live decision handler invocations = 0 (test mode never executes live handler state)
STEP 3 OK — decision hop asserted (canned envelope + test-store read-back + separation law)

STEP 4 request-log (log entry)
  · the request-log surface GET /v1/request-logs is attempted verbatim (the route the dashboard request-logs view and the latency analytics attempt); the real trail rows today's surface keeps for this call are captured
  · GET /v1/request-logs → 404 NOT_FOUND (pending route; the request-logs view + latency analytics show this same not-wired state)
  · call row captured for the first recommendation (driver-observed — the API-reported row arrives with the pending route): route=POST /v1/decisions · status=200 · mode=test (X-Reckon-Mode) · latency=5.3ms
  · idempotency trail row: re-POST → Idempotent-Replayed: true · same decisionId=dec-test-add3fafbe3fe36454935fb2a · handler invocations still 0
STEP 4 OK — request-log hop asserted (pending route named + real trail rows captured)

STEP 5 analytics (analytics entry)
  · an outcome reports the step-3 decision back via POST /v1/outcomes so the funnel/CTR linkage has a real row; the analytics trail reads the S3-002 views consume are attempted verbatim; the REAL S3-002 data layer then computes over this journey's rows
  · outcome row: eventId=ev-journey-impression-1 · eventType=impression · decisionId=dec-test-add3fafbe3fe36454935fb2a (the funnel/CTR linkage row)
  · observability outcome-linkage record: recordId=2746335f-c3f1-4532-8a73-208fa3c23eb1 · linked=true · decisionId=dec-test-add3fafbe3fe36454935fb2a
  · GET /v1/decisions → 404 NOT_FOUND (pending trail read)
  · GET /v1/outcomes → 404 NOT_FOUND (pending trail read)
  · GET /v1/preferences/events → 404 NOT_FOUND (pending trail read)
  · S3-002 ctr-lift data layer over this journey: exposed={n:1, engaged:0, ctr:0, wilson:[0, 0.793]} · unexposed={n:0} · lift={"absolutePct":null,"ratio":null,"direction":"inconclusive"}
  · caveats rendered by the shipped model: observational, small-sample-exposed, no-baseline
STEP 5 OK — analytics hop asserted (real outcome row + linkage record + real S3-002 computation + pending trail reads named)

STEP 6 webhook (webhook event)
  · register an endpoint (POST /v1/webhooks/endpoints — one-time whsec_ captured), trigger the journey's own event (POST /v1/preferences/events → preference.updated), retrieve the event, poll the delivery log, and verify the signature with the SHIPPED SDK verifyWebhook
  · endpoint registered: id=we_ckTv4kmhDWYwsWTCYyO1GgkB · one-time secret whsec_…MXr6 (redacted; shown exactly once by the surface)
  · lifecycle event webhook.endpoint.created delivered (outbound POST #1 captured with its exact signed bytes)
  · event retrieved: id=evt_CiLvFA7elKtPR8giKbmnqgeB · type=preference.updated · tenant=journey-s4-001
  · delivery row: id=wd_ArHiKzCPaZHkGQeAPeFQnpm6 · eventId=evt_CiLvFA7elKtPR8giKbmnqgeB · status=succeeded · attempts=1 · responseCode=200 · latencyMs=1
  · GET /v1/events → 404 NOT_FOUND (pending; the events console shows this same not-wired state today)
  · signature verification (shipped verifyWebhook): positive=true · tampered-body=false · wrong-secret=false · lifecycle-delivery=true
STEP 6 OK — webhook hop asserted (endpoint + event + delivery row + shipped-algorithm signature verification)

JOURNEY COMPLETE: 6/6 hops asserted · exit 0 · head ff4f9bb · evidence class observed
journey map (step → route → status → captured artifact):
  1 signup (account provisioning) | GET /healthz (composition boot probe) | wired | tenant journey-s4-001 + sk_test_…Vb4W
  2 api-key (one-time secret) | POST /v1/api-keys | not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_API_KEY_ROUTES.create) | sk_test_…Vb4W
  2 api-key (one-time secret) | GET /v1/webhooks/endpoints (authenticated key probe) | wired | sk_test_…Vb4W
  3 decision (first recommendation) | POST /v1/decisions | wired | dec-test-add3fafbe3fe36454935fb2a
  3 decision (first recommendation) | GET /v1/decisions/{decisionId} | wired | dec-test-add3fafbe3fe36454935fb2a
  4 request-log (log entry) | GET /v1/request-logs | not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_REQUEST_LOG_ROUTE) | dec-test-add3fafbe3fe36454935fb2a (replayed row)
  5 analytics (analytics entry) | POST /v1/outcomes | wired | ev-journey-impression-1 → dec-test-add3fafbe3fe36454935fb2a
  5 analytics (analytics entry) | GET /v1/decisions | not-wired (pending — apps/web/src/lib/analytics-ctr-lift.ts PENDING_DECISION_LIST_ROUTE (ctr-lift + funnel decision trail)) | ev-journey-impression-1 → dec-test-add3fafbe3fe36454935fb2a
  5 analytics (analytics entry) | GET /v1/outcomes | not-wired (pending — apps/web/src/lib/analytics-ctr-lift.ts PENDING_OUTCOME_LIST_ROUTE (ctr-lift + funnel outcome trail)) | ev-journey-impression-1 → dec-test-add3fafbe3fe36454935fb2a
  5 analytics (analytics entry) | GET /v1/preferences/events | not-wired (pending — apps/web/src/lib/analytics-funnel.ts PENDING_PREFERENCE_DELTA_LIST_ROUTE (funnel preference trail)) | ev-journey-impression-1 → dec-test-add3fafbe3fe36454935fb2a
  6 webhook (webhook event) | POST /v1/webhooks/endpoints | wired | evt_CiLvFA7elKtPR8giKbmnqgeB → wd_ArHiKzCPaZHkGQeAPeFQnpm6
  6 webhook (webhook event) | POST /v1/preferences/events | wired | evt_CiLvFA7elKtPR8giKbmnqgeB → wd_ArHiKzCPaZHkGQeAPeFQnpm6
  6 webhook (webhook event) | GET /v1/webhooks/events/{eventId} | wired | evt_CiLvFA7elKtPR8giKbmnqgeB → wd_ArHiKzCPaZHkGQeAPeFQnpm6
  6 webhook (webhook event) | GET /v1/webhooks/deliveries | wired | evt_CiLvFA7elKtPR8giKbmnqgeB → wd_ArHiKzCPaZHkGQeAPeFQnpm6
  6 webhook (webhook event) | GET /v1/events | not-wired (pending — named in apps/web/src/lib/developers-api.ts PENDING_EVENT_ROUTES.list) | evt_CiLvFA7elKtPR8giKbmnqgeB → wd_ArHiKzCPaZHkGQeAPeFQnpm6
```

Determinism note (observed across runs): the canned decision ids are pure
functions of the request content (`dec-test-add3fafbe3fe36454935fb2a` is
stable for this exact request body — the S2-003 determinism contract); the
`we_…` / `evt_…` / `wd_…` ids, the `sk_test_` token and the `whsec_` secret
are freshly minted per run (crypto-random), so a re-run shows the same
decision/event/delivery shape with new random ids and new redacted
suffixes. The `recordId` of the observability record is a fresh UUID per
run. Latency values vary per run (driver-observed wall clock).

## 5. Not-wired register (the honest hops)

Evidence class: **observed** — each row was attempted live in this run and
answered by the real API's typed 404 `NOT_FOUND` envelope; the pending
route is named verbatim in the shipped dashboard library that awaits it.

| Pending route | Named in (shipped constant) | Journey step | What the surface does instead (today) |
|---|---|---|---|
| `POST /v1/api-keys` | `apps/web/src/lib/developers-api.ts` → `PENDING_API_KEY_ROUTES.create` | 2 | Key provisioning is composition-time: the host mints key configs (`mintKeyConfig`, `apps/api/src/auth.ts`) and constructs the KeyStore with them (hashed at rest, one-time display). The first key issuance IS the signup hop. |
| `GET /v1/request-logs` | `apps/web/src/lib/developers-api.ts` → `PENDING_REQUEST_LOG_ROUTE` | 4 | The real per-call trail rows today: the test-store decision row (`GET /v1/decisions/{id}`) and the mode-scoped idempotency entry (replay proven: `Idempotent-Replayed: true`). A test-mode decision emits NO observability decision record (the canned path never executes the observability-wrapped live handler — the SEPARATION LAW). |
| `GET /v1/decisions` (list) | `apps/web/src/lib/analytics-ctr-lift.ts` → `PENDING_DECISION_LIST_ROUTE` | 5 | Decision rows are writable (`POST /v1/decisions`) and individually readable (`GET /v1/decisions/{id}`); the list read is pending. |
| `GET /v1/outcomes` (list) | `apps/web/src/lib/analytics-ctr-lift.ts` → `PENDING_OUTCOME_LIST_ROUTE` | 5 | Outcomes are append-only through the public API (`POST /v1/outcomes`); no list/read surface yet. The observability outcome-linkage record (captured in this run) is the analytics-linkage row the data layer holds today. |
| `GET /v1/preferences/events` (list) | `apps/web/src/lib/analytics-funnel.ts` → `PENDING_PREFERENCE_DELTA_LIST_ROUTE` | 5 | Preference deltas are append-only (`POST /v1/preferences/events`); the list read is pending. |
| `GET /v1/events` | `apps/web/src/lib/developers-api.ts` → `PENDING_EVENT_ROUTES.list` | 6 | The webhook system's own surfaces ARE wired (`GET /v1/webhooks/events/{id}`, `GET /v1/webhooks/deliveries` — both captured in this run); the dashboard-wide events aggregate is pending. |

Also honestly recorded (observed in this run): a test-mode `impression`
outcome does NOT emit a `recommendation.delivered` webhook — the
delivery-confirmation lookup resolves the LIVE decision store, which by the
mode-separation law holds no test decisions, and the emission seam never
invents anchors. The journey's webhook event is therefore the
`preference.updated` emission (fires for every appended delta in any mode)
plus the `webhook.endpoint.created` lifecycle event.

## 6. Dashboard-visibility map (which view shows each captured artifact)

Evidence class: **observed (code)** — each mapping is read off the shipped
view/lib code on `ff4f9bb`; the honest not-wired states are what the views
render today for the pending routes (Gate Q: the dashboard renders real
state or says precisely what is missing — never fabricated data).

| Journey artifact | Dashboard view | What the view shows today |
|---|---|---|
| signup: tenant + `sk_test_…` key | API-keys manager — `/developers/keys` (`apps/web/src/lib/api-keys-view.ts`) | not-wired state naming `GET /v1/api-keys` / `POST /v1/api-keys` / `DELETE /v1/api-keys/{id}` verbatim (the once-only-secret flow machine is shipped and lights up when the routes land) |
| first recommendation (`dec-test-…`) | Decisions workspace — `/decisions` (decision retrieval, live-mode demo data) + Analytics → CTR-lift & Funnel (`/analytics`) | the decision row itself is only visible to the API surface today (`GET /v1/decisions/{id}`); the analytics views show not-wired states naming `GET /v1/decisions` — and this run proves the exact `computeCtrLift` result those views will render for this journey's rows (`exposed n=1, ctr 0, wilson [0, 0.793], lift inconclusive`) |
| request-log rows (`POST /v1/decisions` 200 · 5.3ms · test) | Request-logs view — `/developers/logs` (`apps/web/src/lib/request-logs-view.ts`) + Analytics → Latency (`/analytics`) | not-wired state naming `GET /v1/request-logs` (the cursor-pagination view models are shipped and light up when the route lands) |
| analytics linkage (`ev-journey-impression-1` → decision) | Analytics — CTR-lift & Funnel — `/analytics` (`apps/web/src/lib/analytics-ctr-lift.ts`, `analytics-funnel.ts`) | the trail reads are pending (named above); this run captured the REAL rows + the REAL computation the views will render |
| webhook event `evt_…` + delivery `wd_…` (succeeded) | Events console — `/developers/events` (`apps/web/src/lib/events-view.ts`) | not-wired state naming `GET /v1/events` + the planned event catalog as roadmap (the replay affordance renders disabled naming `POST /v1/events/{id}/replay`); the wired webhook surfaces (`GET /v1/webhooks/events/{id}`, `GET /v1/webhooks/deliveries`) serve the same rows over the API today |

## 7. Evidence classes used in this document

Per `AGENTS.md` (every material statement tagged where useful):

| Claim | Class |
|---|---|
| The captured transcript (§4) — every hop, status, id and latency value | **observed** (real in-process run of the frozen surface, this window) |
| Route statuses (wired / not-wired) in §3 and §5 | **observed** (the driver attempted every route live; cross-checked against the frozen route registrations in `apps/api/src/routes/` + `server.ts`) |
| Dashboard-visibility mappings (§6) | **observed (code)** — read off the shipped view/lib sources named in the table |
| The harness composition caveat (§1) | **reproduced** (controlled-local: deterministic handler seams, recording webhook client, in-memory sink — the same evidence class the repo's own harnesses carry) |
| Driver behavior on re-run (§4 determinism note) | **observed** (multiple runs this window; random-id minting is by design) |

## 8. Lockstep test

`apps/api/test/e2e-journey-map.test.ts` (this work order's third artifact)
machine-checks this document against the repository: every route in the §3
journey map exists (or is honestly pending) on the real frozen surface, the
pending names match the shipped dashboard constants verbatim, and the
driver's asserted hop order is the documented order (key before decision,
decision before log row, event before delivery). Doc-drift fails the test.
