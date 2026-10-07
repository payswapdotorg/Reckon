# Reckon Work Items

Status: initial TL3 dispatch set

| ID | Owner | Depends on | Parallel? | Acceptance |
|---|---|---|---|---|
| ARCH-001 | TL3 | none | — | architecture + lock reviewed |
| CONTRACT-001 | TL3 | ARCH-001 | — | schemas/versioning/digest rules frozen |
| ADR-001 | TL3 | ARCH-001 | — | persistence/event model frozen |
| ADR-002 | TL3 | ARCH-001 | — | model adapter boundary frozen |
| ADR-003 | TL3 | ARCH-001 | — | consent/privacy boundary frozen |
| ADR-004 | TL3 | ARCH-001 | — | runtime/research split frozen |
| W1-001 | W1 | CONTRACT-001 | yes | event ingestion contract tests |
| W1-002 | W1 | CONTRACT-001 | yes | context state tests |
| W1-003 | W1 | CONTRACT-001 | yes | preference delta tests |
| W1-004 | W1 | CONTRACT-001 | yes | feature assembly tests |
| W1-005 | W1 | W1-004 | yes | world-model input/output |
| W1-006 | W1 | W1-005 | yes | deterministic sequential simulator |
| W1-007 | W1 | W1-006 | yes | offline policy evaluation |
| W1-008 | W1 | W1-007 | yes | contextual-bandit evaluation |
| W1-009 | W1 | W1-006,W1-008 | limited | sequential RL environment |
| W1-010 | W1 | W1-009,outcomes | limited | calibration/robustness |
| W2-001 | W2 | CONTRACT-001 | yes | candidate normalization |
| W2-002 | W2 | W2-001 | yes | policy evaluation |
| W2-003 | W2 | W2-001 | yes | experience expansion |
| W2-004 | W2 | W2-001 | yes | scheduler |
| W2-005 | W2 | W2-004 | yes | switch/interruption evaluator |
| W2-006 | W2 | W1-002,W1-003 | yes | Personal Agent runtime |
| W2-007 | W2 | CONTRACT-001 | yes | Agent Body runtime |
| W2-008 | W2 | W2-007 | yes | Agent Organization runtime |
| W2-009 | W2 | W1-009,W2-008 | limited | organization search |
| W3-001 | W3 | CONTRACT-001 | yes | API skeleton |
| W3-002 | W3 | W3-001 | yes | SDK |
| W3-003 | W3 | W3-001 | yes | event/outcome transport |
| W3-004 | W3 | W3-001 | yes | observability |
| W3-005 | W3 | W2-002,W2-003 | yes | WebFlix reference adapter |
| W3-006 | W3 | W2-002,W2-003 | yes | generic media reference adapter |
| W3-007 | W3 | W2-002,W2-003 | yes | commerce reference adapter |
| W3-008 | W3 | W2-002,W2-003 | yes | advertising reference adapter |
| W3-009 | W3 | W3-005..008 | no | cross-domain E2E |
| W3-010 | W3 | W3-009 | no | performance envelope |
| W3-011 | TL3+W3 | all core | no | production-readiness evidence |

## First implementation target

The first end-to-end vertical slice should be media-neutral:

`context → candidates → experience → decision → schedule → outcome → preference delta`

Only after that slice is real should domain adapters be accepted as production-capable.

## Critical acceptance principle

A passing unit-test battery is not evidence that a real external provider path works.

Every adapter must declare:

- supported capabilities;
- unsupported capabilities;
- authorization requirements;
- rate/latency limits;
- actual live verification status;
- data/right provenance;
- failure semantics.

## Expanded roadmap (FINAL TL HANDOFF 2026-10-02)

The mission extends beyond the 36-item implementation set into a publicly usable product.
W3-011 is now a genuine production-readiness gate decomposed into P1 items; the full
sequence below extends the repository state (see `docs/handoff/FINAL-TL-HANDOFF.md`).

