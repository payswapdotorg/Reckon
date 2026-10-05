# Reckon — Final Release Evidence (Stripe Phase — S4-002)

> Produced 2026-10-05 per WORK ORDER S4-002, branch
> `work/s4-002-final-release` (base `0c55b0c`). Every claim below is
> either machine-verified in this release window or explicitly labeled
> with its evidence class. No aspirational prose.
>
> **PLACEHOLDER LAW (this release):** deployment URLs and deployment
> timestamps are NOT claimed by the preparer — the Lead deploys AFTER
> this merge. Every deploy-time fact below is an explicit
> `<!-- LEAD-FILL: … -->` placeholder **filled by the Lead at deploy
> time**. Never an invented URL. The deploy procedure is
> `docs/deployment/stripe-phase-release.md` (the S4-002 runbook).

## 1. Release identity

| Field | Value |
|---|---|
| Repository | `payswapdotorg/Reckon` (public); the Lead merges `work/s4-002-final-release` to `main` |
| Release artifacts commit | this file's commit (S4-002, base `0c55b0c`) — the runbook's deploy trigger; the deployed code is this commit after the Lead's merge (`docs/deployment/stripe-phase-release.md` §3) |
| Work items | 65/65 done (`docs/work-items/state.json`: status `stripe-phase-final-release-prepared-65-done`, `dispatchBaseSha: 0c55b0c`) — 52 pre-stripe items (RELEASE-001) + 13 stripe-phase items (S1-001..004, S2-001..004, S3-001..002, S4-001..002) |
| `implementationComplete` | **`false` in this commit — FLAG LAW.** The Lead flips it to `true` in the closing commit AFTER the four surfaces are verified deployed (the §7 gate). `scripts/verify-repo.mjs` enforces the release-phase contract at flip time: all items done + this evidence file present |
| Deployment URLs | api https://reckon-api-phi.vercel.app · web https://reckon-web-nine.vercel.app · docs https://reckon-docs.vercel.app · marketing https://reckon-marketing.vercel.app (filled by the Lead at deploy time) |
| The four surfaces | `apps/api` (frozen route surface, RELEASE-001 project), `apps/web` (dashboard shell + analytics views, RELEASE-001 project), `apps/docs` (docs portal, **first production deploy this release**), `apps/marketing` (marketing site, **first production deploy this release**) |

## 2. The four surfaces (deploy readiness + deployment)

| Surface | Vercel project | Root dir | Framework | Build command | Env vars | Production URL |
|---|---|---|---|---|---|---|
| `apps/api` | `reckon-api` (existing, RELEASE-001) | `apps/api` | Other | `pnpm run bundle:vercel` (via `apps/api/vercel.json`) | `DATABASE_URL` (hard) · `RECKON_API_KEYS` (soft) | https://reckon-api-phi.vercel.app |
| `apps/web` | `reckon-web` (existing, RELEASE-001) | `apps/web` | Next.js (webpack) | `pnpm run build` (chains the `@reckon/contracts` dist build) | `RECKON_API_BASE_URL` · `RECKON_DEMO_API_KEY` · `RECKON_ENV=production` · `RECKON_DOCS_BASE_URL` (optional) | https://reckon-web-nine.vercel.app |
| `apps/docs` | `reckon-docs` (**new project**) | `apps/docs` | Next.js (webpack) | `pnpm run build` (chains the `@reckon/contracts` dist build) | **none — zero-env surface** | https://reckon-docs.vercel.app |
| `apps/marketing` | `reckon-marketing` (**new project**) | `apps/marketing` | Next.js (webpack) | `pnpm run build` (`next build --webpack`) | **none — zero-env surface** | https://reckon-marketing.vercel.app |

Deploy-readiness verification (machine-verified this release window; the
full runbook is `docs/deployment/stripe-phase-release.md`):

