# Reckon — End-to-End Journey Proof (S4-001)

> Produced 2026-10-05 per WORK ORDER S4-001, branch `work/s4-001-journey`
> (base `ff4f9bb`). Every claim below is either machine-observed in this
> release window from a REAL run of the frozen surface or explicitly labeled
> with its evidence class. No aspirational prose (the
> `final-release-evidence.md` law).
>
> S5-003 addendum (2026-10-05/06): §9–§12 add the production
> public-surface verification pass, the production journey gap analysis +
> runbook, the S5-003 evidence classes, and the extended lockstep. Every
> S4-001 section above is unchanged.

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

## 9. Production verification (S5-003)

> Produced 2026-10-05 (21:45 UTC window) per WORK ORDER S5-003, branch
> `work/s5-003-journey-verify` (base `3748816`, the work head of this
> section). The four surfaces are LIVE:
> api `https://reckon-api-phi.vercel.app` ·
> web `https://reckon-web-nine.vercel.app` ·
> docs `https://reckon-docs.vercel.app` ·
> marketing `https://reckon-marketing.vercel.app`. No production key material
> existed in this window (the Lead controls `RECKON_API_KEYS` on Vercel),
> so every authenticated hop is either `documented` or honestly absent —
> never faked (Gate Q law).

### 9.0 Journey parity rerun (local, the drift guard)

The full 6-hop journey was re-run exactly as §2 documents, on this branch's
head, BEFORE and AFTER the S5-003 driver changes (the parameterization must
not change the S4-001 path):

```text
node scripts/e2e-journey.mjs        # 6/6 hops asserted · exit 0 (head 3748816, pre-change)
node scripts/e2e-journey.mjs        # 6/6 hops asserted · exit 0 (head 43638af, post-change)
```

Node v24.21.0, `pnpm install && pnpm build` first (the driver loads
`@reckon/contracts` from its built dist). Evidence class: **observed** —
6/6 hops at both heads; the canned decision id for the canonical request is
stable (`dec-test-add3fafbe3fe36454935fb2a`), matching the S4-001 §4
determinism note. **No drift since `0c55b0c` on the local surface.** The
drift that DOES exist is production-side — §9.3.

### 9.1 The public-surface pass (what ran)

`scripts/verify-production.mjs` (new in this work order; Node stdlib only,
`--json` machine capture) probes the four LIVE deployments over the public
wire with NO key material. 15 packet assertions — exactly the WORK ORDER
S5-003 task packet — plus an honest drift register whose entries never fail
the gate and whose absence never silently passes one:

```bash
node scripts/verify-production.mjs     # exit 1 — 13/15 green (see below)
node scripts/verify-production.mjs --json   # machine capture
```

Results (run of 2026-10-05 21:45 UTC, evidence class per row):

