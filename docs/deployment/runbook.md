# Operations Runbook

**Status:** P1-004. Everything here describes behavior that exists in code
today (`apps/api/src/main.ts`, `composition.ts`, `pg-observability.ts`,
`packages/persistence/*`) or is explicitly marked NOT-YET (honesty law —
no aspirational prose presented as current behavior).

## 1. Boot (production)

```bash
# 1. migrate (exit codes: 0 ok · 1 failure · 2 tamper)
DATABASE_URL='postgres://…/reckon?sslmode=require' pnpm migrate:apply

# 2. start the API (refuses to boot without DATABASE_URL — exit 1)
DATABASE_URL='postgres://…/reckon?sslmode=require' \
RECKON_API_KEYS_FILE=/run/secrets/reckon_api_keys \
RECKON_HOST=0.0.0.0 RECKON_PORT=8080 RECKON_LOG=1 \
pnpm --filter @reckon/api start
```

Boot-time fail-fast behaviors (tested): missing `DATABASE_URL` → exit 1;
malformed `RECKON_PORT` → `ConfigError` + exit 1; empty keys → loud stderr
warning, all authenticated routes 401 (honest degraded mode).

## 2. Health probes (no auth, deliberately open)

- `GET /healthz` — liveness: `{ok, version, contractsVersion}`.
- `GET /readyz` — readiness + per-handler wiring map (`wired` /
  `not-wired`); a `not-wired` handler answers 501 on its own routes.

## 3. Observability surfaces

- **stderr**: boot lines, shutdown lines, `PgPoolExecutor` idle-client
  terminations (never process-fatal; the pool retires the dead client).
- **stdout** (with `RECKON_LOG=1`): fastify structured request logs.
- **PG `observability_records`**: `PgObservabilitySink` — async-drain
  telemetry (documented lossy on crash; the sink is best-effort by design
  and this is stated, not hidden).
- **PG `outcome_outbox`**: transport ground truth — `state`, `attempts`,
  `next_attempt_at`, `last_error` per undelivered outcome.

## 4. Durable outcome transport (what to expect)

Outcomes are persisted to `outcome_events` and queued in `outcome_outbox`
in the same transaction; delivery is **at-least-once** with retry backoff
(`attempts`, `next_attempt_at`), dedup at the sink by idempotency key.
A process crash mid-delivery loses nothing — the restart-durability
battery proves full recovery over real PostgreSQL. Terminal failure state
is `failed` with `last_error` recorded — visible via SQL, honest, alertable.

## 5. Incident playbook

| Symptom | First check | Action |
|---------|-------------|--------|
| API 5xx envelopes + pool idle-client errors on stderr | Neon console: branch state, autosuspend, compute budget | usually transient; pool self-heals when the endpoint returns. If sustained >15 min, check provider status. |
| `migrate:apply` exit 1 | the stderr line names the failing migration + cause | fix cause, re-run (idempotent). NEVER hand-edit `reckon_schema_migrations`. |
| `migrate:apply`/`status` exit 2 | deployment used different code than the one that applied migrations | align code+DB (the recorded checksum must equal the code's SQL); treat as a release-management incident. |
| `/readyz` shows `not-wired` handlers | `composition.ts` wiring | 501 on those routes is by design (honest NotWired), but production should never ship one — fix the wiring. |
| Outbox rows stuck `pending` | `SELECT state, count(*), max(next_attempt_at) FROM outcome_outbox GROUP BY 1` | if `next_attempt_at` is in the future: backoff, wait. If past and not draining: check the sink endpoint health + process logs. |
| API process died | process supervisor logs | state is durable; restart per §1. Outbox resumes at-least-once delivery. |

## 6. Capacity + free-tier ops posture

Neon free-tier autosuspend makes the first connection after idle slow
(seconds, not ms). This is a *budget posture*, not an error: the pg pool
absorbs it. Provider limits, degradation postures and the no-paid-tier
without-operator-approval rule live in `free-tier-guardrails.md`.

## 7. NOT-YET (recorded honestly)

- No metrics/endpoint scraping beyond `/healthz` `/readyz` (add only with a
  real consumer).
- No automated backups beyond the provider's own mechanisms (verify what
  the free tier actually provides BEFORE relying on it — assumption class,
  see guardrails doc).
