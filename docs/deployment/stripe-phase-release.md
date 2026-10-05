# Stripe-Phase Release Runbook (S4-002)

**Status:** S4-002 — final release preparation (this document is the exact
four-project Vercel setup the Lead executes after merging
`work/s4-002-final-release` to `main`).
**Laws:** the PLACEHOLDER LAW — deployment URLs and deployment timestamps
are NOT claimed in this document; every deploy-time fact is an explicit
`<!-- LEAD-FILL: … -->` placeholder **filled by the Lead at deploy time**.
No aspirational prose (the `final-release-evidence.md` law). Existing
RELEASE-001 deployment facts are cited with their evidence class
(documented, `runbook.md` §8).

## 1. The four projects at a glance

| Project | Root directory | Framework preset | Build command | Env vars | Status |
|---|---|---|---|---|---|
| `reckon-api` | `apps/api` | Other | `pnpm run bundle:vercel` (via `apps/api/vercel.json`) | `DATABASE_URL` (hard) · `RECKON_API_KEYS` (soft) | existing (RELEASE-001); shape unchanged by the stripe phase |
| `reckon-web` | `apps/web` | Next.js | `pnpm run build` | `RECKON_API_BASE_URL` · `RECKON_DEMO_API_KEY` · `RECKON_ENV=production` · `RECKON_DOCS_BASE_URL` (optional) | existing (RELEASE-001); shape unchanged by the stripe phase |
| `reckon-docs` | `apps/docs` | Next.js | `pnpm run build` | **NONE (zero-env)** | **NEW project** (first production deploy) |
| `reckon-marketing` | `apps/marketing` | Next.js | `pnpm run build` | **NONE (zero-env)** | **NEW project** (first production deploy) |

All four are git-connected to this monorepo on one Vercel account, region
`iad1` (US East — co-located with the Neon production database,
`aws-us-east-1`), Node 22.x. Per-app deploy facts also live in each app's
README (`apps/docs/README.md` §Deployment, `apps/marketing/README.md`
§Deployment).

## 2. Per-project setup

### 2.1 `reckon-api` — `apps/api` (EXISTING project; frozen route surface)

The deployment shape is **unchanged by the stripe phase** (verified this
release window: `apps/api/vercel.json` is byte-identical to the
DEPLOY-001 configuration — `git log` shows no stripe-phase commit touched
it — and `pnpm run bundle:vercel` regenerates the self-contained esbuild
ESM bundle `api/index.js` of `src/vercel.ts` with exit 0).

| Field | Value |
|---|---|
| Project name | `reckon-api` (the existing RELEASE-001 project — evidence class: documented, `runbook.md` §8) |
| Root directory | `apps/api` |
| Framework | Other |
| Build command | `pnpm run bundle:vercel` (set by `apps/api/vercel.json`; chains the `@reckon/contracts` dist build + `scripts/bundle-vercel.mjs`) |
| Function | `api/index.js` — self-contained esbuild ESM bundle of `src/vercel.ts` (`pg-native` external under the `createRequire` shim — runtime-caught miss, pure-JS driver). The TRACKED `apps/api/api/index.js` is the zero-config detection placeholder; the build command regenerates it at deploy time, so the deployed function always reflects the release commit's source. |
| Rewrites | `apps/api/vercel.json`: `/v1/*`, `/healthz`, `/readyz` → `/api/index` (Vercel preserves the original request URL — the frozen route contracts route exactly as in self-hosted mode) |
| Region / runtime | `iad1`, Node 22.x |
| Production URL | <!-- LEAD-FILL: reckon-api stripe-phase production URL (fill at deploy time; the RELEASE-001 URL is recorded in runbook.md §8) --> |

**Env vars (secrets injected via the Vercel env store, never the repo):**

- `DATABASE_URL` (**hard** — the function refuses to boot without it; the
  Neon production connection string, `sslmode=require`). Unchanged from
  RELEASE-001; **no new migrations ship in this release** (the stripe
  phase added none — the applied set remains `m001_events`, `m002_outbox`,
  `m003_api_state`, `m004_agents`; confirm with `pnpm migrate:status`).
