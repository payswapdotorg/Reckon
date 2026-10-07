# Reckon — Final TL Handoff: TL6 Closure + Personal Ad Memory / Ad Query

## Canonical status

This file is the active Tech Lead handoff and must be read after `AGENTS.md` and before implementation work.

Authoritative repository state:

- Core platform program: 65/65 complete.
- Stripe-phase productization: complete.
- TL6-001: implemented and merged to `main` (API accounts, self-service keys, tier enforcement).
- TL6-002: queued.
- TL6-003: queued.
- Personal Ad Memory / Ad Query lane: newly approved and queued as AD-001 through AD-006.
- `docs/work-items/state.json` is the authoritative status ledger.
- This handoff is the authoritative product/implementation work order for the active TL phase.
- Chat, issue text, worker claims, screenshots, and prior handoffs are non-authoritative when they conflict with repository evidence.

Current state ledger was reconciled on 2026-10-06:
`status = tl6-active-ad-lane-roadmap`
`implementationComplete = false`

## Mission

Finish Reckon as a production-grade provider-neutral decision infrastructure platform and extend the advertising lane into a user-controlled advertising memory and retrieval product.

The platform remains:

`Item → Realization → Experience → Decision → Schedule → Outcome`

The ad lane adds:

`Ad → Ad Memory → Retrieval Query → Candidate Resolution → Decision → Experience → Schedule → Outcome`

Reckon remains the decisioning/scheduling authority inside an embedding product. It does not become an identity provider, ad network, rights authority, payment authority, creative delivery authority, or hidden second recommendation engine.

## Mandatory source-of-truth rule

The repository is the sole source of truth.

Every new decision, contract, work item, dependency, acceptance criterion, limitation, deployment fact, and evidence result must be written to the repository before it is considered part of the project.

Use these rules:

1. Architecture authority: `docs/architecture/**`.
2. Public contract authority: `packages/contracts/**` plus generated schemas.
3. Status authority: `docs/work-items/state.json`.
4. Active execution authority: this file plus the linked work-order documents it names.
5. Acceptance/release evidence: `docs/handoff/**`, deployment runbooks, and machine-verifiable scripts.
6. README/product pages may describe the product, but cannot override architecture/contracts/state.
7. Issues and chat are dispatch surfaces only; they are not the final source of truth.

Do not mark an item done from an issue comment or worker assertion alone.

## Frozen architecture

Do not change the frozen architecture without an Architecture Change Record.

Preserve:

- provider-neutral contracts;
- host-owned identity/catalog/source/rights/delivery/policy boundaries;
- fast deterministic runtime separate from research runtime;
- no required LLM in the fast path;
- Personal Agent as one logical identity with explicit cross-device permission;
- ranking separate from interruption;
- continuously revisable Experience Plans;
- Agent Bodies as capability envelopes;
- Agent Organizations as searchable graphs;
- mandatory single-agent baseline;
- constraints separate from reward;
- engagement is never a universal objective;
- simulated/counterfactual evidence never becomes observed evidence;
- rights are never inferred from availability;
- no second model router/identity/recommendation authority.

## TL6 closure

### TL6-001 — DONE

API accounts and self-service key infrastructure is implemented and merged.

Required delivered semantics include:

- signup/login/logout;
- account-scoped sessions;
- sk_test/sk_live/pk key model;
- raw key shown exactly once;
- password storage using the contract-defined secure hashing approach;
- DB-backed account/key/session persistence;
- static env keys remain first in the authentication precedence chain;
- tier-aware rate limiting;
- SDK account methods;
- typed error behavior;
- persistence migration and tests.

Do not rewrite TL6-001 unless evidence exposes a concrete defect.

### TL6-002 — NEXT

Production webhook mount.

Deliver:

- PostgreSQL-backed webhook endpoint store;
- PostgreSQL-backed webhook event store;
- PostgreSQL-backed delivery store;
- signing secrets encrypted at rest according to the existing port contract;
- migration;
- production `buildProductionServer` composition;
- `/readyz` webhook handler registration;
- Vercel/env wiring;
- lockstep journey verification;
- close the machine-verified hop-6 drift register;
- preserve at-least-once delivery, deterministic retry backoff, and terminal-never-dropped semantics.

Acceptance:

- clean-room tests green;
- production composition has the webhook handler;
- public `/readyz` advertises the wired handler;
- real public-wire webhook create/event/delivery/replay path is exercised;
- no fixture-only claim is promoted to production evidence.

### TL6-003 — NEXT

Dashboard authentication and self-service keys.

Deliver:

- signup page;
- login page;
- logout;
- session persistence;
- protected-route handling;
- progressive signup flow aligned with the product UX;
- Developers → Keys page;
- create/revoke/list key actions using the account API;
- exact-once key reveal UX;
- honest unconfigured/error/expired-session states;
- regression protection for static demo keys and test/live separation.

The dashboard remains an SDK/API consumer. It must not implement its own recommendation, ranking, policy, scheduler, or persistence authority.

