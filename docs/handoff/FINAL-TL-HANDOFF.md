# RECKON — FINAL TL HANDOFF (received 2026-10-02)

> Source: operator handoff delivered via the operator thread, 2026-10-02.
> All provider credentials referenced below live in the operator vault
> (`/home/z/.secrets/env` on the orchestration host) — never in this repository.
> Where the original text included a literal secret, it is replaced here by
> `[vault:NAME]`.

**Repository:** `payswapdotorg/Reckon`
**Branch at receipt:** `main`
**Head at receipt:** `235db561ef68edc3502d6019b7e6468744e3e0f9`
**Recorded status at receipt:** 35/36 work items; `implementationComplete: false`

---

## 1. Mission

Complete Reckon from its current 35/36 implementation state into a publicly usable
product while preserving the frozen architecture.

The final product must demonstrate:

```text
host state/context
      ↓
candidate universe
      ↓
experience resolution
      ↓
decision
      ↓
schedule / switch / interruption
      ↓
outcome
      ↓
learning / calibration
```

and expose that capability through:

```text
API + SDK
      +
usable product UI
      +
public deployment
      +
production persistence
      +
real operational evidence
```

The repository remains the sole source of truth.

Do not rely on chat claims, prior worker reports, screenshots, or historical
test-count claims without reconciling them against the repository.

---

## 2. Architecture remains frozen

Do NOT redesign the core architecture.

Authoritative chain:

```text
Item → Realization → Experience → Decision → Schedule → Outcome → Learning
```

Runtime split:

```text
FAST RUNTIME                    RESEARCH RUNTIME
─────────────                   ────────────────
Context                         World Model
Candidates                      Simulation
Experience                      Offline Evaluation
Decision                        Bandits / OPE
Scheduler                       Policy Learning
Outcome                         Sequential RL
                                Organization Search
                                Robustness
                                Calibration
```

The fast path must remain correct without an LLM.

The host remains authoritative for: identity; consent; catalog/source truth; rights;
entitlement; delivery/playback; payments; host policy.

Reckon remains provider-neutral.

Never introduce a second model router.
Never make provider-specific branches in the decision kernel.
Never turn simulated/counterfactual evidence into observed evidence.

---

## 3. Current implementation state

All of TL3 (ARCH-001, CONTRACT-001, ADR-001..004), W1-001..010, W2-001..009 and
W3-001..010 are implemented and merged (35/36). W3-011 is the sole recorded
unfinished work item at receipt.

---

## 4. Immediate priority — W3-011

Finish W3-011 as a genuine production-readiness gate. Do not simply flip the state
to `done`. W3-011 must prove:

```text
contracts → production persistence → runtime composition →
authentication / tenant isolation → observability → deployment →
real external capability → measured behavior → operational readiness
```

### Persistence

Implement the production PostgreSQL-compatible persistence adapters required by
ADR-001. Target: Neon PostgreSQL → persistent Reckon state. At minimum, production
persistence must cover the authoritative state needed for: decisions; plans;
catalog/realization state; outcomes/events; preferences/learning state; idempotency
where persistence is required; relevant research/job metadata. The existing
in-memory adapters remain test infrastructure only. No hidden in-memory production
authority.

### Outcome transport

Move the production outcome path from test-only storage/journaling to durable
infrastructure. Preserve: at-least-once semantics; idempotency; append-only
evidence; typed failures; deterministic replay semantics.

### Production API composition

Replace the current NotWired production composition with actual runtime handlers:

```text
POST /v1/decisions
POST /v1/outcomes
POST /v1/preferences/events
POST /v1/plans
POST /v1/plans/{id}/replan
POST /v1/catalog/items
POST /v1/catalog/realizations
POST /v1/candidates
POST /v1/experiences/resolve
GET  /v1/decisions/{id}
```

using real persistence.

### Authentication and tenant isolation

Implement production-safe authentication while preserving the existing tenant
contract. Do not replace host identity authority. Reckon authenticates API access;
the host remains the subject identity authority.

### Observability