| # | Surface | Assertion | Result | Evidence class |
|---|---|---|---|---|
| api-1 | api | `GET /healthz` → 200 `{ok:true, version:"0.1.0", contractsVersion:"0.1.0"}` (the frozen liveness envelope) | **PASS** | observed |
| api-2 | api | `GET /readyz` → 200 + `handlers{…}` map, every value `wired`\|`not-wired` (12 handler ports reported, all `wired`) | **PASS** | observed |
| api-3 | api | `GET /v1/decisions/{id}` with NO key → typed 401, `error.code="UNAUTHENTICATED"` (the error-catalog code) | **PASS** | observed |
| api-4 | api | same route with an INVALID key shape (`pk_live_…`, schema-valid publishable shape — a shape probe, never real material) → typed 401 `UNAUTHENTICATED` | **PASS** | observed |
| api-5 | api | same route with a garbage key → typed 401 `UNAUTHENTICATED` | **PASS** | observed |
| api-6 | api | same route with unsupported `X-Reckon-Version: 2099-99-99` and no key → typed 401 `UNAUTHENTICATED` — the documented auth order (authenticate precedes version negotiation, `apps/api/src/routes/shared.ts`) | **PASS** | observed |
| web-1 | web | `GET /` → 200 + dashboard shell markup ("Reckon Studio" wordmark) | **PASS** | observed |
| web-2 | web | `GET /` → the dashboard nav IA labels (Home / Recommendations / Models / Data Sources / Analytics / Developers / Settings — `apps/web/src/lib/workspace.ts` `navLabel` values) | **FAIL** — all seven labels absent from the served HTML | observed (wire) + machine-verified (frozen surface renders them) |
| web-3 | web | the dashboard's docs link → resolves (only if rendered unauthenticated) | **not rendered** — recorded as drift, not counted (§9.2 row W3) | observed |
| docs-1 | docs | `GET /` → 200 + "Reckon Docs" identity (title + "Reckon documentation" eyebrow) | **PASS** | observed |
| docs-2 | docs | `GET /get-started/quickstart` → 200 + the three integration-option tabs (Hosted endpoint / TypeScript SDK / Streaming) | **PASS** | observed |
| docs-3 | docs | `GET /api-reference/authentication` → 200 | **PASS** | observed |
| mkt-1 | marketing | `GET /` → 200 + brand identity ("Recommendation infrastructure") + nav (Product / Docs / Pricing) | **PASS** | observed |
| mkt-2 | marketing | `GET /pricing` → 200 + the volume-calculator markup (`section#calculator` + "Your rate, at your volume.") | **PASS** | observed |
| mkt-3 | marketing | `GET /products/recommendation-api` (a product page) → 200 | **PASS** | observed |
| x-1 | cross | marketing → docs cross-links point at the production docs domain AND resolve 200 | **FAIL** — 4 distinct docs hrefs, all on `docs.reckon.dev`, none resolvable (DNS-dead) | observed |

**13/15 packet assertions green, exit 1 — honestly.** The two failures are
real production gaps (§9.2/§9.3), not assertion bugs: the same script's
web/docs/marketing assertions pass, proving the probe machinery works; the
failing assertions fail because the live deployments do not serve what the
frozen surface ships.

The version-negotiation 400 (`VALIDATION_ERROR`, `param: "X-Reckon-Version"`)
for an unsupported version is **documented** on production (it requires an
authenticated request — auth precedes version resolution on every `/v1`
route) and **machine-verified** against the frozen surface in
`apps/api/test/e2e-journey-map.test.ts` (§12 of this document's lockstep:
the same unsupported header WITH a valid test key answers
`400 VALIDATION_ERROR` naming the header as `param`).

### 9.2 The drift register (11 observations, each with its evidence class)

