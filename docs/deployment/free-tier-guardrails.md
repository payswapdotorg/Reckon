# Free-Tier Guardrails

**Status:** P1-004. Discipline: the deployment stays on FREE tiers until the
operator explicitly approves paid usage. Every number below is an
**ASSUMPTION** (evidence class: provider-claim, as of 2026-10) — each one is
re-verified against the provider's own console/docs at DEPLOY-001 time and
the verified values are recorded in `docs/handoff/final-release-evidence.md`
with their verification date. Nothing here is presented as measured fact.

## 1. Provider posture (assumption class)

| Provider | Free allowance (ASSUMED, 2026-10) | Hard risk | Our posture |
|----------|-----------------------------------|-----------|-------------|
| Neon (PostgreSQL) | ~0.5 GB storage; limited compute-hours/mo; branch limits; autosuspend after idle | cold-start latency; compute-budget exhaustion | single small tenant volume; pool absorbs cold starts; alerts before budget by usage check |
| Vercel (Hobby) | limited serverless invocations + bandwidth; no commercial use terms (demo = fine) | function timeout ~10s–60s class | DEPLOY-001 shape = TWO Hobby projects on the same account (`reckon-web` + `reckon-api`) sharing the account-level envelope; the API function is request-light (demo tenant); heavy work stays in the kernel (no LLM, no scans) |
| Cloudflare R2 | ~10 GB storage; no egress fee | storage growth | only large research artifacts per ADR-001; metadata + digests stay in PG |
| Upstash (Redis) — OPTIONAL | ~10k commands/day class; small max size | rate-limit 425s | cache-only, NEVER authority (ADR-001); if it throttles, bypass the cache — correctness unaffected |

## 2. Degradation postures (what happens when a tier is hit)

- **Neon autosuspend:** first query after idle is slow (seconds). No error,
  no data loss — the pg pool waits. Acceptable for a demo deployment;
  documented, not hidden.
- **Neon compute/storage budget exhausted:** provider freezes/computes-stop
  behavior — the API surfaces 5xx envelopes; recovery is a provider-side
  action. Mitigation: keep tenant volume small; monitor usage weekly in the
  runbook cadence.
- **Vercel limits:** the UI fails to serve; the API is unaffected (separate
  host). Mitigation: the UI is static-heavy, request-light.
- **R2 growth beyond free:** research artifacts stop uploading; metadata
  stays in PG. Mitigation: artifact size caps before count caps.
- **Upstash throttle (if used):** cache bypass; latency increases,
  correctness unchanged by construction.

## 3. Budget discipline rules

1. **No paid tier without operator approval.** A provider's "upgrade now?"
  interstitial is never clicked on the project's behalf.
2. **Free-tier claims are assumptions until verified in the provider
   console** — verified values + dates are recorded in
   `final-release-evidence.md` (Gate Q: free-tier discipline).
3. **Demo scale, not production scale:** the public demo tenant
   (DEPLOY-002) is explicitly labeled demonstration data and sized to stay
   inside every free envelope.
4. **One authoritative database.** No second "shadow" datastore to dodge a
   single provider's limits (ADR-001).
5. **Recovery > avoidance:** prefer postures that degrade honestly (5xx,
   slow, bypass) over silent data loss or silent correctness drift.

## 4. Verification checklist (DEPLOY-001 fills this in, with dates)

- [ ] Neon: actual storage + compute meter reading after first deploy
- [ ] Vercel: actual function + bandwidth limits observed
- [ ] R2: actual storage used by demo artifacts
- [ ] Upstash (if used): actual command rate vs assumed allowance
- [ ] Recorded in `docs/handoff/final-release-evidence.md` with dates —
      assumptions upgraded to verified, or corrected, honestly.