| Surface | Verdict | Evidence (this window) |
|---|---|---|
| `apps/api` | **ready — shape unchanged by the stripe phase** | `git log -1 -- apps/api/vercel.json` → `949075c` (DEPLOY-001): no stripe-phase commit touched the rewrites (`/v1/*`, `/healthz`, `/readyz` → `/api/index`) or build command; `pnpm run bundle:vercel` re-run this window regenerates the self-contained esbuild ESM bundle of `src/vercel.ts` (exit 0, 2.2 MB, `pg-native` external under the `createRequire` shim) — evidence class: observed |
| `apps/web` | **ready — shape unchanged by the stripe phase** | `git log -1 -- apps/web/next.config.ts` → `292bfbb` (UI-001/002): no stripe-phase commit touched it; the build command still chains the contracts dist build; `next build --webpack` green in the §6 battery — observed |
| `apps/docs` | **ready — production config as shipped** | `next.config.ts` shipped in stripe-phase wave-1 (`72fd0b4`): webpack path + the workspace `resolveExtensionAlias` mapping; no `vercel.json` needed (no route rewrites — framework preset); zero env vars (the `process.env.RECKON_API_KEY` strings in `src/content/**` are code-sample text, never runtime consumption); `next build --webpack` green in the §6 battery; deployment README notes added this commit — observed |
| `apps/marketing` | **ready — production config as shipped** | `next.config.ts` shipped in wave-1 (`72fd0b4`): `reactStrictMode` only, zero runtime workspace deps; no `vercel.json` (no rewrites — `/`, `/pricing`, `/products/<id>` are plain routes); zero env vars; `next build --webpack` green in the §6 battery; deployment README notes added this commit — observed |

Notes (honest): the tracked `apps/api/api/index.js` is the zero-config
function-detection placeholder — the build command regenerates it at
deploy time, so the deployed function always reflects the release
commit's source (between-deploy staleness in the tree is by design).
Rollback is per-project (git-connected Vercel rollback; the database is
forward-only per `docs/deployment/migrations.md`; this release ships no
new migrations) — runbook §5.

## 3. Database + auxiliary providers (honest carry-forward)

| Field | Value |
|---|---|
| Provider | Neon Postgres free tier, `aws-us-east-1` — the RELEASE-001 production database (evidence class: **documented** — `final-release-evidence.md` @ RELEASE-001 §3, 2026-10-03; the URL/config is unchanged) |
| Migration state | `m001_events`, `m002_outbox`, `m003_api_state`, `m004_agents` — **the stripe phase added NO migrations** (machine-verified this window: `packages/persistence/src/migrations.ts` defines exactly these four). Production-wire confirmation: `pnpm migrate:status` over the production wire 2026-10-05T08:3xZ (Lead, release window): [applied] m001_events · [applied] m002_outbox · [applied] m003_api_state · [applied] m004_agents — zero pending, zero new (machine-observed this window) (filled by the Lead at deploy time) |
| Upstash / R2 / Apify | **Not deployed** (unchanged from RELEASE-001 §4 — no consumer exists; PG remains the sole durable authority) |
| Vercel | Deployed (RELEASE-001: `reckon-api`, `reckon-web`); two NEW projects this release (`reckon-docs`, `reckon-marketing`) — deployed by the Lead per the runbook |

## 4. Stripe-phase feature map (what this release ships)

The grammar implemented is the four-surface decomposition in
`docs/surveys/stripe-com-survey.md` §1 (marketing · docs · API+DX ·
dashboard); per-feature survey citations below. Every row's evidence was
re-verified by the §6 battery this window (evidence class: **observed**).