| ID | Owner | Depends on | Parallel? | Acceptance |
|---|---|---|---|---|
| P1-001 | W3 | W3-010 | yes | production PostgreSQL (Neon) persistence adapters per ADR-001; in-memory = test infra only |
| P1-002 | W3 | P1-001 | no | production API composition: 10 real `/v1` endpoints over real persistence |
| P1-003 | W3 | P1-001 | yes | durable outcome transport: at-least-once, idempotency, append-only, typed failures, replay |
| P1-004 | W3 | P1-002,P1-003 | no | deployment configuration: env separation, migrations, free-tier guardrails |
| UI-001 | UI | P1-002 | no | apps/web foundation (Next.js App Router + TS) consuming @reckon/sdk; no domain logic |
| UI-002 | UI | UI-001 | no | You-Platform visual system from LIVE inspection (reference artifacts committed under docs/ux/) |
| UI-003 | UI | UI-002 | yes | Overview workspace (what should happen next; full decision loop visible) |
| UI-004 | UI | UI-002 | yes | Decision workspace (context/candidates/experience/decision; no fake confidence) |
| UI-005 | UI | UI-002 | yes | Experience Plan workspace (rolling timeline: current/next/queued/opportunity/horizon) |
| UI-006 | UI | UI-002 | yes | Scheduler/interruption workspace (ranking ≠ permission to interrupt) |
| UI-007 | UI | UI-002 | yes | Agent workspace (Body + interactive Organization graph) |
| UI-008 | UI | UI-002 | yes | Research workspace (learning ladder; simulated vs observed visually distinct) |
| UI-009 | UI | UI-002 | yes | Integration workspace (capability cards; verification honesty) |
| DEPLOY-001 | TL3 | P1-004,UI-009 | no | free-tier public deployment (Vercel/Neon/Upstash/R2; optional Apify) |
| DEPLOY-002 | TL3 | DEPLOY-001 | no | public demo tenant with explicitly labeled demonstration data |
| DEPLOY-003 | TL3 | DEPLOY-002 | no | post-deploy proof (public reachability + external smoke test) |
| RELEASE-001 | TL3 | DEPLOY-003,W3-011 | no | Gates K-R reconciliation; final release evidence; implementationComplete=true |

## Productization acceptance gates (K–R)

- **Gate K — Product UI**: a user can open Reckon, understand the product, and inspect
  context → candidates → experience → decision → scheduling → outcomes without raw API tools.
- **Gate L — Real persistence**: restarting the deployment does not lose authoritative state.
- **Gate M — Public deployment**: the production URL is publicly reachable.
- **Gate N — Production smoke test**: an external client can authenticate → submit decision →
  receive decision → submit outcome → retrieve persistent evidence against the public deployment.
- **Gate O — UI quality**: visual/behavioral alignment with the You Platform reference at agreed viewports.
- **Gate P — Free-tier discipline**: documented provider quotas + demo guardrails against runaway consumption.
- **Gate Q — Operational honesty**: the UI visibly distinguishes observed / controlled-local / fixture /
  simulated / counterfactual evidence.
- **Gate R — Release**: only after K–Q may `implementationComplete` become `true`.


## Active phase: TL6 + Personal Ad Memory

The previous 65-item Stripe-phase program is complete. The active implementation phase is recorded in `docs/work-items/state.json` and `docs/handoff/TL6-FINAL-HANDOFF.md`.

| Work item | Owner | Status | Scope |
|---|---|---|---|
| TL6-001 | W3 | ✅ done | API accounts, self-service keys, sessions, tier enforcement |
| TL6-002 | W3 | ⏳ queued | Production webhook PostgreSQL stores, encrypted signing secrets, production mount, `/readyz`, hop-6 proof |
| TL6-003 | UI | ⏳ queued | Dashboard signup/login, protected routes, self-service key management |
| AD-001 | TL3 | ⏳ queued | Ad Memory architecture and canonical contracts |
| AD-002 | W1 | ⏳ queued | Personal Ad Memory persistence, retention, expiry, provenance, consent, forget |
| AD-003 | W3 | ⏳ queued | Ad retrieval API/SDK for retained/current ads |
| AD-004 | W2 | ⏳ queued | Contextual ad selection through existing decision/experience/scheduler kernels |
| AD-005 | UI | ⏳ queued | Ad Memory + Ad Query UX |
| AD-006 | TL3+W3 | ⏳ queued | Ad E2E, privacy/rights proof, production evidence and deployment verification |

`docs/work-items/state.json` is the authoritative machine-readable ledger. This table is a navigation aid and must not diverge from it.


## Reckon-Complete simulation program

Canonical specification: docs/simulations/reckon-complete-ladder.md. Machine status: docs/work-items/state.json.

| ID | Owner | Status | Scope |
|---|---|---|---|
| SIM-001 | TL3 | ⏳ queued | Define Reckon-Complete profile and common simulation harness |
| SIM-002 | W1 | ⏳ queued | Levels 1–4 simulations |
| SIM-003 | W2 | ⏳ queued | Levels 5–8 simulations |
| SIM-004 | W3 | ⏳ queued | Levels 9–12 simulations + API-only measurement |
| SIM-005 | W1 | ⏳ queued | Levels 13–16 simulations |
| SIM-006 | W2 | ⏳ queued | Levels 17–20 simulation environments and agent/runtime stress |
| SIM-007 | W3 | ⏳ queued | Cross-ladder API-only onboarding benchmark and integration-effort scorecard |
| SIM-008 | TL3+W1+W2+W3 | ⏳ queued | Upgrade common platform primitives revealed by simulations; replay ladder |

Completion is not 'all scenarios pass'. The goal is measurable reduction in host-side engineering required to reach Reckon-Complete through the public API/SDK and capability-manifest model.