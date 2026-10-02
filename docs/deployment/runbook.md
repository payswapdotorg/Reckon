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