| Feature (survey grammar) | Work item(s) | Shipped surface | Machine evidence (this window) |
|---|---|---|---|
| API hardening: `sk_live_/sk_test_` + `pk_live_/pk_test_` key model, `Reckon-Version` negotiation, idempotency-key replay semantics, `?expand[]` responses, cursor pagination (`has_more`/`next_cursor`), typed error catalog with stable codes (survey §3 "API reference discipline") | S2-001 | `packages/contracts/src/api-platform.ts` (key schemas, error catalog, version registry); `apps/api/src/{auth,versioning,idempotency,expansion,pagination,rate-limit,errors}.ts` | battery: `apps/api/test/{keys,versioning,idempotency,expansion,pagination,errors-catalog,validation,route-matrix}.test.ts` all green |
| Test mode: test keys, canned scenarios (`itm_test_suggest`), `X-Reckon-Mode` on every authenticated response, mode-scoped idempotency, the separation law (test mode never executes live handler state) (survey §5 "test-mode-first DX") | S2-003 | `apps/api/src/test-mode.ts` + the mode-aware auth/route pipeline | battery: `apps/api/test/test-mode.test.ts`; journey transcript steps 2–3 (canned envelope + separation law asserted live) |
| Webhooks: endpoint CRUD, event catalog (`recommendation.delivered`, `model.drift.detected`, `schedule.executed`, `preference.updated`), HMAC signatures, **replay** (`POST /v1/webhooks/events/{eventId}/replay`), **deliveries log** (`GET /v1/webhooks/deliveries`) (survey §3 "Webhooks reference") | S2-002 | `apps/api/src/routes/webhooks.ts` + `apps/api/src/webhooks/*`; `packages/sdk/src/webhooks.ts` (`verifyWebhook` — the docs-named reference implementation) | battery: the seven `apps/api/test/webhook-*.test.ts` files (catalog, endpoints, emission, delivery, deliveries-pagination, replay, signature-docs); journey step 6 (endpoint + event + delivery row + shipped-algorithm signature verification) |
| Keys surface: hashed at rest (sha256), one-time display, publishable keys rejected as credentials, `mintKeyConfig` provisioning | S2-001 | `apps/api/src/auth.ts`; `generateSecretKey`/`generatePublishableKey` in `@reckon/contracts` | battery: `apps/api/test/keys.test.ts` + auth assertions across the api suite |
| Dashboard shell: nav IA (Home / Recommendations / Models / Data Sources / Analytics / Developers / Settings), API-keys manager, request logs, events console, **test/live toggle** (survey §1 "Dashboard") | S3-001 | `apps/web/src/lib/workspace.ts` + `apps/web/src/app/{developers,models,data-sources,settings,…}` + the view libs | battery: `apps/web/test/{workspace,api-keys-view,request-logs-view,events-view,mode-machine,developers-api}.test.ts` |
| Dashboard analytics views: CTR lift (Wilson intervals), latency percentiles (p50/p95/p99), drift indicators, funnels — with evidence-class badges and not-wired honesty naming the pending routes verbatim | S3-002 | `apps/web/src/lib/analytics-{ctr-lift,latency,drift,funnel}.ts` + `/analytics` views | battery: `apps/web/test/analytics-{ctr-lift,latency,drift,funnel}.test.ts`; journey step 5 proves the real `computeCtrLift` over the journey's own rows (`exposed {n:1, ctr 0, wilson [0, 0.793]}, lift inconclusive`) |
| Docs portal: "Serve your first recommendation" quickstart with integration-option tabs (hosted endpoint / SDK / streaming), core concepts, API reference (Authentication / Errors / Idempotency / Expand / Pagination / Versioning), webhooks guide with the **verify-webhook step**, SDK pages (survey §3 "Quickstart = the crown jewel") | S1-004 | `apps/docs` (`/get-started/quickstart`, `/api-reference/*`, `/webhooks`, `/sdks`) | battery: `apps/docs/test/docs-contract-fixtures.test.ts` (every example payload validated against the real zod schemas — docs cannot drift from the wire contracts) + `docs-ia.test.ts` |
| Marketing site: home (live-stat ticker, split-field gradient-mesh hero, outcome-phrased product grid, code-first artifact, quantified social proof, dual CTA), product pages, **pricing page** (per-1k-request tiers, interactive volume calculator, "everything included" comparison table, FAQ, enterprise track) (survey §2) | S1-001, S1-002, S1-003 | `apps/marketing` (`/`, `/products/<id>`, `/pricing`) | battery: `apps/marketing/test/{pricing-calculator,pricing-page,product-pages}.test.ts` |
| Reference SDKs — **BOTH**: TypeScript (`@reckon/sdk`: client, `verifyWebhook`, typed errors, testing harness) and Python (`sdks/python/reckon.py` reference client, `requests`-only, `verify_webhook` byte-for-byte the docs algorithm) (survey §5 S2-004) | S2-004 | `packages/sdk/src/{client,webhooks,errors,testing}.ts`; `sdks/python` (+ examples) | battery this window: `packages/sdk/test/{sdk-client,sdk-errors,sdk-hardening,sdk-webhooks}.test.ts`; `python-sdk.test.ts` **runs the python suite (24 + 17 test functions) against the REAL API over real HTTP** (python3+requests present — the only battery skip is the python-unavailable report test); `docs-lockstep.test.ts` runs the published docs snippets against the shipped SDKs |
| End-to-end journey proof: signup → API key → first recommendation → log entry → analytics entry → webhook event (the survey §1 end-to-end promise) | S4-001 | `scripts/e2e-journey.mjs` + `docs/handoff/e2e-journey-proof.md` | re-run this window: **6/6 hops asserted, exit 0** (the §6 battery); 8-test lockstep `apps/api/test/e2e-journey-map.test.ts` keeps doc/driver/surface in agreement |
| Final release preparation (this work item) | S4-002 | `docs/deployment/stripe-phase-release.md` (runbook) · `scripts/verify-deployment.mjs` (release gate) · `tests/deployment/verify-deployment.test.ts` (9-test lockstep) · this evidence refresh · `docs/work-items/state.json` (65/65) | the §6/§7 records below |