| Row | Surface | Observation | Evidence class |
|---|---|---|---|
| A1 | api | `/readyz` handlers map carries no `webhookHandler` entry — the production composition registers no webhook system; on a current-surface deployment the `/v1/webhooks` family answers typed 501 `NOT_WIRED` | observed (wire) + machine-verified (`apps/api/src/composition.ts` `buildProductionServer` mounts no `config.webhooks`) |
| A2 | api | the typed 401 envelope on the wire carries `{code, message}` only — the S2-001 catalog fields (`class`, `param`, `doc_url`) are absent | observed (wire) + machine-verified (the frozen surface's `errorEnvelope` emits `class` + `doc_url` — asserted in the lockstep test) |
| A3 | api | a `pk_live_`-shaped key is rejected through the generic unknown-key path ("Unknown or invalid API key"), not the dedicated publishable-key rejection message | observed (wire) + machine-verified (`apps/api/src/auth.ts` rejects pk_ keys with the dedicated message on the frozen surface — asserted in the lockstep test) |
| A4 | api | `GET /v1/webhooks/endpoints` unauthenticated answers **404 Route-not-found** — the deployed function does not register the S2-002 webhook route family at all | observed (wire) + machine-verified (the frozen surface registers the family — asserted in the lockstep test) |
| W1 | web | the deployed dashboard home does not render the S3-001 nav IA; it serves the pre-stripe-phase shell (title "Overview", the DEPLOY-002-era route set `/decisions` `/plans` `/scheduler` `/agents` `/research` `/integrations`) | observed (wire) + machine-verified (`apps/web/src/lib/workspace.ts` `WORKSPACE_ROUTES` ships the seven-label IA) |
| W3 | web | the deployed dashboard home renders no docs link — the pre-stripe-phase shell predates the S1-004 onboarding card (current source renders a quickstart link to `RECKON_DOCS_BASE_URL`, default `https://docs.reckon.dev`) | observed |
| C1 | cross | marketing docs cross-links target the branded domain `docs.reckon.dev` (nav + product-docs-links), which **does not resolve** (DNS failure) — not the production docs deployment `reckon-docs.vercel.app` | observed (wire) + documented (`apps/marketing/src/lib/marketing-content.ts` pins `https://docs.reckon.dev/`) |
| C2 | cross | the four linked paths (`/`, `/api-reference/authentication`, `/get-started/quickstart`, `/webhooks`) all return **200 on the production docs domain** `reckon-docs.vercel.app` — the paths are right, only the domain is unconfigured | observed |

### 9.3 The headline finding — two of the four live surfaces run pre-stripe-phase code

The wire discriminators (A2, A3, A4 for the API; W1 for the web dashboard)
each independently place the deployed `reckon-api-phi` function and the
deployed `reckon-web-nine` dashboard **before stripe-phase wave-1/wave-2**
(i.e. at the DEPLOY-001/002-era builds of 2026-10-03):

- A2: pre-wave-1 error envelope (`{code,message}` — wave-1 `72fd0b4` added
  `class`/`doc_url`/`param` via the S2-001 catalog);
- A3: pre-wave-1 auth path (the publishable-key discriminator is S2-001);
- A4: pre-wave-2 route surface (the webhook family is S2-002 `efdb03d`);
- W1: pre-wave-2 dashboard shell (the S3-001 IA is wave-2).

Meanwhile docs and marketing ARE current (RELEASE-002 deploys — all six of
their assertions green). The Lead's RELEASE-002 closing note
(`apps/api/README.md`, commit `10889ba`: "this release redeploys
`reckon-api` unchanged-in-code since the wave-2 merge … the bundle
regenerated and verified this window") expected wave-2 code live — **the
wire contradicts it**: the RELEASE-002 API redeploy evidently did not take
effect on the function serving traffic (the note itself exists only to
nudge Vercel's rootDirectory change-detection). Evidence classes: the four
discriminators are observed (wire, this window); the redeploy expectation
is documented (`apps/api/README.md`); the frozen-surface behaviors they
diverge from are machine-verified (lockstep test, §12).

**Consequence for this work order:** the production journey cannot run at
parity today even WITH Lead key material — hop 3's canned test engine
(S2-003) is absent on the deployed function, and hop 6's webhook family is
not registered there (§10). A redeploy of current `main` is the
prerequisite; the runbook below is written against the current surface.

### 9.4 Cross-surface link gap

All four production domains answer (api via `/healthz`, web/docs/marketing
via `/` — 200 each, observed). The only cross-surface break is C1/C2: the
branded docs domain is unconfigured, so every marketing → docs link (and a
would-be dashboard link, W3) dead-ends at DNS while the same paths serve
200 on `reckon-docs.vercel.app`. Fix options (Lead's call, NOT made in this
work order — no marketing source was touched): configure `docs.reckon.dev`
to point at the docs deployment, or repoint the shipped link constants at
the vercel.app domain.

## 10. Production journey gap analysis + runbook (documented)

Evidence class for this whole section: **documented** unless a row says
otherwise. Nothing here was faked; no authenticated production hop was
simulated.

### 10.1 What a production run needs (env, who mints, which key shape)

| Need | Value | Owner |
|---|---|---|
| Key material on the deployment | `RECKON_API_KEYS` env on the Vercel `reckon-api` project — one entry per `;`/newline, format `apiKey:tenantId:scope1,scope2` (e.g. `sk_test_<42 base62>:journey-prod-tenant:decisions,outcomes,webhooks`) | **the Lead** (production secrets are Lead-only; a worker session never holds them) |
| Journey key shape | **`sk_test_…` (test mode)** — the parity decision uses the quickstart's magic `itm_test_suggest` item; a live key would (correctly) be rejected by the S2-003 live-mode test-hint guard. `mintKeyConfig("secret","test",…)` or any generator of `sk_test_` + ≥24 base62 chars produces the shape | the Lead mints |
| Key material in the runner | `RECKON_JOURNEY_API_KEY` + `RECKON_JOURNEY_TENANT_ID` env (never argv on a production run — the driver refuses `--api-key` with `--production`) | the Lead's shell/CI |
| Invocation | `node scripts/e2e-journey.mjs --production` (pinned to the production api/web bases) — or the explicit form `--api-base https://reckon-api-phi.vercel.app --tenant-id <id>` | any Lead-run shell |
| Prerequisite | **redeploy `reckon-api` from current `main`** (§9.3: the live function predates wave-2 — hop 3 would fail against it today) | the Lead |

### 10.2 Hop-by-hop production gap table

| Hop | Local (S4-001/S5-003 §9.0) | Production (current-surface deployment) | Gap class |
|---|---|---|---|
| 1 signup | `mintKeyConfig` composition mint (the driver IS the host) | the Lead pre-provisions via `RECKON_API_KEYS`; the driver receives the key + tenant and asserts them over the wire | **documented** (key material is Lead-only; the remote driver refuses to run without it — never fakes provisioning) |
| 2 api-key | `POST /v1/api-keys` → typed 404 (pending route) | identical typed 404 on a current surface (the route is pending everywhere) | none — parity |
| 3 decision | canned test engine answers `itm_test_suggest` | identical on a current-surface deployment; **absent on the function deployed today** (pre-S2-003) | **observed drift blocker** (§9.3) — redeploy first |
| 4 request-log | `GET /v1/request-logs` → typed 404 + idempotency replay row | identical over the wire (`Idempotent-Replayed: true` is wire-visible) | none — parity |
| 5 analytics | outcome row + observability linkage + S3-002 computation | outcome row is wire-visible; the linkage record and `computeCtrLift` are composition/client-side — honestly NOT asserted over the wire | partial (named, never faked) |
| 6 webhook | REAL in-memory webhook system through `config.webhooks` | **the production composition mounts no webhook system** (`buildProductionServer` passes no `config.webhooks`; `/readyz` on production carries no `webhookHandler`) — the route family answers typed 501 `NOT_WIRED` on a current surface (404 on today's older function) | **structural gap — machine-verified** from `apps/api/src/composition.ts`; completing hop 6 in production needs a webhook-system production mount (a work item, not a driver change) |

### 10.3 The remote driver mode and its honest verification status

`scripts/e2e-journey.mjs` is parameterized for multi-target runs (S5-003;
the no-flag invocation is byte-identical to S4-001 — §9.0):

```bash
node scripts/e2e-journey.mjs                                        # local in-process (S4-001, unchanged)
node scripts/e2e-journey.mjs --api-base <url> --tenant-id <id> \
  [--web-base <url>] [--api-key <sk_ key>]                          # remote over the wire
RECKON_JOURNEY_API_KEY=sk_test_… RECKON_JOURNEY_TENANT_ID=… \
  node scripts/e2e-journey.mjs --production                         # the Lead-run form
```

The remote mode drives the SAME six hops over real HTTP (global fetch; no
new dependencies) with per-run idempotency salts so repeated Lead runs stay
clean. Composition-internal assertions (the separation-law counter, the
observability sink records, the recorded outbound webhook client, the local
S3-002 computation) are NOT wire-observable: the remote journey asserts
their wire-visible equivalents and names the rest — never fakes them. The
webhook hop accepts the three honest deployment states and records which it
observed: 200 (full parity — endpoint + event + delivery log; signature
verification honestly skipped: it needs the delivered bytes at a receiver
the driver controls), typed 501 `NOT_WIRED` (the production-composition
structural gap, §10.2 hop 6), or typed 404 (a surface predating S2-002 —
the drift of §9.3, which fails the hop by design).

**Verification status (labeled on every run):** this remote code path is
**untested-in-prod** — no production key material existed in the S5-003
window. It WAS verified over a real loopback wire (real socket + real
fetch, real fastify route pipeline) against the frozen surface in BOTH
relevant compositions: with the webhook system mounted — 6/6 hops, exit 0,
`webhook hop: full-parity` (delivery row honestly `pending`/
`responseCode:null` for the deliberately unreachable endpoint URL) — and
with the production-shaped composition (no `config.webhooks`) — 6/6 hops,
exit 0, `webhook hop: production-composition-structural-gap` (typed 501
`NOT_WIRED` recorded). Evidence class for both: **observed
(controlled-local wire)**. The Lead's first `--production` run upgrades the
class to observed (production wire).

### 10.4 Re-run commands (S5-003 battery)

```bash
cd ~/reckon && git checkout work/s5-003-journey-verify
pnpm install && pnpm build
node scripts/e2e-journey.mjs                       # 6/6 hops · exit 0 (§9.0)
node scripts/verify-production.mjs                 # 13/15 green · exit 1 (§9.1 — the 2 failures are the production gaps)
cd apps/api && pnpm vitest run e2e-journey-map     # lockstep suite green (§12)
cd apps/api && pnpm run typecheck                  # exit 0
```

## 11. Evidence classes used in the S5-003 sections

| Claim | Class |
|---|---|
| §9.0 local parity reruns (6/6 at both heads) | **observed** (real in-process runs, this window) |
| §9.1 per-assertion results (13/15) | **observed** (real wire runs against the four LIVE domains, 2026-10-05 21:45 UTC window) |
| The auth-order law behind api-6 (401 precedes version negotiation) | **documented** (`apps/api/src/routes/shared.ts` order comment) + **machine-verified** (lockstep test asserts the 400 with a valid key) |
| The 400 `VALIDATION_ERROR` rejection for unsupported `X-Reckon-Version` | **documented** (production, unauthenticated requests cannot reach it) + **machine-verified** (frozen surface, lockstep test) |
| §9.2 drift register rows A1–A4, W1, C1, C2 | **observed** (wire) + **machine-verified** (the frozen-surface behaviors they diverge from are asserted in the lockstep test) where the row says so |
| §9.3 the deployed api+web surfaces predate stripe-phase | **observed** (the four wire discriminators) + **documented** (the RELEASE-002 redeploy note) + **machine-verified** (the frozen-surface side of each discriminator) |
| §10 the production runbook (env names, key shape, minter) | **documented** (`apps/api/src/config.ts` `parseApiKeyList`, `apps/api/src/auth.ts` key grammar, `apps/api/src/vercel.ts` boot) |
| §10.2 hop-6 structural gap (no webhook system in the production composition) | **machine-verified** (`apps/api/src/composition.ts` mounts no `config.webhooks`; asserted in the lockstep test) + **observed** (production `/readyz` carries no `webhookHandler` entry) |
| §10.3 the remote driver path | **observed (controlled-local wire)** for the two loopback compositions; **untested-in-prod** until the Lead's first `--production` run |

## 12. Lockstep test (S5-003 extension)

`apps/api/test/e2e-journey-map.test.ts` (extended in this work order, same
file so the `pnpm vitest run e2e-journey-map` filter covers it) now also
machine-checks the S5-003 additions against the repository:

- the driver's target-flag contract (`--api-base`, `--web-base`,
  `--tenant-id`, `--api-key`, `--production`, the env names) and that the
  no-flag path is the unchanged S4-001 journey (the six STEP sections,
  once each, in order — the pre-existing assertion);
- the remote journey's honest three-state webhook-hop handling exists in
  the driver source (full-parity / 501 structural-gap / 404 pre-S2-002);
- `scripts/verify-production.mjs` exists and its probe markers match the
  SHIPPED SOURCES verbatim: the web nav IA labels are exactly the
  `WORKSPACE_ROUTES` `navLabel` values, the docs identity/tab markers are
  exactly the shipped constants, the marketing brand/calculator markers
  are exactly the shipped copy, and the production URL defaults are the
  four LIVE domains named in this section;
- the frozen-surface behaviors the production drift register diverges
  from, asserted for real on `buildServer` in-process: the typed 401
  envelope carries `class: "authentication_error"` (the S2-001 catalog
  shape the deployed surface lacks), the `pk_live_` probe gets the
  dedicated publishable-key rejection, the webhook route family IS
  registered (`app.hasRoute`), and an unsupported `X-Reckon-Version` with
  a VALID key answers `400 VALIDATION_ERROR` with `param: "X-Reckon-Version"`;
- this document's §9/§10 structure exists (the production verification
  table, the drift register, the runbook) — doc-drift fails the test.
