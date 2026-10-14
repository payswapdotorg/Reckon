# Ad-Lane E2E Evidence Appendix — AD-006

**Status:** DELIVERED WITH AD-006 (this document).

**Owner:** W3 (AD-006; TL3+W3 per `docs/work-items/state.json`).

This is the AD-006 **evidence appendix** (the
`docs/handoff/final-release-evidence.md` conventions applied to the ad lane):
every AD-006 evidence requirement and every ad-memory privacy/policy law is
mapped to its machine-verifiable artifact and the command that reproduces it.
The map is LOCKSTEP-ENFORCED by `tests/e2e/ad-lane-evidence-map.test.ts` —
a row whose artifact or named test drifts from this file fails the battery,
never the claim.

## Reproduction commands

All commands run from the repository root (Node ≥ 22, `pnpm install` first;
`pnpm build` once so workspace dists exist for `pnpm typecheck`):

```bash
pnpm test tests/e2e/ad-lane-e2e.test.ts           # the AD-006 E2E suite (22 tests)
pnpm test                                          # the full battery (lockstep included)
```

`tests/e2e/ad-lane-e2e.test.ts` drives the PRODUCTION composition
(`buildProductionServer` from `apps/api/src/composition.ts`) over a REAL
PostgreSQL engine (embedded PG 18 via `packages/persistence/test/pg-harness.ts`
— the same engine class Neon serves), through the real route pipeline and the
real `@reckon/sdk` client (inject-fetch). The only composed test double is the
DETERMINISTIC availability channel — the deployment-time seam channels occupy
by design (AD-003); no live provider, no network, no wall clock (fixed clocks
everywhere; the suite is replay-stable — re-run produces identical results).

EVIDENCE CLASS of every row below: **controlled-local** (real engine + real
composition + real contracts in a controlled harness). Production-wire
observations live ONLY in `docs/deployment/ad-lane-verification.md` and are
never claimed here.

## 1. The two frozen paths (work order, TL6-FINAL-HANDOFF AD-006)

| Path | Artifact (test) | Command |
|---|---|---|
| **PATH 1** — `encounter/save → retain → query/retrieve → resolve experience → decide → schedule → present → outcome` | `tests/e2e/ad-lane-e2e.test.ts` → describe *"AD-006 PATH 1 — the memory path end-to-end"* (4 tests: encounter/save→retain→query/retrieve; query/retrieve→resolve experience; resolve experience→decide→schedule (QUEUE then CONTINUE dequeues the ad as plan head — present); present→outcome (fresh observed impression, deterministic supersession)) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| **PATH 2** — `current context → eligible ads → retrieval → decision → correct format/timing → outcome` | `tests/e2e/ad-lane-e2e.test.ts` → describe *"AD-006 PATH 2 — the contextual path end-to-end"* (4 tests: current context→eligible ads (window gating + provenance); retrieval→decision (ad + organic in ONE kernel chain); correct format/timing (declared format, timing window, projected rights/flight constraints); outcome (observed impression durable in PG, linked, captured into memory)) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |

## 2. The eleven evidence requirements

| # | Requirement | Artifact (assertion site) | Command |
|---|---|---|---|
| E1 | **Observed encounter** — the retained memory's provenance is the observed encounter itself (real outcome event id, observed evidence class, encounteredAt, context by reference) | PATH 2 test *"outcome: the host-reported observed impression is durable in PG…"* + PATH 1 re-encounter test (supersession) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E2 | **Retained-memory retrieval** — the retained ad is retrievable (remembered lane, structurally-active retention, explicit basis, whyRetrieved + disclosed terms) | PATH 1 test *"encounter/save → retain → query/retrieve…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E3 | **Explicit forget** — after `POST /v1/ads/forget`, no later retrieval can return the forgotten ad, at ANY clock (incl. rewinds); PG tombstone; row-level idempotent re-forget (0) | evidence test *"E3/L2: explicit forget…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E4 | **Expired ad suppression** — retention expiry suppresses retrieval at the boundary (deterministic rewind re-includes); a remembered ad past its own catalog window is excluded from decision-path candidacy truth (organic selected; ads-only request is the honest-absence 500, never a fabricated ad); closed channel windows excluded with honest notes; frozen runtime gates verified directly | evidence test *"E4/L3: expired ad suppression…"* + PATH 2 test 1 (closed-window supply note) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E5 | **Rights/permission denial** — present-revoked memory is never a presentation candidate; retain-revoke forgets terminally; a key WITHOUT the `ads` scope is typed-denied (403 INSUFFICIENT_SCOPE) on both ad routes; redistribution stays unlicensed (verbatim rights on the captured record) | evidence test *"E5: rights/permission denial…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E6 | **Query provenance** — per-candidate `whyRetrieved` (closed vocabulary, hint scores), `provider-supplied` naming the channel, `queryUnderstanding.terms` disclosed verbatim, honest notes (lexical-only, no embedding model) | PATH 2 test 1 + PATH 1 test 1 | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E7 | **Current-versus-remembered distinction** — the same ad in BOTH lanes with disjoint provenance kinds + memoryRecordId link; strict mode discipline both directions (remembered mode ⇒ empty available lane and vice versa) | evidence test *"E7/L9: the same ad appears in BOTH lanes…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E8 | **No-fabricated engagement** — simulated/counterfactual/fixture impressions are typed skips (never memory); unresolvable experiences are honest skips; a never-reported decision has ZERO outcome rows in durable storage; the observed/research evidence partition holds | evidence test *"E8/L10: no fabricated engagement…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E9 | **Deterministic replay** — identical queries byte-identical (independent executions); idempotent POST replay verbatim with `Idempotent-Replayed: true` (no re-execution); identical decisions return the same decisionId byte-for-byte; replayed outcome events are duplicate memory writes (one current record per ad) | evidence test *"E9: deterministic replay…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| E10 | **Production capability matrix** — capability → evidence class → status, per row | `docs/handoff/ad-lane-production-matrix.md` (lockstep-enforced by `tests/e2e/ad-lane-evidence-map.test.ts` + `tests/deployment/ad-lane-verification.test.ts`) | `pnpm test tests/e2e/ad-lane-evidence-map.test.ts` |
| E11 | **Deployment proof** — the production deployment probed; every outcome recorded verbatim with its evidence class; honest limitations | `docs/deployment/ad-lane-verification.md` (lockstep-enforced by `tests/deployment/ad-lane-verification.test.ts`) | `pnpm test tests/deployment/ad-lane-verification.test.ts` |