## 5. Not-wired register (the honest hops — verbatim)

Evidence class: **observed** — each row was attempted live in the S4-001
journey run and answered by the real API's typed 404 `NOT_FOUND`
envelope; the pending route is named verbatim in the shipped dashboard
library that awaits it. Reproduced verbatim from
`docs/handoff/e2e-journey-proof.md` §5 (re-confirmed by the journey
driver re-run this window — §6).

| Pending route | Named in (shipped constant) | Journey step | What the surface does instead (today) |
|---|---|---|---|
| `POST /v1/api-keys` | `apps/web/src/lib/developers-api.ts` → `PENDING_API_KEY_ROUTES.create` | 2 | Key provisioning is composition-time: the host mints key configs (`mintKeyConfig`, `apps/api/src/auth.ts`) and constructs the KeyStore with them (hashed at rest, one-time display). The first key issuance IS the signup hop. |
| `GET /v1/request-logs` | `apps/web/src/lib/developers-api.ts` → `PENDING_REQUEST_LOG_ROUTE` | 4 | The real per-call trail rows today: the test-store decision row (`GET /v1/decisions/{id}`) and the mode-scoped idempotency entry (replay proven: `Idempotent-Replayed: true`). A test-mode decision emits NO observability decision record (the canned path never executes the observability-wrapped live handler — the SEPARATION LAW). |
| `GET /v1/decisions` (list) | `apps/web/src/lib/analytics-ctr-lift.ts` → `PENDING_DECISION_LIST_ROUTE` | 5 | Decision rows are writable (`POST /v1/decisions`) and individually readable (`GET /v1/decisions/{id}`); the list read is pending. |
| `GET /v1/outcomes` (list) | `apps/web/src/lib/analytics-ctr-lift.ts` → `PENDING_OUTCOME_LIST_ROUTE` | 5 | Outcomes are append-only through the public API (`POST /v1/outcomes`); no list/read surface yet. The observability outcome-linkage record (captured in the journey run) is the analytics-linkage row the data layer holds today. |
| `GET /v1/preferences/events` (list) | `apps/web/src/lib/analytics-funnel.ts` → `PENDING_PREFERENCE_DELTA_LIST_ROUTE` | 5 | Preference deltas are append-only (`POST /v1/preferences/events`); the list read is pending. |
| `GET /v1/events` | `apps/web/src/lib/developers-api.ts` → `PENDING_EVENT_ROUTES.list` | 6 | The webhook system's own surfaces ARE wired (`GET /v1/webhooks/events/{id}`, `GET /v1/webhooks/deliveries` — both captured in the journey run); the dashboard-wide events aggregate is pending. |

