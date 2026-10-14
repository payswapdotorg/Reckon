# Ad-Lane Deployment Verification — AD-006

**Status:** DELIVERED WITH AD-006 (this document).

**Owner:** W3 (AD-006 — "Ad-lane E2E, privacy/rights proof, production evidence and
deployment verification", TL3+W3 per `docs/work-items/state.json`).

**Probed:** 2026-10-14, 06:29–06:34 UTC, from the AD-006 worker sandbox over the
public internet.

**Deployment facts (evidence class: documented)** — the production topology per
`docs/deployment/runbook.md` §8, `docs/deployment/environment.md` §5 and
`docs/handoff/final-release-evidence.md` §1–§3:

| Surface | Deployment | URL |
|---|---|---|
| API (`apps/api`) | Vercel Hobby, `reckon-api` project (rootDirectory `apps/api`, function `api/index.js` via `pnpm run bundle:vercel`, rewrites `/v1/*`, `/healthz`, `/readyz`) | https://reckon-api-phi.vercel.app |
| Web (`apps/web`) | Vercel, `reckon-web` project | https://reckon-web-nine.vercel.app |
| Docs (`apps/docs`) | Vercel, `reckon-docs` project | https://reckon-docs.vercel.app |
| Marketing (`apps/marketing`) | Vercel, `reckon-marketing` project | https://reckon-marketing.vercel.app |
| Database | Neon PostgreSQL free tier (`aws-us-east-1`), `sslmode=require` — the sole durable authority (migrations m001–m007) | (connection string is a platform secret) |
| Upstash / R2 / Apify | **Not deployed** (no consumer exists; PG remains the sole durable authority — unchanged from RELEASE-001 §4) | — |

## 1. What AD-006 was required to verify

Per the work order: verify that the PRODUCTION deployment actually serves the
ad-lane endpoints (`POST /v1/ads/query`, `POST /v1/ads/forget`, and the
ad-bearing decision path behind `POST /v1/decisions`), recording reachability +
smoke results as evidence-class `production-observed` **only where genuinely
observed** — `staging`/`controlled-local` otherwise — and NEVER fabricating
production evidence.

## 2. Probes attempted (exact commands, verbatim outputs)

All probes ran from the AD-006 worker sandbox (egress over the public
internet). HTTP status via curl `-w`; bodies verbatim.

### 2.1 API surface — `https://reckon-api-phi.vercel.app` (evidence class: production-observed)

**Probe 1 — liveness (the frozen `/healthz` envelope):**

```console
$ curl -sS -m 15 -w "\nHTTP_CODE=%{http_code}\n" https://reckon-api-phi.vercel.app/healthz
A server error has occurred

FUNCTION_INVOCATION_FAILED

hkg1::kfpmt-1791959489831-3e422ba99b85

HTTP_CODE=500
```

**Probe 2 — readiness (the per-handler wiring map):**

```console
$ curl -sS -m 15 -w "\nHTTP_CODE=%{http_code}\n" https://reckon-api-phi.vercel.app/readyz
A server error has occurred

FUNCTION_INVOCATION_FAILED

hkg1::vp8bs-1791959491234-4122f91d8415

HTTP_CODE=500
```

**Probe 3 — the ad-lane query route (unauthenticated; a healthy deployment
answers the typed 401 `UNAUTHENTICATED` envelope before any handler logic):**

```console
$ curl -sS -m 15 -X POST -H "content-type: application/json" \
    -d '{"schema":"reckon.ad-query-request","queryId":"ad006-deploy-probe","tenant":{"tenantId":"probe"},"subject":{"kind":"user","ref":"probe"},"mode":"both","at":1,"idempotencyKey":"ad006-deploy-probe-1"}' \
    -w "\nHTTP_CODE=%{http_code}\n" https://reckon-api-phi.vercel.app/v1/ads/query
A server error has occurred

FUNCTION_INVOCATION_FAILED

hkg1::pscc4-1791959505621-3ebb211d4440

HTTP_CODE=500
```

**Probe 4 — the ad-lane forget route (unauthenticated):**

```console
$ curl -sS -m 15 -X POST -H "content-type: application/json" \
    -d '{"schema":"reckon.ad-forget-request","requestId":"ad006-deploy-probe","tenant":{"tenantId":"probe"},"subject":{"kind":"user","ref":"probe"},"target":{"kind":"all"},"at":1,"idempotencyKey":"ad006-deploy-probe-2"}' \
    -w "\nHTTP_CODE=%{http_code}\n" https://reckon-api-phi.vercel.app/v1/ads/forget
A server error has occurred

FUNCTION_INVOCATION_FAILED

hkg1::t2598-1791959506442-60771e944738

HTTP_CODE=500
```

**Probe 5 — a frozen non-ad route (typed-401 probe from the S4-002 gate):**

```console
$ curl -sS -m 15 -w "\nHTTP_CODE=%{http_code}\n" https://reckon-api-phi.vercel.app/v1/decisions/ad006-deploy-probe
A server error has occurred

FUNCTION_INVOCATION_FAILED

hkg1::cbhpf-1791959506962-2256c19816f2

HTTP_CODE=500
```

**DNS resolution is healthy** (the failure is at the function-invocation
layer, not name resolution):

```console
$ getent hosts reckon-api-phi.vercel.app
216.198.79.3    reckon-api-phi.vercel.app
64.29.17.3      reckon-api-phi.vercel.app
```

The failure is PERSISTENT across the probe window (first observed 06:29:28Z,
re-confirmed 06:33:20Z — identical `FUNCTION_INVOCATION_FAILED` on every
route, including the no-auth frozen health surfaces). `FUNCTION_INVOCATION_FAILED`
is a Vercel platform-level error: the deployed function is not invoking at
all (no Reckon code path, health route, or auth boundary is reached).

### 2.2 The S4-002 deployment gate (evidence class: production-observed)

```console
$ RECKON_API_URL='https://reckon-api-phi.vercel.app' \
  RECKON_WEB_URL='https://reckon-web-nine.vercel.app' \
  RECKON_DOCS_URL='https://reckon-docs.vercel.app' \
  RECKON_MARKETING_URL='https://reckon-marketing.vercel.app' \
  node scripts/verify-deployment.mjs
reckon deployment verification gate (S4-002) — four surfaces, exit 0 only when all pass
api        RECKON_API_URL=https://reckon-api-phi.vercel.app
web        RECKON_WEB_URL=https://reckon-web-nine.vercel.app
docs       RECKON_DOCS_URL=https://reckon-docs.vercel.app
marketing  RECKON_MARKETING_URL=https://reckon-marketing.vercel.app

  FAIL api · GET /healthz (frozen liveness envelope) → HTTP 500 (expected 200)
  FAIL api · GET /v1/decisions/vd-gate-probe unauthenticated (frozen-route typed 401 envelope) → HTTP 500 (expected 401 — the typed unauthenticated envelope)
  PASS web · GET / → 200 + "Reckon Studio" → 200 · marker "Reckon Studio" present
  PASS docs · GET / → 200 + "Reckon documentation" → 200 · marker "Reckon documentation" present
  PASS marketing · GET / → 200 + "Recommendation infrastructure" → 200 · marker "Recommendation infrastructure" present

GATE: FAIL — 3/4 surfaces verified; failed: api
(exit code 1)
```

### 2.3 The S5-003 public-surface pass (evidence class: production-observed)

`node scripts/verify-production.mjs` (defaults = the four production URLs) →
**exit 1**. Summary line, verbatim:

```text
SUMMARY: 8/16 packet assertions green · 8 failed · 6 drift observations recorded (each with its evidence class)
GATE: FAIL — 8 assertion(s) failed against the LIVE domains (api-1, api-2, api-3, api-4, api-5, api-6, web-3, x-1); every failure is explained in the drift register with its evidence class — nothing was re-labeled to force a pass
```

Every `api-*` assertion failed with the same wire observation
(`body is not JSON: A server error has occurred / FUNCTION_INVOCATION_FAILED`,
labeled `[observed]`). The two NON-api failures are pre-existing drift
recorded by the same run, not AD-006 findings:

- `web-3`: the dashboard's docs link targets the branded domain
  `https://docs.reckon.dev`, which does not resolve (DNS) — the linked paths
  DO resolve 200 on the production docs deployment (`https://reckon-docs.vercel.app`).
- `x-1`: the marketing site's docs cross-links target the same unconfigured
  branded domain (paths resolve 200 on the production docs surface).

### 2.4 The other three surfaces (evidence class: production-observed)

```console
$ curl -sS -m 15 -o /dev/null -w "HTTP_CODE=%{http_code}\n" https://reckon-web-nine.vercel.app/
HTTP_CODE=200
$ curl -sS -m 15 -o /dev/null -w "HTTP_CODE=%{http_code}\n" https://reckon-docs.vercel.app/
HTTP_CODE=200
$ curl -sS -m 15 -o /dev/null -w "HTTP_CODE=%{http_code}\n" https://reckon-marketing.vercel.app/
HTTP_CODE=200
```

(With content markers — `Reckon Studio` / `Reckon documentation` /
`Recommendation infrastructure` — verified present by the §2.2 gate run.)

## 3. Verdict (honest)

**The production API deployment is NOT currently serving.** Every route on
`https://reckon-api-phi.vercel.app` — including the no-auth frozen health
surfaces — answers HTTP 500 `FUNCTION_INVOCATION_FAILED`, a Vercel
platform-level function-invocation failure. Therefore:

1. **No ad-lane production-serving claim is made by AD-006.** The ad-lane
   endpoints could not be exercised over the public wire; nothing in
   `docs/handoff/ad-lane-production-matrix.md` is tagged
   `production-observed` for serving behavior.
2. What WAS genuinely production-observed is recorded above: the API
   function-invocation failure itself (all probes, all routes, persistent
   across the window), and the healthy 200 + marker responses of the web,
   docs and marketing surfaces.
3. This is consistent with the deployment risk the active handoff already
   documents (`docs/handoff/TL6-FINAL-HANDOFF.md`, "Deployment and production
   truth"): *"The current CI/deployment environment has shown Vercel
   build-rate-limit failures on some latest production commits. A red
   deployment check must never be hidden by a green source-level test
   battery."* The S4-002 gate is red (exit 1, `api` failing) and is recorded
   here as such — the green AD-006 source-level battery (§5) does not and
   cannot override it.
4. Repair (a redeploy of the `reckon-api` Vercel project and/or resolving the
   platform-side invocation failure) is an operator/TL3 action outside this
   work item's owned paths — the AD-006 worker sandbox holds no Vercel or
   Neon credentials (checked: no `VERCEL_TOKEN`, no production
   `DATABASE_URL`, no `/run/secrets` — the only `DATABASE_URL` in the sandbox
   is an unrelated local file), and AGENTS.md forbids using public content as
   presumed permission for infrastructure access.

## 4. What WOULD constitute ad-lane production proof (the operator checklist)

Once the API function is serving again (run per
`docs/deployment/stripe-phase-release.md` / runbook §8):

1. `curl https://reckon-api-phi.vercel.app/healthz` → 200 `{ok:true,...}`;
2. `curl https://reckon-api-phi.vercel.app/readyz` → 200 and the wiring map
   shows the ads handler **wired** (the ad-retrieval runtime registered on
   `/v1/ads/*`);
3. Unauthenticated `POST /v1/ads/query` → the typed 401 `UNAUTHENTICATED`
   envelope (proves the frozen route + auth pipeline serve);
4. With an `ads`-scoped key: `reckon.ads.query` (modes remembered/available/
   both) + `reckon.ads.forget` round-trip over the public wire against the
   real Neon store, with outputs recorded in this file;
5. Re-run `node scripts/verify-deployment.mjs` (expect exit 0) and
   `node scripts/verify-production.mjs`, and record the transcripts;
6. Only then promote the corresponding matrix rows
   (`docs/handoff/ad-lane-production-matrix.md`) from `controlled-local` to
   `production-observed` — the promotion is a repository edit with the
   observed outputs attached, never an assumption.

## 5. Source-level battery backing this verification (evidence class: controlled-local)

The ad lane is proven end-to-end (both frozen paths, all eleven evidence
requirements, all ten privacy laws) by the AD-006 E2E suite over the
production composition (`buildProductionServer`) on a real PostgreSQL engine:

```console
$ pnpm test tests/e2e/ad-lane-e2e.test.ts   # 22/22 green (deterministic; fixed clocks; no network)
```

See `docs/handoff/ad-lane-e2e-evidence.md` for the full requirement/law →
artifact → command map. That battery is source truth, not production truth
(AGENTS.md "Production truth"): production acceptance of the ad lane remains
OPEN pending §4.