- `RECKON_API_KEYS` (**soft** — empty ⇒ every authenticated route returns
  the typed 401 envelope; the API still boots and `healthz`/`readyz` stay
  open, the honest degraded mode). Key material shape (S2-001 key model):
  entries of `sk_live_<token>:<tenantId>:<scope1,scope2>`, `;`- or
  newline-separated. `<token>` is ≥24 base62 chars; valid scopes are
  exactly `decisions, outcomes, plans, catalog, research, agents,
  integrations, webhooks`; keys are sha256-hashed at rest by the KeyStore
  and the raw key is displayed exactly once at minting. Publishable
  (`pk_…`) keys are identification-only and are rejected as credentials.
  Legacy opaque keys (RELEASE-001's `demoKey:demo:…` class) remain
  accepted as live-mode secret keys during the documented transition.

Minting a fresh secret key for the release env (repo root, after
`pnpm build`; output shown once, then stored in the Vercel env store):

```bash
node --input-type=module -e "
  const { generateSecretKey } = await import('./packages/contracts/dist/index.js');
  console.log(generateSecretKey('live'));
"
# → sk_live_<48 base62 chars> — use as: RECKON_API_KEYS='sk_live_<token>:<tenantId>:decisions,outcomes,plans,catalog,research,agents,integrations,webhooks'
```

### 2.2 `reckon-web` — `apps/web` (EXISTING project; dashboard shell + analytics views)

The deployment shape is **unchanged by the stripe phase** (verified this
release window: `apps/web/next.config.ts` is untouched since UI-001 — no
stripe-phase commit modified it; the build command still chains the
`@reckon/contracts` dist build; the app builds green in the release
battery).

| Field | Value |
|---|---|
| Project name | `reckon-web` (the existing RELEASE-001 project — evidence class: documented, `runbook.md` §8) |
| Root directory | `apps/web` |
| Framework | Next.js (16.3.8, webpack path) |
| Build command | `pnpm run build` (the package build script chains `pnpm --filter @reckon/contracts build && next build --webpack`) |
| Region / runtime | `iad1`, Node 22.x |
| Production URL | <!-- LEAD-FILL: reckon-web stripe-phase production URL (fill at deploy time; the RELEASE-001 URL is recorded in runbook.md §8) --> |

**Env vars:**

- `RECKON_API_BASE_URL` — the API project's production URL (server-side
  only; consumed by `apps/web/src/lib/reckon-client.ts`).
- `RECKON_DEMO_API_KEY` — the demo tenant's secret key (server-only
  secret; the key material shape is §2.1's).
- `RECKON_ENV=production` — the honest environment label for the ENV
  badge.
- `RECKON_DOCS_BASE_URL` — **optional, new in S3-001**: where the
  dashboard's quickstart/onboarding links point. Defaults to
  `https://docs.reckon.dev` when unset; set it to the `reckon-docs`
  production URL (below) once that URL exists.

### 2.3 `reckon-docs` — `apps/docs` (NEW project; first production deploy)

| Field | Value |
|---|---|
| Project name | `reckon-docs` (new Vercel project, git-connected to this monorepo) |
| Root directory | `apps/docs` |
| Framework | Next.js (16.3.8, webpack path — the workspace-pinned Next family) |
| Build command | `pnpm run build` (the package build script chains `pnpm --filter @reckon/contracts build && next build --webpack` — the contracts dist must exist before `next build` typechecks the `import type` fixtures) |
| Env vars | **NONE — zero-env surface.** Every page is static; the `process.env.RECKON_API_KEY` strings inside `src/content/**` are documentation code samples (text), never runtime consumption. Do not configure any variable. |
| `vercel.json` | None, deliberately — no route rewrites exist on this surface; the framework preset serves the App Router routes as built (standard build output, no `standalone`). |
| Region / runtime | `iad1`, Node 22.x |
| Production URL | <!-- LEAD-FILL: reckon-docs production URL --> |

### 2.4 `reckon-marketing` — `apps/marketing` (NEW project; first production deploy)