Production observability must report at least: request id; tenant; decision id;
policy/version; action; uncertainty; latency; cost; scheduler action; outcome
linkage; integration capability; failure; evidence class.

---

## 5. Public product UI — REQUIRED NEW PRODUCT SURFACE

Add a new UI application, preferably `apps/web/`, using Next.js App Router and
TypeScript. The UI is not allowed to become a second source of truth for Reckon
logic. It is a product shell over the existing API/SDK/contracts.

---

## 6. UX direction — You Platform reference

The deployed product must be redesigned to **look and feel like
`https://you-platform.vercel.app`**. Treat the live site as the
visual/interaction reference. Reconstruct its design language: visual hierarchy,
spacing rhythm, card treatment, navigation behavior, typography hierarchy, button
language, input language, panel composition, motion, empty states, loading states,
micro-interactions, responsive behavior, information density.

Do not copy unrelated content, branding, proprietary assets, or
application-specific semantics.

Because worker environments cannot retrieve the site, the TL must perform the live
visual inspection before implementation and the work item must include: reference
screenshot(s); reference viewport(s); reference interaction notes; derived design
tokens; implemented comparison screenshots. Final acceptance should include a
visual comparison against the live reference.

---

## 7. Reckon UI information architecture

Primary navigation (actual arrangement follows the You Platform visual language):

```text
RECKON
├── Overview
├── Decisions
├── Experiences
├── Plans
├── Outcomes
├── Personalization
├── Agents
├── Research
├── Integrations
└── Settings
```

---

## 8. Overview screen

The landing dashboard should immediately communicate what Reckon does. Primary
content: WHAT SHOULD HAPPEN NEXT? plus current decision activity, active plans,
recent outcomes, policy performance, decision latency, connected integrations,
learning state, research experiments. Avoid a generic admin dashboard. The product
should feel like an intelligent decision system, not a database console.

---

## 9. Decision workspace

First-class interactive decision view: Current Context (device · objective ·
attention · session); CURRENT EXPERIENCE; Candidate/Experience options vs
Decision (ACTION: SWITCH, confidence, policy). Show: why an experience is eligible;
why alternatives were excluded; uncertainty; objective fit; constraints;
switching/interruption cost; schedule consequences. Never expose fake confidence.

---

## 10. Experience planner UI

Rolling timeline: NOW → CURRENT → NEXT → QUEUED → OPPORTUNITY → FUTURE HORIZON.
Users see: current experience; queued experiences; planned alternatives; replan
triggers; interruption boundaries; resume checkpoints. A media auto-playlist is
one possible use of the generic planner, not the product's conceptual center.

---

## 11. Scheduler / interruption UX

Expose the separation between RANKING vs SWITCHING vs INTERRUPTION, e.g.:

```text
Candidate score:        0.87
Expected improvement:   0.34
Interruption cost:      0.18
Resume loss:            0.07
Uncertainty penalty:    0.04
--------------------------------
Net switching value:    0.05
```

Then clearly show HOLD / SUGGEST / SWITCH / INTERRUPT / RESUME. The UI must make
it obvious that a better-ranked candidate does not automatically interrupt the
current experience.

---

## 12. Agent workspace

Expose Agent Body (ROLE, MODEL ASSIGNMENT, TOOLS, OBSERVATIONS, MEMORY,
PERMISSIONS, BUDGET, LATENCY, EVALUATOR) and Agent Organization as an interactive
graph (Generalist → Researcher/Planner → Critic). Show: communication edges;
delegation; status; budget; latency; failures; lineage; baseline comparison.

---

## 13. Research workspace

Expose the learning ladder (Supervised → Contextual Bandits/OPE → Offline Policy
Learning → Sequential Simulation → RL → Organization Search → Bounded Live
Evaluation → Calibration). For every experiment expose: seed; world-model version;
policy; objective; reward; constraints; evidence class; performance; robustness;
calibration; baseline; artifacts. Simulation/counterfactual evidence must always
be visually differentiated from observed evidence.

---

## 14. Integration workspace