Also honestly recorded (observed in the journey run): a test-mode
`impression` outcome does NOT emit a `recommendation.delivered` webhook —
the delivery-confirmation lookup resolves the LIVE decision store, which
by the mode-separation law holds no test decisions, and the emission
seam never invents anchors. The journey's webhook event is therefore the
`preference.updated` emission (fires for every appended delta in any
mode) plus the `webhook.endpoint.created` lifecycle event.

## 6. Test commands and results (this release window)

Commands (repository root, Node v24.21.0, 2026-10-05):

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm test && node scripts/verify-repo.mjs
node scripts/e2e-journey.mjs
node scripts/verify-deployment.mjs   # no env → the recorded usage run (§7)
```

Results (this release window, orchestration host):

```text
pnpm install   → up to date (exit 0)
pnpm build     → all packages + ALL FOUR APPS built (contracts dist, apps/api tsc,
                 apps/web + apps/docs + apps/marketing next build --webpack)   (BUILD_EXIT=0)
pnpm typecheck → root tsc --noEmit clean, 0 errors                             (TC_EXIT=0)
pnpm test      → Test Files 96 passed (96) · Tests 1682 passed | 1 skipped (1683) · 48.28s  (TEST_EXIT=0)
verify-repo    → PASS (required files 28 · work items 65 · flag false)         (CHECK_EXIT=0)
e2e-journey    → JOURNEY COMPLETE: 6/6 hops asserted · exit 0 (signup → api-key
                 → decision → request-log → analytics → webhook)               (JOURNEY_EXIT=0)
verify-deployment → env-missing usage line (exit 2) — recorded below in §7     (VD_EXIT=2)
```

Zero failures, zero flake-retries in this run. Delta over the S4-001
baseline (95 files / 1673 tests + 1 skip): +1 file, +9 tests —
`tests/deployment/verify-deployment.test.ts` (the release-gate
lockstep; §7). The 1 skip is the python-unavailable report test in
`packages/sdk/test/python-sdk.test.ts` (python3+requests ARE present —
the python suite itself RAN against the real API over HTTP this window).

## 7. Deployment verification gate (the release gate)

`scripts/verify-deployment.mjs` (Node stdlib only — this work item) is
the gate the Lead runs post-deploy with the four deployed URLs:

```bash
RECKON_API_URL='<api url>' RECKON_WEB_URL='<web url>' \
RECKON_DOCS_URL='<docs url>' RECKON_MARKETING_URL='<marketing url>' \
node scripts/verify-deployment.mjs
```

- Probes: api `GET /healthz` (200 `{ok:true, version, contractsVersion}`)
  + `GET /v1/decisions/{id}` unauthenticated (the typed 401
  `UNAUTHENTICATED` envelope on a frozen route); web `GET /` (200 +
  `Reckon Studio`); docs `GET /` (200 + `Reckon documentation`);
  marketing `GET /` (200 + `Recommendation infrastructure`).
- Exit 0 **only** when all four surfaces pass; per-surface failure lines;
  exit 2 on missing/malformed env.
- Recorded this window (no URLs exist yet — the deploy happens after
  this merge):

```text
$ node scripts/verify-deployment.mjs
env-missing: RECKON_API_URL, RECKON_WEB_URL, RECKON_DOCS_URL, RECKON_MARKETING_URL — all four surface URLs are required
usage: node scripts/verify-deployment.mjs …
(exit 2)
```

- Gate result (the Lead, at deploy time): <!-- LEAD-FILL: verify-deployment exit-0 transcript + deployment timestamp --> — the exit-0 transcript replaces the §1/§2 URL placeholders and is the release-window serving evidence.
- Lockstep: `tests/deployment/verify-deployment.test.ts` (9 tests, in
  the §6 battery) machine-checks the gate's markers against the shipped
  sources (`apps/web/src/components/shell/site-header.tsx`,
  `apps/docs/src/app/page.tsx`,
  `apps/marketing/src/lib/marketing-content.ts`), the arg contract, and
  the probe shape over stub servers — drift fails the battery, never the
  Lead's gate run.

## 8. Evidence classes (per AGENTS.md)

| Claim | Class |
|---|---|
| §6 battery numbers (build/typecheck/test/verify-repo/journey/gate-usage) | **observed** (re-runnable this window, commands in §9) |
| §2 deploy-readiness verdicts (all four apps build; api/web shapes unchanged — `git log` on the configs + bundle regeneration exit 0) | **observed** (this window) |
| §4 feature-map rows | **observed** (each row cites battery tests that ran green this window; the journey row is the driver's real in-process run) |
| Journey transcript details (§4/§5, from `e2e-journey-proof.md`) | **observed** (real in-process run of the frozen surface; composition caveat — deterministic handler seams, recording webhook client, in-memory sink — is **reproduced**, controlled-local, and stated in the proof doc §1) |
| Neon production DB state (§3) | **documented** (RELEASE-001 evidence, 2026-10-03) + **observed** code-side this window (migration set m001–m004 unchanged); production-wire confirmation **observed by the Lead this release window** (§3, all four applied) |
| The four surfaces' production serving state (URLs, timestamps, gate exit-0) | URLs claimed as of the Lead closing commit (production deploys triggered by that push); the exit-0 gate transcript is the §7 follow-up commit (PLACEHOLDER LAW) |
| Free-tier quota numbers | **assumption** (provider-published allowances, `docs/deployment/free-tier-guardrails.md`) |
| Marketing pricing/ticker figures | illustrative by design — labeled as such in the shipped content (`apps/marketing` README + content modules) |
| Consumer-adapter capability claims | **controlled-local (fixtures)** — conformance-tested fixture integrations, no live provider connection claimed (unchanged from RELEASE-001 §5) |

## 9. Re-run commands

```bash
cd ~/reckon && git checkout work/s4-002-final-release   # or the release commit on main after the Lead's merge
pnpm install
pnpm build && pnpm typecheck && pnpm test && node scripts/verify-repo.mjs
node scripts/e2e-journey.mjs                             # 6/6 hops, exit 0
node scripts/verify-deployment.mjs                       # no env → usage + exit 2 (recorded above)