| Field | Value |
|---|---|
| Project name | `reckon-marketing` (new Vercel project, git-connected to this monorepo) |
| Root directory | `apps/marketing` |
| Framework | Next.js (16.3.8, webpack path — pinned to `apps/web`'s exact versions) |
| Build command | `pnpm run build` (the package build script: `next build --webpack`; no workspace-package build is chained — this app has zero runtime workspace dependencies) |
| Env vars | **NONE — zero-env surface.** Pure static content from typed content modules; the `process.env.RECKON_API_KEY` strings inside `src/lib/*.ts` code samples are marketing copy (text), never runtime consumption. |
| `vercel.json` | None, deliberately — no route rewrites (`/`, `/pricing`, `/products/<id>` are plain App Router routes); standard build output, no `standalone`. |
| Region / runtime | `iad1`, Node 22.x |
| Production URL | <!-- LEAD-FILL: reckon-marketing production URL --> |

## 3. Deploy trigger (git-connected production deploy at the release commit)

All four projects deploy from `main` (git-connected production deploys per
push). The Lead's sequence:

1. Merge `work/s4-002-final-release` into `main` — that merge commit is
   **the release commit** (the release-artifacts commit referenced by
   `docs/handoff/final-release-evidence.md`).
2. Push `main`. Each project's production deployment builds the release
   commit. Set `RECKON_DOCS_BASE_URL` on `reckon-web` to the
   `reckon-docs` URL and re-deploy `reckon-web` once the docs URL is
   known (or set it after the first docs deploy and trigger the web
   redeploy — the variable is optional and the dashboard degrades
   honestly to its default while unset).
3. **Hobby concurrency note:** one build at a time per account — the four
   builds queue automatically; no ordering is required for correctness
   (each surface is independently reachable; `reckon-web` degrades
   honestly to its documented not-configured states while the API env is
   stale).
4. The API function applies pending migrations idempotently at cold boot;
   the operator ALSO runs `pnpm migrate:apply` per `runbook.md` §1 at
   release time (both no-op when current — this release ships no new
   migrations).

## 4. Verification gate (run post-deploy — this is the release gate)

```bash
cd <repo root at the release commit>
RECKON_API_URL='<!-- LEAD-FILL: reckon-api production URL -->' \
RECKON_WEB_URL='<!-- LEAD-FILL: reckon-web production URL -->' \
RECKON_DOCS_URL='<!-- LEAD-FILL: reckon-docs production URL -->' \
RECKON_MARKETING_URL='<!-- LEAD-FILL: reckon-marketing production URL -->' \
node scripts/verify-deployment.mjs
```

(The four URLs are env values, not placeholders, at run time — the Lead
substitutes the deployed URLs. The script is Node-stdlib-only.)

- Probes: api `GET /healthz` (200 `{ok:true, version, contractsVersion}`)
  + `GET /v1/decisions/{id}` unauthenticated (typed 401 `UNAUTHENTICATED`
  envelope on a frozen route); web `GET /` (200 + `Reckon Studio`);
  docs `GET /` (200 + `Reckon documentation`); marketing `GET /`
  (200 + `Recommendation infrastructure`).
- **Exit 0 = gate PASS** — the exit-0 transcript is the release-gate
  evidence recorded in `docs/handoff/final-release-evidence.md` (replacing
  that doc's LEAD-FILL placeholders). Exit 1 = per-surface probe failure
  (each failing surface and reason is named). Exit 2 = usage error
  (missing/malformed env).
- The gate's markers and shapes are lockstep-checked against the shipped
  sources by `tests/deployment/verify-deployment.test.ts` (battery) —
  drift fails the battery, never the Lead's gate run.
- The in-process counterpart evidence: `node scripts/e2e-journey.mjs`
  (S4-001, 6/6 hops) and the full battery (`pnpm build && pnpm typecheck
  && pnpm test && node scripts/verify-repo.mjs`) are the pre-merge gates —
  both recorded in the evidence doc.

## 5. Rollback notes

- **All four projects:** git-connected per-push deployments — the Vercel
  dashboard rollback per project (or redeploy the previous commit). Each
  surface rolls back independently.
- **`reckon-docs` / `reckon-marketing`:** stateless static surfaces —
  rollback is a redeploy; no data implications, no env to restore.
- **`reckon-web`:** stateless SDK consumer — rollback is a redeploy; the
  demo data lives in the API/Neon, not the web app.
- **`reckon-api`:** rollback restores the previous function build; the
  database is **forward-only per `docs/deployment/migrations.md`** (no
  rollback there, by design). This release ships no new migrations, so an
  API rollback cannot strand schema state.
- **FLAG LAW (rollback interplay):** `implementationComplete` is flipped
  to `true` by the Lead in the closing commit only AFTER the §4 gate
  passes on all four surfaces; if the gate fails or a rollback is taken,
  the flag stays `false` and the release is re-run from §3.

## 6. Free-tier posture (assumption class — `free-tier-guardrails.md`)

Four Vercel Hobby projects on one account share the account-level
envelope (invocations/build/bandwidth quotas are account-wide, not
per-project). Three of the four surfaces (web, docs, marketing) are
static-heavy Next.js deploys — request-light; the API remains the only
function surface (request-light demo volume; no LLM, no scans). The
no-paid-tier-without-operator-approval rule is unchanged.
