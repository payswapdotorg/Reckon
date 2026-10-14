# Ad-Lane Production Capability Matrix — AD-006

**Status:** DELIVERED WITH AD-006 (this document).

**Owner:** W3 (AD-006; TL3+W3 per `docs/work-items/state.json`).

This is the ad-lane **production capability matrix** required by the AD-006
work order and by `docs/handoff/TL6-FINAL-HANDOFF.md` ("Required repository
artifacts": *production capability matrix*). It states, per ad-lane
capability, what is machine-verified and at WHICH evidence class —
production-verified capabilities are never conflated with fixture-only or
controlled-local ones (the same law as every Reckon lane; AGENTS.md
"Production truth").

## Evidence-class vocabulary (machine classes)

| Class | Meaning |
|---|---|
| `fixture` | Proven only against fixture/stub objects — no real engine, route pipeline or composition involved. |
| `controlled-local` | Proven against the REAL repository software in a controlled local harness: real route pipeline / production composition / real PostgreSQL engine (embedded PG 18 via `packages/persistence/test/pg-harness.ts`) — but not over the deployed public wire. |
| `staging` | Proven over a real staging deployment (none exists for the ad lane). |
| `production-observed` | Genuinely observed on the production deployment over the public wire (probe transcripts recorded in `docs/deployment/ad-lane-verification.md`). |

## The matrix

| # | Capability | Machine evidence (this repository) | Evidence class | Production status |
|---|---|---|---|---|
| 1 | **Ad-memory + ad-query frozen contracts** (`reckon.ad-memory-record`, `reckon.ad-query-request/result`, `reckon.ad-forget-request/result`, `adCandidatesToCandidateSet`, runtime gates) — AD-001 | `packages/contracts/test/ads.test.ts` (63 tests, incl. structural law checks) + generated JSON schemas `packages/contracts/schemas/ad-*.schema.json` | `controlled-local` (real zod contract surface; frozen — ADR-005) | Contracts are source truth; no production claim needed or made |
| 2 | **Personal Ad Memory persistence** — retention basis/expiry/forget terminality, provenance, permissions + append-only history, (subject, itemId) upsert/supersession, tombstones — AD-002 | `packages/persistence/test/ad-memory-store.test.ts` (law-mapped suite over BOTH the real PG engine and the in-memory twin), `restart-durability.test.ts`, migration `m007_ad_memory` | `controlled-local` (real PG engine + real `PgAdMemoryStore`) | **NOT production-verified** — the Neon production wire has not served the ad lane (`docs/deployment/ad-lane-verification.md` §2–§3) |
| 3 | **Ad retrieval routes** `POST /v1/ads/query`, `POST /v1/ads/forget` (auth → scope → tenant law → frozen-schema validation → idempotency → handler → response validation) — AD-003 | `apps/api/test/ads.test.ts` (33 route tests), `apps/api/test/ads-composition.test.ts` (4 PG composition tests) | `controlled-local` (real route pipeline + production composition over real PG) | **NOT production-serving** — every production API route answered HTTP 500 `FUNCTION_INVOCATION_FAILED` on 2026-10-14 (observed, `docs/deployment/ad-lane-verification.md` §2.1) |
| 4 | **SDK ad surface** (`reckon.ads.query`/`forget`, `queryAds`/`forgetAds` aliases, contract validation both sides, typed errors) — AD-003 | `packages/sdk/test/sdk-ads.test.ts` (9 tests over the real in-process API) | `controlled-local` | SDK is source truth; no production claim made |
| 5 | **Available-lane host/provider channels** (deployment-composed `AdAvailabilityChannel`, frozen-surface boundary validation, window gating, no persistence) — AD-003/AD-004 | `apps/api/test/ads.test.ts` + `ads-composition.test.ts` + `ad-selection*.test.ts` with DETERMINISTIC test channels (the composed seam) | `controlled-local` for the channel SEAM; **`fixture` for real provider supply** — no real ad provider/exchange has ever been connected (honest: none is configured in any deployment) | Seam is production-composable; real-provider supply is fixture-only — no production claim |
| 6 | **Ad selection through the ONE decision kernel** (ad-bearing candidate sets, ad-lane truth resolution at the request clock, per-item eligibility → hard-constraint projection, policy parity, honest absence) — AD-004 | `apps/api/test/ad-selection.test.ts` (12), `apps/api/test/ad-decisions.test.ts` (6), `apps/api/test/ad-selection-composition.test.ts` (5 over real PG) | `controlled-local` (real kernel chain + production composition) | **NOT production-verified** (see row 3) |
| 7 | **Ad format/timing through the existing experience + scheduler kernels** (format variants, timing windows, kernel-enforced max-duration, QUEUE/SUGGEST/CONTINUE defer, interruption policy gates) — AD-004 | `apps/api/test/ad-format-timing.test.ts` (12) | `controlled-local` | **NOT production-verified** (see row 3) |
| 8 | **Ad-encounter capture → memory round-trip** (observed outcome events → Personal Ad Memory through the store port; law-10 skips; idempotent writes; consent gates) — AD-004 | `apps/api/test/ad-memory-roundtrip.test.ts` (8), `ad-selection-composition.test.ts` (PG capture tests) | `controlled-local` | **NOT production-verified** (see row 3) |
| 9 | **Ad Memory + Search Ads web UX** (filters remembered/current, provenance, retention/expiry, forget, permission state, why-retrieved/why-selected, ad-vs-recommendation distinction) — AD-005 | `apps/web/test/ads-view.test.ts` (+ the AD-005 battery) over `apps/web/src/lib/ads-retrieval.ts` / `ads-view.ts` and the `/ads` routes | `controlled-local` (web view logic; the dashboard consumes the SDK) | The deployed **web surface itself** is `production-observed` healthy (200 + markers, `ad-lane-verification.md` §2.4) but its ad pages could not be exercised against the live API (row 3) |
| 10 | **Ad-lane E2E proof — BOTH frozen paths + all 11 evidence requirements + all 10 privacy laws** (deterministic, fixed clocks, no network) — AD-006 | `tests/e2e/ad-lane-e2e.test.ts` (22 tests: PATH 1 memory loop, PATH 2 contextual loop, E1–E9, L1–L10, subject scoping, contract soundness) | `controlled-local` (production composition `buildProductionServer` over real PG; SDK + real routes end-to-end) | **NOT production-verified** — the E2E class ceiling today |
| 11 | **Docs/evidence lockstep** (this matrix + the evidence appendix + the deployment verification doc stay consistent with the shipped tests/sources) — AD-006 | `tests/e2e/ad-lane-evidence-map.test.ts`, `tests/deployment/ad-lane-verification.test.ts` | `controlled-local` (doc-to-source lockstep — the `tests/deployment/verify-deployment.test.ts` precedent) | Source truth |
| 12 | **Semantic (embedding) retrieval / model-assisted query understanding** — the ADR-002 model seam | NONE by design — this deployment does deterministic LEXICAL matching only; the honest limitation is disclosed per result (`notes`: "no embedding model was consulted") and `queryUnderstanding.modelProvenance` stays unused (SDK_GAP-1) | **`fixture`-only at best — honestly NOT IMPLEMENTED** (no fake is shipped; the disclosure is the product) | No production claim; closing it requires the model-seam work (TL3 decision) |
| 13 | **Ad-lane production serving** (the API function serving `/v1/ads/*` + ad-bearing decisions over Neon) | Probe transcripts: `docs/deployment/ad-lane-verification.md` §2 | **`production-observed` — RED**: every API route (incl. frozen `/healthz`, `/readyz`) answered HTTP 500 `FUNCTION_INVOCATION_FAILED` on 2026-10-14; the S4-002 deployment gate exited 1 (api failing) | **BLOCKED** — repair is an operator/TL3 action (redeploy `reckon-api`); promotion checklist in `ad-lane-verification.md` §4 |

## Reading the matrix honestly

1. **No ad-lane capability is production-verified today.** Rows 2–10 are
   `controlled-local` at best; row 13 records the genuinely
   `production-observed` state of the production API: failing at the function
   invocation layer. Nothing in this matrix claims otherwise, and the green
   source-level battery does not override the red deployment gate
   (TL6-FINAL-HANDOFF "Deployment and production truth").
2. **The strongest available class is `controlled-local`** — the E2E suite
   (row 10) runs the real production composition (`buildProductionServer`)
   over a real PostgreSQL engine with the real SDK and real route pipeline;
   only the deployed wire and real provider channels are absent.
3. **Real provider supply (row 5) is fixture-only** — and stated as such:
   every channel in the repository's evidence is a deterministic test double
   composed at the deployment seam. No ad network, exchange or host ad
   server has ever been connected, and none is implied.
4. **Semantic retrieval (row 12) is honestly not implemented** — lexical
   matching only, disclosed per result. This is a capability-matrix row with
   no fake coverage, per the no-fabrication law.
5. Promotion of any row to `production-observed` requires the §4 checklist
   of `docs/deployment/ad-lane-verification.md` (observed outputs attached in
   the repository) — never an assumption, never a doc-only edit.