Each adapter gets a capability card (catalog import, candidate mapping, context
mapping, objective mapping, scheduling intent, outcome mapping, preference
mapping; live provider verification status; evidence class). Do not display a
provider as "connected" merely because the mapper exists. Must align with the
existing adapter declarations.

---

## 15. Responsive/public product requirement

The UI must support desktop, tablet, mobile. The public application must not
depend on the API application being rendered as the UI. Recommended architecture:

```text
apps/web → @reckon/sdk → apps/api → Reckon packages
```

---

## 16. Public deployment architecture

Deploy publicly using free-tier infrastructure wherever practical:

```text
VERCEL (apps-web + API routes)
   → NEON (PostgreSQL) · UPSTASH (Redis) · R2 (object storage)
      → APIFY (optional research / external data acquisition)
```

---

## 17. Vercel

Hobby plan allowances: 1M invocations/month, 4 active CPU hours/month, 360
GB-hours provisioned memory; automatic HTTPS; Git integration; preview
deployments; one concurrent build; 100 deployments/day. Design within the
free-tier limits. Use main → preview deployment → verification → production
deployment. Prefer prebuilt deployment in CI where appropriate. Pin the Vercel
CLI version used in automation.

---

## 18. Neon

Neon Free per project: 50 CU-hours/month; 0.5 GB storage; 5 GB egress/month;
scale-to-zero; 10 projects; 10 branches/project. Keep the initial deployment
intentionally compact. One primary Reckon database; separate logical areas through
schema/table boundaries. `DATABASE_URL` through environment configuration only.
No credentials in Git.

---

## 19. Upstash Redis

Use for: cache; rate-limiting state; short-lived session/control state; lightweight
distributed coordination; optional research job coordination. Upstash Free: 256 MB
data; 500,000 commands/month; 10 GB monthly bandwidth. Do NOT use Redis as the
authoritative Reckon state — PostgreSQL remains the durable authority. Redis
exhaustion or failure must not corrupt durable state.

---

## 20. Cloudflare R2

R2 Standard free allowance: 10 GB-month storage; 1M Class A ops/month; 10M Class B
ops/month; free egress. Good candidates: simulation artifacts; model/evaluation
artifacts; research exports; large JSON/CSV artifacts; generated reports;
non-sensitive public demo assets. Keep metadata and lineage in Neon. Do not use
R2 as an implicit database.

---

## 21. Apify

Apify only where external data acquisition is actually needed. Free: $5/month
platform/store usage; ~$0.20/CU compute; no credit card required. Apify stays
behind a narrow integration boundary. Never bypass authentication, CAPTCHA,
provider security, access controls, rate limits, geo restrictions, robots or
provider policies. Not a hard dependency of the core runtime.

---

## 22. Deployment environment separation

development / preview / production with separate environment variables. Minimum
production config: DATABASE_URL, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN,
R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, APIFY_API_TOKEN,
RECKON_API_KEY / signing configuration. Only the variables actually required by
the deployed architecture. Secrets never enter repository files.

---

## 23. Free-tier resilience

The application must degrade honestly: Redis unavailable → durable DB path /
reduced caching; R2 unavailable → metadata path remains; Apify unavailable →
integration marked unavailable, core decisioning continues; research worker
unavailable → fast runtime remains operational. No external service failure may
silently fabricate data.

---

## 24. CI/CD

PR: install → verify-repo → typecheck → build → unit tests → E2E → performance
regression → preview deploy. Production: main → CI → production build → migration
verification → deployment → smoke test → post-deploy verification. Do not deploy a
failed build. No destructive migrations without explicit migration safety.

---

## 25. Production database migrations

new migration → validate locally → apply preview DB → run tests → apply production
DB → deploy/promote. Backward compatible where deployment sequencing requires.
Never couple a breaking schema migration and application deployment into an
unverified single step.

---

## 26. Public domain / URLs

Public Vercel deployment for the Reckon web application; API via `api.<domain>` or
a stable API route under the public application domain. Record the actual deployed
URLs in the repository.

---

## 27. Public demo mode

