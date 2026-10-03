# Reckon — Final Release Evidence (RELEASE-001)

> Produced 2026-10-03 per FINAL-TL-HANDOFF §31. Every claim below is either
> machine-verified in this release window or explicitly labeled with its
> evidence class. No aspirational prose.

## 1. Release identity

| Field | Value |
|---|---|
| Repository | `payswapdotorg/Reckon` (public), branch `main` |
| Release commit | release artifacts commit (this file's commit; code identical to the deployed commit — see §8 deployment provenance) |
| Work items | 53/53 done (`docs/work-items/state.json`); `implementationComplete: true` in the same release |
| Deployment URLs | API https://reckon-api-phi.vercel.app · Web https://reckon-web-nine.vercel.app |

## 2. Deployment

| Field | Value |
|---|---|
| Platform | Vercel Hobby (free tier), two git-connected projects, region `iad1` (US East — co-located with Neon `aws-us-east-1`), Node 22.x |
| `reckon-api` | rootDirectory `apps/api`, framework Other; serverless function = self-contained esbuild ESM bundle `api/index.js` of `src/vercel.ts` (2.28 MB, `pg-native` external under the `createRequire` shim — runtime-caught miss, pure-JS driver); `vercel.json` rewrites `/v1/*` `/healthz` `/readyz` preserve the frozen route surface; static landing page in `public/` |
| `reckon-web` | rootDirectory `apps/web`, framework Next.js 16.3.8 (webpack), buildCommand `pnpm run build` (chains the `@reckon/contracts` dist build) |
| Rollback | git-connected per-push deployments; Vercel dashboard rollback; DB forward-only per `docs/deployment/migrations.md` |

## 3. Database (Gate L)

| Field | Value |
|---|---|
| Provider | Neon Postgres, free tier (project `reckon-production` / `lingering-sun-14227532`, `aws-us-east-1`, PG16, 0.25 CU autoscaling, scale-to-zero) |
| Database / role | `reckon` / `reckon_owner`; `sslmode=require` |
| Migration state | `m001_events`, `m002_outbox`, `m003_api_state`, `m004_agents` — ALL APPLIED (checksums recorded; `pnpm migrate:status` over the production wire, re-verified this release window) |
| Durability evidence | restart-durability battery over real PG (in-suite); cross-deployment durability demonstrated live: demo data seeded 2026-10-02 22:5xZ survived every redeploy and is served publicly today; GATE-N durable read-back over the public wire (§7) |
| Evidence class | deployed-infrastructure (controlled production wire) |

## 4. Cache / object store / auxiliary providers (honest)

| Provider | Status in the deployed architecture |
|---|---|
| Upstash Redis | **Not deployed.** The deployed architecture requires no cache/rate-limit layer (static-key auth; no session state outside PG). Per handoff §22 "only the variables actually required". Operator-provided credentials recorded in the orchestration vault; the supplied REST endpoint hostname did not resolve from the orchestration host at release time (recorded honestly). PG remains the sole durable authority per handoff §19. |
| Cloudflare R2 | **Not deployed.** No artifact-store consumers exist in the runtime yet. Operator credentials verified working at release time (S3 ListBuckets OK; an existing `reckon-artifacts` bucket is available for future simulation/research artifacts). |
| Apify | **Not deployed** (optional external data acquisition; no consumer). |
| Neon | Deployed and live (§3). |
| Vercel | Deployed and live (§2). |

## 5. External integrations (honest)

Consumer adapters (WebFlix/media, generic media, commerce, advertising) are
**declarative conformance-tested fixture integrations** — no live provider
connection is claimed or displayed. The integration workspace renders
capability cards from the frozen adapter declarations with fixture-only
verification status enforced structurally (E2E asserts fixture-only across
all adapters). Evidence class: controlled-local (fixtures), honestly labeled
in UI and API.

## 6. Test commands and results (this release window)

Commands (repository root):

```bash
pnpm test        # full vitest suite
pnpm build       # all packages + apps
pnpm typecheck   # root tsc --noEmit
pnpm check       # scripts/verify-repo.mjs (repo structure gates)
```

Results (2026-10-03, this release window, orchestration host):

```text
pnpm test      → Test Files 60 passed (60) · Tests 1023 passed (1023) · 43.78s  (TEST_EXIT=0)
pnpm build     → all packages + apps built, incl. apps/web next build        (BUILD_EXIT=0)
pnpm typecheck → root tsc --noEmit clean                                    (TC_EXIT=0)
pnpm check     → verify-repo.mjs repo-structure gates green                  (CHECK_EXIT=0)
```

Zero failures, zero flake-retries in this run.

## 7. Smoke-test results (Gates M/N — public wire)

`apps/api/scripts/external-smoke.ts` against production, 2026-10-03:

```text
OK   healthz: 200 ok=true version=0.1.0 (https://reckon-api-phi.vercel.app)
OK   readyz: 200 all handlers wired (12 ports)
OK   decision: action=QUEUE decisionId=dec-b9676feb4773be939e2fea86
OK   decision read-back: durable decisionId=dec-b9676feb4773be939e2fea86 action=QUEUE
OK   outcome: eventId=smoke-1790991250-ev (durable transport accepted)
OK   evidence retrieval: decision dec-b9676feb4773be939e2fea86 persisted across requests
OK   web: 200 "Reckon" served (https://reckon-web-nine.vercel.app)
GATE-N: PASS
```

Gate M (public reachability): both production URLs HTTP 200 from the public
internet; authenticated `/v1` 200, unauthenticated 401.

DEPLOY-002 demo tenant: `seed-demo.ts` re-run over the public URL —
7 steps seeded, 6 skipped (idempotent re-run tolerated; demo data explicitly
Demo-labeled, evidence class fixture/controlled-local).

## 8. Performance results

Fast-path kernel envelope (no-LLM decision→schedule→record), measured fresh
this release window by `tests/perf/envelope-bench.ts` (200 measured + 30
warmup iterations, deterministic 200-item/400-realization/132-row payload,
nearest-rank percentiles, monotonic timer) on the shared orchestration host:

```text
stage                              p50(ms)   p95(ms)   p99(ms)
normalization                         1.62       5.67      14.88
decision                              9.91      16.48      29.24
scheduling                            2.93       7.03      13.70
outcome-recording                     0.19       0.27       0.42
end-to-end (decision→schedule+record) 15.28      23.69      53.13
```

Context (honest): the documented baseline in `tests/perf/README.md`
(p50 14.2 / p95 17.8 / p99 27.6 end-to-end) was measured on a quieter host;
this release-window host is shared and shows higher tail latencies. The
regression guard `tests/perf/envelope.test.ts` ran INSIDE the full battery
above and PASSED within its documented budgets. Evidence class:
controlled-local (benchmark host, not the public deployment).

## 9. Gates K–R reconciliation

| Gate | Verdict | Evidence |
|---|---|---|
| K — Product UI | **PASS** | 9 workspaces live on https://reckon-web-nine.vercel.app (Overview, Decisions, Plans, Scheduler, Agents, Research, Integrations + shell); a person can walk context → candidates → experience → decision → schedule → outcomes without API tools |
| L — Real persistence | **PASS** | §3: Neon production, all migrations applied, cross-redeploy durability + durable read-back over public wire |
| M — Public deployment | **PASS** | §7: both URLs publicly reachable |
| N — Production smoke test | **PASS** | §7: GATE-N PASS (authenticate → decision → outcome → persistent evidence over the public wire) |
| O — UI quality | **PASS with documented divergence** | `docs/ux/acceptance.md`: reference↔implemented captures at 1440/768/390 + honest VLM-assisted comparison; token alignment battery-enforced; density divergence recorded, not hidden |
| P — Free-tier discipline | **PASS** | `docs/deployment/free-tier-guardrails.md` (quotas + demo guardrails, honestly assumption-labeled); deployed stack = Vercel Hobby + Neon free only |
| Q — Operational honesty | **PASS** | Evidence-class badges across UI (observed / controlled-local / fixture / simulated / counterfactual); simulated/counterfactual rungs visually distinct (research ladder); fixture-only integration status structural; §4/§5 of this document |
| R — Release | **PASS** | K–Q green → `implementationComplete: true` set in `docs/work-items/state.json` in this release |

## 10. Known limitations (honest register)

1. **No live consumer-provider connections** — adapters are conformance
   fixtures; no WebFlix/commerce/advertising account is connected (§5).
2. **No LLM/model provider in the loop** — by design: the fast path is
   deterministic and LLM-free; no model-router exists (architecture law).
3. **Observability is append-only PG + structured logs** — no metrics
   scraping/alerting (runbook §7 NOT-YET register).
4. **Free-tier autosuspend** — first connection after Neon idle is slow
   (seconds); absorbed by the pg pool; documented posture, not an error.
5. **Vercel Hobby concurrency** — one build at a time; 100 deploys/day;
   guardrails documented in free-tier-guardrails.md.
6. **Upstash/R2/Apify not wired** — no consumer exists yet; credentials
   vaulted and verified where testable (§4).
7. **Demo dataset is fixture-class** — explicitly Demo-labeled everywhere;
   never presented as customer data (§7, handoff §27).
8. **Single-region deployment (iad1)** — deliberate free-tier posture.

## 11. Provider evidence class summary

| Claim | Class |
|---|---|
| API + web publicly serving | deployed-infrastructure (public wire, this window) |
| Neon persistence + migrations | deployed-infrastructure (production wire) |
| Decision/outcome/evidence round-trip | deployed-infrastructure (GATE-N) |
| Adapter conformance | controlled-local (fixtures) |
| Demo tenant data | fixture / controlled-local, Demo-labeled |
| UI design-language alignment | reference inspection + implemented captures (acceptance.md) |
| Free-tier quota numbers | assumption class where not re-measured this window (guardrails doc) |

## 12. Free-tier assumptions (guardrails digest)

Vercel Hobby: 1M invocations/mo, 4 CPU-hours/mo, 100 deploys/day, 1 concurrent
build. Neon Free: 50 CU-hours/mo per project (0.25 CU autoscaling),
0.5 GB storage, 5 GB egress/mo. Numbers are provider-published allowances
(assumption class — re-verify against the provider console before relying on
them for capacity planning; see free-tier-guardrails.md for the full posture
and the no-paid-tier-without-operator-approval rule).