## Personal Ad Memory / Ad Query product

This is a new first-class product capability built on the existing advertising adapter rather than a replacement for it.

### Product behavior

The user's Personal Agent may retain advertising experiences that the user is permitted to retain.

Later the agent can:

- recall an ad it previously encountered;
- present that ad in a contextually appropriate format;
- defer or suppress it when context/attention/constraints say it is inappropriate;
- answer explicit queries about ads;
- retrieve relevant retained ads;
- retrieve eligible current ads supplied by host/ad providers;
- compare/re-rank retrieved ad candidates through the existing Reckon decision kernel.

Examples:

- "Show me the hotel ad I saw last week."
- "What laptop ads have I seen?"
- "Find me relevant ads for hotels in Accra."
- "Show me offers for running shoes."
- "Find ads I might actually benefit from."

The user must be able to distinguish remembered ads from newly retrieved/provider-supplied ads.

### AD-001 — Architecture and contracts

Owner: TL3.

Define and freeze:

- canonical Ad Memory object;
- retention record;
- provenance record;
- permission/consent state;
- retention/expiry semantics;
- forget/deletion semantics;
- query request/result contracts;
- distinction between retained ads and newly available ads;
- observed encounter evidence versus provider-supplied availability;
- ad-specific eligibility and rights constraints.

The contracts must reuse existing `CatalogItem`, `Realization`, `Experience`, `DecisionRequest`, `OutcomeEvent`, and preference primitives wherever possible.

Do not create a parallel ad-ranking contract.

### AD-002 — Personal Ad Memory

Owner: W1.

Implement durable ad memory with:

- explicit retention;
- expiration;
- provenance;
- observed-at timestamp;
- source/advertiser/campaign/creative lineage;
- permission state;
- tenant and subject scoping;
- deterministic IDs/digests;
- idempotent writes;
- forget/delete behavior;
- separation of raw ad content from derived learning state;
- no silent retention of content merely because it was publicly observable.

Memory must never be used as permission to redistribute an ad outside the rights/host boundary.

### AD-003 — Ad retrieval API/SDK

Owner: W3.

Implement retrieval that can combine:

- lexical retrieval;
- structured filters;
- semantic retrieval;
- temporal relevance;
- contextual relevance;
- user-query intent;
- eligibility;
- rights;
- retention state;
- expiry.

The retrieval surface supplies candidates/evidence. Final selection remains the existing Reckon decision engine.

Support explicit query modes for:

- remembered ads;
- currently available ads;
- both, with provenance clearly separated.

### AD-004 — Contextual ad selection

Owner: W2.

Integrate ad candidates with existing:

`candidate → experience → decision → scheduler`

without introducing a second ad scheduler.

The kernel must be capable of choosing:

- whether an ad should be shown;
- which representation/format;
- when it should appear;
- whether to continue current experience;
- whether to queue;
- whether to suggest;
- whether to interrupt;
- whether to resume.

Interruption cost, attention state, uncertainty, constraints, and host objectives remain first-class.

An ad is not shown merely because it has high commercial value.

### AD-005 — User experience

Owner: UI.

Add an ad-memory/search experience to the existing web product.

Minimum UX:

- Ad Memory;
- Search Ads;
- filters for remembered/current;
- provenance;
- when/where encountered;
- retention/expiry;
- forget/remove;
- permission state;
- why an ad was retrieved;
- why an ad was selected/presented;
- explicit distinction between advertising and ordinary recommendations.

The visual system remains consistent with the existing You-platform-inspired Reckon UI.

### AD-006 — E2E, privacy, rights, production evidence

Owner: TL3 + W3.

Prove:

`encounter/save → retain → query/retrieve → resolve experience → decide → schedule → present → outcome`

and the contextual path:

`current context → eligible ads → retrieval → decision → correct format/timing → outcome`

Evidence must include:

- observed encounter;
- retained-memory retrieval;
- explicit forget;
- expired ad suppression;
- rights/permission denial;
- query provenance;
- current-versus-remembered distinction;
- no-fabricated engagement;
- deterministic replay;
- production capability matrix;
- deployment proof.

## Ad-memory privacy and policy laws

These are non-negotiable.

1. Retention requires an explicit permission/retention basis appropriate to the host product.
2. Forget means subsequent retrieval cannot return the forgotten ad from Personal Ad Memory.
3. Expired ads cannot be presented as currently available.
4. An ad encountered by a user is not automatically licensed for redistribution.
5. Raw location, attention, or sensitive attributes must not be silently persisted as ad targeting data.
6. The agent must never infer sensitive personal attributes merely to improve advertising.
7. User value and host-declared objectives remain separate from advertiser commercial value.
8. Advertising must remain explicitly identifiable as advertising.
9. Remembered advertising and new provider availability must carry different provenance.
10. The ad lane must use the same evidence-class rules as the rest of Reckon.

## Model/provider boundary

The fast path remains deterministic where practical.

