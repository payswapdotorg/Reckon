# Deployment Architecture

**Status:** P1-004 (production deployment configuration). Owner: W3 lane.
**Laws:** ADR-001 (PostgreSQL-only authority), ADR-002 (model adapter), ADR-003 (consent/privacy), ADR-004 (runtime research).

## 1. Topology

The DEPLOY-001 public shape: BOTH apps run as Vercel Hobby projects deployed
from this monorepo; Neon remains the single authority.

```text
                    ┌────────────────────────────────────────────┐
                    │                PUBLIC INTERNET             │
                    └───────┬───────────────────────────┬────────┘
                            │ HTTPS                     │ HTTPS
                  ┌─────────▼─────────┐       ┌─────────▼─────────┐
                  │  Vercel (Hobby)  │       │  Vercel (Hobby)   │
                  │  reckon-web      │       │  reckon-api       │
                  │  apps/web        │──────►│  apps/api         │
                  │  Next.js App     │  SDK  │  api/index.js     │
                  │  Router UI       │ fetch │  (esbuild bundle  │
                  │  (UI-001..009)   │       │   of src/vercel   │
                  │                  │       │   .ts; rewrites   │
                  │                  │       │   /v1/* /healthz  │
                  │                  │       │   /readyz)        │
                  └──────────────────┘       └─────────┬─────────┘
                            │                          │ pg wire (TLS)
                            │                ┌─────────▼─────────┐
                            │                │  Neon PostgreSQL  │
                            │                │  THE authority    │
                            │                │  (ADR-001)        │
                            │                └─────────┬─────────┘
                            │                          │ large artifacts
                            │                ┌─────────▼─────────┐
                            │                │  Cloudflare R2    │
                            │                │  object storage   │
                            │                │  (metadata+lineage│
                            │                │   stays in PG)    │
                            │                └───────────────────┘
```

The self-hosted alternative is unchanged and still first-class: a
long-lived Node process (`apps/api/src/main.ts`, RECKON_HOST/RECKON_PORT).
The Vercel mode (`apps/api/src/vercel.ts`) runs the SAME production
composition — only the listener differs.

Optional (NOT authority, cache-only): Upstash Redis — free-tier rate-limit /
short-cache use, never a source of truth (ADR-001 law: no hidden authority).

## 2. Components

| Component    | Runtime                  | Scale unit          | Notes |
|--------------|--------------------------|---------------------|-------|
| `apps/web`   | Vercel serverless/hobby  | per-request         | consumes `@reckon/sdk`; UI lane (UI-001..009); no persistence internals |
| `apps/api`   | Vercel Node function (DEPLOY-001: `api/index.js`, esbuild bundle of `src/vercel.ts`, rewrites `/v1/*` + `/healthz` + `/readyz`) OR long-lived Node process (`main.ts`) | per-request (function) / single process (self-host) | production composition: real W2 kernel handlers over `@reckon/persistence`; `pg.Pool` (max 10, idle 30 s); cold boot applies pending migrations idempotently |
| PostgreSQL   | Neon (free tier)         | branch per env      | single writer; every authoritative table tenant-scoped |
| R2           | Cloudflare (free tier)   | object              | research artifacts per ADR-004; lineage + digests in PG |

## 3. Failure domains + behavior

- **Database unreachable:** in-flight queries reject through their promise
  chains; `pg.Pool` logs idle-client termination to stderr (never
  process-fatal — `PgPoolExecutor` `pool.on("error")` policy). API requests
  surface typed 5xx envelopes, not crashes. Recovery is automatic when the
  endpoint returns.
- **API process crash:** state is durable (PG); the outbox preserves
  undelivered outcomes — at-least-once transport resumes on restart
  (proven by the restart-durability battery over real PostgreSQL).
- **Neon autosuspend (free tier):** cold first-connection latency; the pool
  absorbs it as a slow query, not an error. See `free-tier-guardrails.md`.
- **Migration failure:** the failing migration rolls back atomically; the
  run is idempotent — re-run after fixing the cause. See `migrations.md`.

## 4. Tenancy + trust boundary

Every authoritative table is keyed `(tenant_id, workspace_id[, …])`; the API
authenticates static bearer keys → tenant + scopes (`config.ts`
`parseApiKeyList`), enforced per-route. `/healthz` + `/readyz` are
deliberately unauthenticated. No cross-tenant query paths exist in the
production composition (composition.test.ts proves isolation).

## 5. Evidence-class discipline

Deployment evidence is labeled by class: **controlled-local** (embedded
PostgreSQL through the real pg wire driver — all CI batteries) vs
**deployed-infrastructure** (real Neon `DATABASE_URL`, Gate L; public
reachability + external smoke test, Gates M/N). Claimed-only facts are
recorded as assumptions, never as verified results.