Safe public demo tenant with explicitly labeled demonstration data (example media
catalog, commerce catalog, advertising inventory, contexts, decisions, plans,
outcomes, agent organizations). Demo data must never be presented as real customer
data. Use fixture / controlled-local evidence labels consistently.

---

## 28. Work-item sequence

```text
W3-011 → P1-001..P1-004 → UI-001 → UI-002..UI-009 → DEPLOY-001 →
DEPLOY-002 → DEPLOY-003 → RELEASE-001
```

Mirrored in `docs/work-items/state.json` and `docs/work-items/index.md`.

---

## 29. UI work must not fork the architecture

The UI must consume `@reckon/contracts` + `@reckon/sdk` and must not: import
persistence internals; directly mutate database tables; reproduce decision logic;
create a second scheduler; create a second model router; create a separate
recommendation engine. The UI is a consumer of Reckon.

---

## 30. Acceptance gates K–R

(Product UI; Real persistence; Public deployment; Production smoke test; UI
quality; Free-tier discipline; Operational honesty; Release.) Full text mirrored
in `docs/work-items/index.md` § "Productization acceptance gates (K–R)".

---

## 31. Required verification artifacts

```text
docs/
├── deployment/ (architecture.md, environment.md, migrations.md, runbook.md, free-tier-guardrails.md)
├── ux/ (you-platform-reference.md, design-system.md, acceptance.md)
└── handoff/final-release-evidence.md
```

Final release evidence must state: commit; deployment URL; framework; database;
cache; object store; external integrations; migration state; test commands;
test results; smoke-test results; performance results; known limitations;
provider evidence class; free-tier assumptions.

---

## 32. Final TL operating rules

1. preserve the architecture lock; 2. repo as sole source of truth; 3. reconcile
actual code against every claimed completion; 4. keep workers isolated by owned
paths; 5. own shared contracts and composition; 6. never accept fixture evidence
as production evidence; 7. never claim provider integration is live without real
authorization and observed behavior; 8. never allow UI code to become domain
authority; 9. never introduce a second model router; 10. never equate a high
ranking score with permission to interrupt; 11. never equate simulation
superiority with real-world superiority; 12. keep the public application usable by
a person who has never read Reckon's architecture documents.

---

## 33. End state

```text
RECKON → WEB UI + API/SDK → RECKON RUNTIME
   (Decision · Scheduler · Personal Agent) → Agent Runtime
   (Fast Path | Research Path: simulation/evaluation/RL/org-search/calibration)
   → Persistence (Neon · Upstash · R2 · optional Apify)
```

The final product should no longer feel like "an API implementation with test
infrastructure" — it should feel like a real decision-infrastructure product:

```text
CONTEXT → WHAT COULD HAPPEN? → WHAT SHOULD HAPPEN? → WHEN SHOULD IT HAPPEN? →
SHOULD WE INTERRUPT? → WHAT HAPPENED? → WHAT LEARNED? → WHAT NEXT?
```

That is the release bar.

---

## Provider credentials (vault references only)

| Provider | Reference |
|---|---|
| GitHub (payswap PAT) | `[vault:GITHUB_PAT]` |
| Composio | `[vault:COMPOSIO_API_KEY]`, `[vault:COMPOSIO_MCP_API_KEY]` |
| Neon | `[vault:NEON_API_KEY_1]`, `[vault:NEON_API_KEY_2]` |
| OpenRouter | `[vault:OPENROUTER_API_KEY]` |
| Vercel | `[vault:VERCEL_TOKEN]` |
| E2B | `[vault:E2B_API_KEY]` |
| Apify | `[vault:APIFY_API_TOKEN]` |
| Upstash | `[vault:UPSTASH_REDIS_REST_URL]`, `[vault:UPSTASH_REDIS_REST_TOKEN]` |
| Cloudflare R2 | `[vault:CLOUDFLARE_ACCOUNT_ID]`, `[vault:R2_*]` |
| Alibaba/Model cloud | `[vault:ALIBABA_API_KEY]` |
| LiveKit | `[vault:LIVEKIT_*]` |
| Resend | `[vault:RESEND_API_KEY]` |