## 3. The ten ad-memory privacy/policy laws

| # | Law | Artifact (assertion site) | Command |
|---|---|---|---|
| L1 | **Retention requires an explicit permission/retention basis** | evidence test *"L1: retention requires an explicit permission/retention basis…"* (basis-less retention is a parse error at the frozen schema AND the finalize path; every captured record carries the deployment-declared basis) + every PATH test asserts `retention.basis` | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L2 | **Forget means subsequent retrieval cannot return the forgotten ad** | evidence test *"E3/L2: explicit forget…"* (terminal at every clock; tombstone; no resurrection) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L3 | **Expired ads cannot be presented as currently available** | evidence test *"E4/L3: expired ad suppression…"* (retention expiry boundary + rewind; catalog-window closure excludes decision-path candidacy; channel windows; frozen gates) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L4 | **An ad encountered is not automatically licensed for redistribution** | evidence test *"E5…"* (captured record: `redistributionPermitted === false`, rights gates verbatim from the channel) + PATH 2 outcome test (rights verbatim) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L5 | **Raw location/attention/sensitive attributes must not be silently persisted as ad targeting data** | evidence test *"L5: raw location, attention, or sensitive attributes…"* (context by reference only; unknown keys stripped by the frozen encounter-evidence schema; captured records carry only the reference) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L6 | **The agent must never infer sensitive personal attributes merely to improve advertising** | evidence test *"L6: the memory record carries NO audience-inference…"* (the record's key set is exactly the frozen schema's; no inference vocabulary anywhere in the serialized record) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L7 | **User value and host-declared objectives remain separate from advertiser commercial value** | evidence test *"L7: user value and commercial value remain separate…"* (separate fields; the reward bridge carries USER value only — commercial value has no ranking path; frozen RewardTerm parse) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L8 | **Advertising must remain explicitly identifiable as advertising** | evidence test *"L8: advertising remains explicitly identifiable…"* (`advertising: true` literal on every candidate; `kind: "advertising"` through the lane; the frozen ad-lane candidate-source vocabulary) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L9 | **Remembered advertising and new provider availability must carry different provenance** | evidence test *"E7/L9…"* (disjoint provenance union, per-lane arrays never merged, memoryRecordId link, mode discipline) + PATH tests' provenance assertions | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| L10 | **The ad lane uses the same evidence-class rules as the rest of Reckon** | evidence test *"L10: encounter evidence accepts ONLY observed evidence classes…"* (the shared `OBSERVED_EVIDENCE_CLASSES` family; research classes are parse errors) + E8 test (capture skips + the observed/research PG partition) | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |

## 4. Supporting proofs inside the same suite

| Proof | Artifact | Command |
|---|---|---|
| Subject-scoped memory (another subject sees nothing through the same key; cross-subject forget affects nothing) | evidence test *"memory is subject-scoped…"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| Every surfaced ad-bearing decision parses through the frozen `DecisionResult` contract | describe *"AD-006 contract soundness"* | `pnpm test tests/e2e/ad-lane-e2e.test.ts` |
| Lane-level law batteries from AD-001…AD-005 remain green (contracts, store, routes, SDK, selection, format/timing, round-trip, web UX) | the per-package suites named in `docs/handoff/ad-lane-production-matrix.md` | `pnpm test` |

## 5. Honest limitations (carried into the report)

1. **Controlled-local ceiling.** No ad-lane capability is production-verified
   (see the matrix and `docs/deployment/ad-lane-verification.md`): the
   production API was observed failing at the Vercel function-invocation
   layer on 2026-10-14 (every route HTTP 500 `FUNCTION_INVOCATION_FAILED`),
   so no production-serving claim is made anywhere in this appendix.
2. **Deterministic channel, not a real provider.** The available lane runs
   against a deterministic test channel composed at the deployment seam. No
   real ad provider/exchange has ever been connected (matrix row 5,
   fixture-only for real supply).
3. **Lexical retrieval only.** No embedding/semantic retrieval exists; the
   limitation is disclosed per result (`notes`) and `queryUnderstanding.modelProvenance` is unused (SDK_GAP-1; matrix row 12).
4. **Scheduler timing windows** are carried on the experience (`timing` +
   `time-window` constraints) but not kernel-enforced at queue-selection
   (SCHEDULER_GAP-1, pre-existing, disclosed in
   `docs/architecture/ad-selection.md`); hosts enforce, as for all kinds.
5. **The encounter bootstrap** (PATH 2's presentation cycle) is the honest
   origin of PATH 1's first encounter: an encounter is a host-observed
   impression, never invented by the suite.
