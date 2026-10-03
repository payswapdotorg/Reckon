# Database Migrations

**Status:** P1-004. Implementation: `packages/persistence/src/migrations.ts`
(+ `migrate-cli.ts`). Tests: `packages/persistence/test/migrate-cli.test.ts`
(real PostgreSQL, evidence class controlled-local).

## 1. Laws (frozen)

1. **Forward-only.** No `DROP`, no in-place rewrite of shipped SQL. A
   breaking change is a NEW migration with explicit safety notes.
2. **Idempotent statements.** Every statement uses `IF NOT EXISTS`-style
   guards — a partially-applied state converges on re-run.
3. **One transaction per migration.** The migration's DDL and its
   bookkeeping row commit atomically; a failure rolls the migration back
   completely (the CLI says so and exits 1).
4. **Checksummed.** Each applied migration records
   `sha256(sql.join("\n;\n"))` in `reckon_schema_migrations`. An applied
   migration whose recorded checksum no longer matches the code is a
   **tamper** — `status`/`apply` exit 2 and refuse to proceed.
5. **Infra bookkeeping timestamps only.** `applied_at` is wall-clock
   infrastructure time, never a contract-visible timestamp (the
   caller-supplied-timestamps law is not violated).
6. **Sequencing discipline (FINAL TL HANDOFF §25):** new migration →
   validate locally → apply preview DB → run tests → apply production DB →
   deploy/promote. A breaking schema migration is never coupled with the
   application deployment into a single unverified step.

## 2. The CLI

```bash
# from the repo root
pnpm migrate:apply     # = pnpm --filter @reckon/persistence migrate apply
pnpm migrate:status    # = pnpm --filter @reckon/persistence migrate status

# explicit target (CI-friendly flag beats the env)
DATABASE_URL='postgres://…/reckon?sslmode=require' pnpm migrate:apply
pnpm --filter @reckon/persistence migrate -- --database-url 'postgres://…' status
```

Exit codes (a stable contract; CI gates on them):

| code | meaning |
|------|---------|
| 0    | schema current, or migrations applied cleanly and verified |
| 1    | usage error · missing `DATABASE_URL` · connection failure · apply failure (rolled back) |
| 2    | checksum tamper — applied state does not match the code's SQL; refuses to proceed |

`status` output marks each migration `[applied]` (with time), `[pending]`,
or `[TAMPERED]`; pending migrations in `status` are a state report, not an
error (exit 0). Both commands end with the same verification pass — an
applied-but-tampered migration is never reported as fine.

In the DEPLOY-001 Vercel shape, the API function (`src/vercel.ts`) boots the
same production composition and applies pending migrations idempotently on
cold boot — the operator still runs the CLI per the sequence above at
release time; both paths no-op when the schema is current.

## 3. Adding a migration

1. Append an entry to `MIGRATIONS` (`packages/persistence/src/migrations.ts`):
   `id: "m00N_subject"`, honest one-line `name`, `sql: [...]` statements
   obeying the laws above.
2. Extend/adjust the package batteries (`state-stores`,
   `restart-durability`, or a focused new test file) so the new schema is
   exercised — the harness auto-applies migrations on boot, so all existing
   real-PG tests also re-verify the new DDL.
3. `pnpm test` (full repo battery) — the CLI test file additionally proves
   apply/idempotency/tamper semantics on a pristine database.
4. Deploy sequence per §25 (above), preview before production.

## 4. Rollback posture

There is no rollback: the discipline is forward-only repair (new migration)
because every statement is additive/idempotent. If a migration fails
mid-run: fix the cause, re-run `pnpm migrate:apply` — already-applied
migrations are skipped by id, the failed one re-applies from its rolled-back
state. Restoring a database from a snapshot is the operator's last resort
and must be recorded as an incident (see `runbook.md`).