# The Lead's post-deploy release gate (four deployed URLs — runbook §4):
RECKON_API_URL='…' RECKON_WEB_URL='…' RECKON_DOCS_URL='…' RECKON_MARKETING_URL='…' \
  node scripts/verify-deployment.mjs                     # exit 0 = the release gate passes
```

Node ≥ 22.18 required for the journey driver (type stripping) — verified
on v24.21.0 this window.

## 10. Known limitations (honest register)

1. **Six pending routes** (§5) — the API-keys provisioning route, the
   request-logs list, the three analytics trail reads and the events
   aggregate. The dashboard renders each as an explicit not-wired state
   naming the pending route verbatim (Gate Q — real state, never
   fabricated data); they are the next phase's read/provisioning
   surface, not hidden gaps.
2. **No live consumer-provider connections** — adapters remain
   conformance fixtures (RELEASE-001 §5).
3. **No LLM/model provider in the loop** — by design (architecture law;
   the fast path is deterministic).
4. **Observability is append-only PG + structured logs** — no metrics
   scraping/alerting (runbook NOT-YET register).
5. **Pricing figures are illustrative** — billing does not exist; the
   pricing page labels them as such. The ticker stat is a typed constant
   labeled "Network stat" until network telemetry lands.
6. **Free-tier posture** — single region (`iad1`); Neon autosuspend
   (slow first connection after idle); four Vercel Hobby projects share
   the account-level envelope (quota numbers are assumption class).
7. **Demo dataset is fixture-class** — explicitly Demo-labeled
   everywhere (RELEASE-001 posture, unchanged).
8. **The tracked `apps/api/api/index.js`** is the function-detection
   placeholder regenerated by the build command at deploy time (§2 note)
   — its in-tree state between deploys is deliberately stale, never the
   deployed artifact.