- No horizontal API scaling story (single process by design in the current
  phase; scale-up is a deliberate future decision, not an accident).

## 8. Public deployment (Vercel, DEPLOY-001)

Two Vercel Hobby projects, both deployed from this monorepo:

| Project      | Root dir   | Framework | Build                                  | Public path               |
|--------------|------------|-----------|----------------------------------------|---------------------------|
| `reckon-api` | `apps/api` | Other     | `pnpm run bundle:vercel` (vercel.json) | `/v1/*`, `/healthz`, `/readyz` |
| `reckon-web` | `apps/web` | Next.js   | package build script                   | `/` (all workspaces)      |

- **API env:** `DATABASE_URL` (Neon, `sslmode=require`), `RECKON_API_KEYS`
  (`demoKey:demo:decisions,outcomes,plans,catalog,research,agents,integrations`
  class entries). `RECKON_PORT`/`RECKON_HOST` are listener-only vars — unused
  in function mode.
- **Web env:** `RECKON_API_BASE_URL` (the API project URL),
  `RECKON_DEMO_API_KEY` (server-only secret), `RECKON_ENV=production`.
- **The API function** is the self-contained esbuild bundle `api/index.js`
  of `src/vercel.ts` (`scripts/bundle-vercel.mjs`; `@reckon/contracts`
  dist is built first by the same script). Cold boot applies pending
  migrations idempotently; the operator ALSO runs `pnpm migrate:apply`
  per §1 at release time (both no-op when current).
- **Rewrites** (vercel.json): `/v1/*`, `/healthz`, `/readyz` → the function;
  Vercel preserves the original request URL, so the frozen route contracts
  route exactly as in self-hosted mode.

Local pre-deploy verification (both exit non-zero on failure):

```bash
cd apps/api
pnpm run bundle:vercel                                   # produces api/index.js
DATABASE_URL='postgres://…' RECKON_API_KEYS='k:t:plans' \
  SMOKE_KEY=k node scripts/vercel-smoke.mjs              # boots the bundle over real PG
```

Post-deploy verification (Gates M/N, DEPLOY-002 + DEPLOY-003):

```bash
cd apps/api
RECKON_API_BASE_URL='https://reckon-api-phi.vercel.app' \
RECKON_DEMO_API_KEY='<demo key>' \
  pnpm dlx tsx scripts/seed-demo.ts                      # DEPLOY-002 demo tenant

RECKON_API_BASE_URL='https://reckon-api-phi.vercel.app' \
RECKON_API_KEY='<demo key>' \
RECKON_WEB_BASE_URL='https://reckon-web-nine.vercel.app' \
  pnpm dlx tsx scripts/external-smoke.ts                 # DEPLOY-003 Gate M/N proof
```

**Deployed URLs (actual, 2026-10-03):**

| Project | URL | Notes |
|---|---|---|
| `reckon-api` | https://reckon-api-phi.vercel.app | Vercel Hobby, git-connected `payswapdotorg/Reckon`, rootDirectory `apps/api`, region `iad1`, Node 22.x. The esbuild bundle `api/index.js` is TRACKED in the source tree (zero-config function detection scans source, not build output) and is regenerated by `buildCommand` at deploy time. |
| `reckon-web` | https://reckon-web-nine.vercel.app | Vercel Hobby, git-connected, rootDirectory `apps/web`, framework Next.js, buildCommand `pnpm run build`, region `iad1`, Node 22.x. |

Rollback: the projects are git-connected (deploy per push) — redeploy the
previous commit; the operator's emergency lever is Vercel's dashboard
rollback. Database state is forward-only per `migrations.md` (no rollback
there by design).