LLMs/models may be used behind the existing model adapter seam for:

- semantic query understanding;
- semantic retrieval;
- ad-content understanding;
- research-time candidate generation.

They must not become:

- a hidden identity authority;
- a second policy engine;
- a second scheduler;
- a hidden recommendation authority;
- a bypass around frozen contracts.

Model selection remains capability/evidence-driven rather than hard-coded to a single provider.

## Work decomposition

Use concurrent work only where ownership boundaries are clean.

Suggested active workers:

- W1: AD-002.
- W2: AD-004.
- W3: TL6-002 + AD-003 + AD-006 production proof.
- UI: TL6-003 + AD-005.
- TL3: architecture/contracts, integration composition, reconciliation, acceptance, final merge/release.

Shared contract changes stay with TL3.

Workers never merge.

Every worker report must contain:

- base SHA;
- final SHA;
- owned-path diff;
- commands and exit codes;
- acceptance mapping;
- limitations;
- unresolved items;
- evidence class.

## Deployment and production truth

The four-surface product is publicly deployed, but every new TL6/ad capability must be re-proven on the actual serving surface.

Treat deployment state as evidence, not assumption.

Required deployment topology remains compatible with the approved free-tier posture:

- Vercel for web/API surfaces;
- Neon/PostgreSQL for durable authoritative state;
- Upstash Redis only for cache/rate-limit/coordination use cases where justified;
- Cloudflare R2 for large retained/generated artifacts where justified;
- Apify only behind bounded adapters and only where provider policy, authentication, rate limits, CAPTCHA, access controls and rights allow.

Do not make Upstash or object storage the authoritative source for contracts, accounts, webhook state, or Personal Ad Memory.

Re-run public smoke verification after every deployment-sensitive TL6 merge.

The current CI/deployment environment has shown Vercel build-rate-limit failures on some latest production commits. A red deployment check must never be hidden by a green source-level test battery.

## Required repository artifacts

Before declaring the phase complete, the TL must ensure the repository contains:

- this handoff;
- reconciled `docs/work-items/state.json`;
- updated work-item index;
- architecture/contract changes and ADRs where needed;
- TL6 runbook;
- Ad Memory architecture/design note;
- Ad Query contract documentation;
- production capability matrix;
- privacy/rights evidence;
- E2E proof;
- deployment proof;
- release evidence;
- limitations register.

## Completion standard

Do not set `implementationComplete=true` simply because code and unit tests are green.

The active phase is complete only when all of the following are true:

1. TL6-002 is implemented and public-wire verified.
2. TL6-003 is implemented and public-wire verified.
3. Account → key → recommendation → logs/analytics → webhook journey is externally proven.
4. AD-001 through AD-006 are implemented or explicitly reduced with repository-documented rationale.
5. Personal Ad Memory has durable, permissioned retention and forget/expiry semantics.
6. Ad Query works over retained and/or current ads with honest provenance.
7. Ad selection uses the existing Reckon decision/scheduler path.
8. Privacy, rights, evidence-class, and anti-deception laws are machine-checked where practical.
9. Production deployment is serving the tested SHA.
10. Final release evidence is updated from actual runtime observations.
11. `docs/work-items/state.json` reflects the exact completed set.
12. Repository verification, typecheck, build, tests, E2E and production smoke gates are green.
13. No unresolved production-critical gap is disguised as a completed work item.

## TL operating rule

At each merge, reconcile:

`repository files + state.json + tests + deployment evidence + work-order text`

If they disagree, stop treating the status as complete until the repository is reconciled.

The final release is a repository state, not a chat statement.


## Reckon-Complete simulation program

The next platform-upgrade program is defined in docs/simulations/reckon-complete-ladder.md and tracked in docs/work-items/state.json as SIM-001 through SIM-008.

The TL and three workers must use the ladder to discover recurring integration friction across increasingly difficult host systems. The objective is not to build twenty unrelated adapters; it is to make the common public API/SDK/capability-manifest surface increasingly sufficient so a new host can become Reckon-Complete with minimal host-side engineering.

Simulation rule: measure before changing the platform, upgrade recurring gaps at the common layer, then replay earlier levels to prove integration effort fell.

The simulation ladder is:

static catalog → content feed → e-commerce → notifications → media → ad-supported media → marketplace → travel → food delivery → mobility → social → finance → healthcare → education → B2B SaaS → enterprise workflows → multi-agent → multi-surface realtime → resource-constrained → adversarial/uncertain

The target API-only onboarding flow is:

capability manifest → connect host authorities → declare objectives/constraints/delivery capabilities → standard API/SDK → receive decisions/experiences/plans/actions → return outcomes → retrieve evidence → conformance → Reckon-Complete

The host must not import Reckon internals, and host-owned identity/catalog/rights/delivery/policy remain outside Reckon.

Use the simulation program to drive actual platform upgrades. Do not declare a system Reckon-Complete because the scenario passes with fixtures; completion requires the relevant evidence class and public-surface verification required by the profile.