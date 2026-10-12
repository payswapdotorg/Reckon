# @reckon/web — Reckon Studio (UI-001 + UI-002 + UI-004 + S3-001 + S3-002 + TL6-003)

The product UI for Reckon: a Next.js (App Router, TypeScript strict) shell
that consumes **`@reckon/sdk` + `@reckon/contracts` only** — it is a
consumer of Reckon, never a second source of domain truth (FINAL TL
HANDOFF §29).

The first wave (UI-001 + UI-002) delivered the **foundation**: app shell,
design system, the seven workspace routes with honest empty states, and the
evidence-class badge vocabulary (Gate Q prep). UI-003 (Overview), UI-004
(Decisions) and UI-005 (Plans) are live workspaces on that foundation.
**S3-001 delivered the dashboard shell** — the operator face of the S2-001
hardened API: the dashboard nav IA, the Developers surfaces (API keys,
request logs, events console) and the account-level test/live toggle.
**S3-002 delivered the analytics views** — CTR lift, latency percentiles,
drift indicators and the decision-loop funnel on `/analytics`.
**TL6-003 delivered dashboard authentication + self-service keys** —
signup/login/logout, httpOnly session persistence, protected routes and
the Developers → Keys surface rewired to the account API
(`/v1/account/**`, TL6-001).

## Information architecture (S3-001)

The sidebar rail now carries the dashboard IA first, the foundation studio
workspaces below it (same hrefs as UI-001 — no route moved):

```
(landing)   Home                      /
OPERATE     Recommendations           /recommendations   (placeholder — dashboard backend)
            Models                    /models            (placeholder — dashboard backend)
            Data Sources              /data-sources      (placeholder — dashboard backend)
            Analytics                 /analytics         (S3-002 views)
            Ads                       /ads               (AD-005 Ad Query — both lanes, provenance)
              Remembered ads          /ads/remembered    (AD-005 remembered-lane browser)
              Current ads             /ads/available     (AD-005 provider-supplied lane)
              Consent                 /ads/consent       (AD-005 retain/present grants + forget)
              Retention               /ads/retention     (AD-005 retention + bulk forget)
              Compare                 /ads/compare       (AD-005 kernel re-rank, before/after)
DEVELOPERS  Developers                /developers        (live surface states)
              API keys                /developers/keys   (key manager)
              Request logs            /developers/logs   (cursor pagination)
              Events                  /developers/events (S2-002 console)
BUILD       Decisions · Plans · Scheduler               (UI-004/005 workspaces)
INTELLIGENCE Agents · Research
INTEGRATE   Integrations
ACCOUNT     Settings                  /settings          (placeholder)
```

- **Ads** (`/ads`, AD-005): the Personal Ad Memory + Ad Query product
  surface over the frozen ad lane (AD-001..AD-004): query your ad
  memory in plain language, browse remembered ads and provider-supplied
  supply in SEPARATE lanes with distinct provenance (law 9), inspect a
  record's full evidence trail (`/ads/records/{recordId}` — reached
  from ad cards, not the nav), manage consent (retain/present grants +
  terminal forget), manage retention (basis/expiry + per-ad and bulk
  forget), and compare the retrieval order against the decision
  kernel's re-rank with its defer/present/suppress reasons. All ad data
  flows through the SDK seam (`POST /v1/ads/query`,
  `POST /v1/ads/forget`, `/v1/decisions`, `/v1/experiences/resolve`);
  the forget mutation rides the studio proxy
  (`POST /api/dashboard/ads/forget`). Scope:
  `RECKON_DEMO_TENANT_ID` (default "demo") + `RECKON_DEMO_SUBJECT_REF`
  (default "demo-user"). UX notes: `docs/ux/ad-005-ux.md`.

- **Home** (`/`): account status strip (live `/healthz` probe + account
  mode badge + quick links), the "Serve your first recommendation"
  onboarding card (ties to the docs quickstart — `RECKON_DOCS_BASE_URL`,
  default `https://docs.reckon.dev`), then the UI-003 overview surfaces
  (next action, decision activity, loop signals, system status).
- **Placeholder sections** render the honest empty state plus
  **related live surfaces** links (registry `relatedHrefs`) — e.g.
  Recommendations links into Decisions/Plans/Scheduler.
- **Breadcrumbs** render the full parent chain (`Reckon Studio >
  Developers > API keys`); the command palette lists every route.

## Developers surfaces (S3-001 + TL6-003) — honest degradation by design

The S2-001 API hardened the core surface, but the developer-platform
management routes are **not wired yet** (S2-002/S2-003 land them). The
dashboard therefore ATTEMPTS each pending route server-side and renders
exactly what was observed (`src/lib/developers-api.ts` — pure, tested;
`src/lib/developers-surface.ts` — server-only composition):

| Surface | Pending routes | Behavior until wired |
|---|---|---|
| API keys | **moved to the ACCOUNT lane (TL6-003)** — `/v1/account/**`, session-authenticated | sign-in-gated key manager: mint/revoke/list over the real account API; the once-only reveal; live-mode revoke confirm |
| Request logs | `GET /v1/request-logs` | not-wired callout; cursor controls ready (S2-001 envelope) |
| Events | `GET /v1/events`, `POST /v1/events/{id}/replay` | not-wired callout; replay renders as a disabled placeholder; planned S2-002 catalog shown as labeled roadmap |

Demo-lane outcome kinds: `ok`, `unconfigured` (no demo key),
`unreachable`, `not-wired` (404/501 — pending route named verbatim),
`error`. When the real routes land, the same attempts return `ok` and
the surfaces light up with zero UI changes.

## Dashboard authentication + self-service keys (TL6-003)

The account lane (TL6-001's `/v1/account/**` family) is session-authenticated.
The studio consumes it through its own server proxies — the browser never
talks to the API directly:

| Piece | Where | Law |
|---|---|---|
| Pure account client | `src/lib/account-api.ts` | typed outcomes (`ok`/`unauthenticated`/`unreachable`/`not-wired`/`error`), request pre-flight + response validation against the FROZEN `@reckon/contracts` schemas; injectable fetch; carries ONLY the reckonsess_ bearer |
| Server session seam | `src/lib/account-surface.ts` | `server-only`; httpOnly cookie `reckon_studio_session` (maxAge mirrors the contract's `SESSION_TTL_MS`); display-safe metadata cookie; strict parsing (malformed ⇒ signed-out) |
| Auth proxies | `src/app/api/dashboard/account/{signup,login,logout,expire}/route.ts` | real API attempts; cookies written only on observed success; logout keeps cookies on failure (no fake sign-out) |
| Keys proxies | `src/app/api/dashboard/keys{,/[keyId]}/route.ts` | mint/revoke with the cookie's session; 401 clears the lying cookies |
| Auth pages | `/login`, `/signup` | progressive two-step signup; sanitized `next` (open-redirect guard); honest notices (signin/expired/signed-out) |
| Keys page | `/developers/keys` | protected route (no session ⇒ `/login?next=…&reason=signin`); observed 401 exits via the expire handler |

**The session token is never rendered.** Signup/login's show-once token
moves server-side straight into the httpOnly cookie — there is no copy-it
step to get wrong. The shell (sidebar footer, Home status strip, Settings)
renders only display-safe metadata (email, fullName, tier).

**The once-only key reveal:** the mint flow's state machine
(`src/lib/api-keys-view.ts`, pure + tested) holds the RAW key in exactly
one state (`created`); acknowledging or closing discards it — the stored
summary carries no fragment (not even a prefix); no transition re-enters
`created`. Account keys are unnamed (the frozen mint contract is
`{ kind, mode }` — the dialog says so honestly).

Full UX notes: `docs/ux/tl6-003-dashboard-auth.md` (incl. the recorded
API_GAP — no session-introspection route — and the standalone-auth-layout
platform-upgrade candidate).

## Test/live toggle (S3-001)

The account-level segmented control at the top of the sidebar
(`shell/mode-toggle.tsx`), wired to the pure mode machine
(`src/lib/mode-machine.ts`, fully tested):

- **test → live** requires an explicit confirm ("you are about to operate
  on real account data");
- **live → test** is immediate (the safe direction);
- **destructive actions** (revoke key) are armed immediately in test mode
  and confirm-gated in live mode;
- **one pending dialog at a time** — a new request replaces whatever was
  pending;
- mode indicators across the shell (toggle, header badge, sidebar footer,
  key mode chips) recolor with the mode semantics: live = the primary
  emerald `#009768`, test = the palette's chart-2 amber `#dc8b18` — no new
  hues (single-accent law holds);
- persistence is **local** (`localStorage`, `reckon.studio.dashboard-mode`)
  and request routing does not change yet — the honest placeholder is
  stated in the toggle's caption and the switch confirm; API-side
  test-mode semantics land with S2-003.

## Analytics views (S3-002)

`/analytics` composes four views, each = card + chart/table + evidence
class, computed by PURE modules over the REAL outcome/decision records the
API exposes (`src/lib/analytics-{ctr-lift,latency,drift,funnel}.ts` —
pure, tested, fetch-injectable; `src/lib/analytics-surface.ts` — the
server-only seam). Charts are CSS primitives — no external chart library
(dependency discipline holds).

| View | Computes | Data source (pending routes named verbatim until wired) |
|---|---|---|
| CTR lift | Exposure-grouped CTR (decision → impression linkage), click-through set (`start`/`conversion`/`purchase`), Wilson 95% CIs, lift sign/magnitude + the confidence caveat rendering model | `GET /v1/decisions`, `GET /v1/outcomes` |
| Decision latency | Nearest-rank p50/p95/p99 over `POST /v1/decisions` request-log rows, frozen bucket histogram, honest `n=` counts, per-mode evidence from key prefixes | `GET /v1/request-logs` |
| Drift indicators | Per-model cards from the `model.drift.detected` events feed (the S2-002 thin-event payload), severity mapping (over threshold / approaching ≥ 80% / within), latest evaluation wins | `GET /v1/events` |
| Decision loop funnel | decisions → linked outcomes → preference-delta stage mapping with subject-level linkage (stated as correlational) | `GET /v1/decisions`, `GET /v1/outcomes`, `GET /v1/preferences/events` |

Honesty laws specific to analytics:

- **Evidence partition (frozen contracts):** research-class outcomes
  (`fixture`/`simulated`/`counterfactual`) are counted and reported but
  EXCLUDED from every rate; observed classes
  (`production-observed`/`staging`/`controlled-local`) are the only
  production evidence. Unlinked outcomes (no `decisionId`) are likewise
  counted and excluded.
- **Nulls, never zeros:** empty groups, zero denominators and missing
  baselines yield NULL rates rendered as "not computable" — the platform
  never fabricates significance. Every caveat is a deterministic function
  of the result (observational comparison, small sample, exclusions).
- **Mode awareness:** request-log rows carry the key prefix, so test-key
  traffic (`sk_test_`/`pk_test_`) renders with the TEST chip (test
  evidence) and live-key traffic with LIVE — per-record mode evidence,
  labeled as such. The account toggle itself is local/visual (S3-001
  placeholder); the mode note on `/analytics` states exactly that.
- A failed surface renders the S3-001 not-wired callout naming its
  pending route — when the route lands, the same attempt returns `ok`
  and the view lights up with zero UI changes.

## Laws (violations void the delivery)

- consumes `@reckon/sdk` + `@reckon/contracts` types ONLY (the two
  additions: the developer-platform surfaces and the account/session
  lane attempt the API's own public routes server-side, exactly like the
  `/healthz` probe precedent — the account lane validates against the
  FROZEN contract schemas, never a parallel wire model);
- never imports `@reckon/persistence` internals or any package's internal
  modules (guarded by `test/workspace.test.ts`);
- never touches a database; never reimplements decision/policy/evaluation
  logic; no second scheduler, model router, or recommendation engine;
- the two credential lanes never cross: the demo/static-key lane
  (`RECKON_DEMO_API_KEY`) rides the operator data surfaces only; the
  account lane (`reckonsess_`, httpOnly cookie) rides signup/login/logout
  and self-service key management only (guarded by
  `test/workspace.test.ts`);
- the reckonsess_ session token and minted key secrets never reach a
  client bundle as executable state (httpOnly cookie; once-only mint
  machine — guarded by `test/workspace.test.ts`);
- new code lives only under `apps/web/**` (+ lockfile);
- honest states only (Gate Q): the studio renders real backend state or
  says precisely what is missing — never fabricated data.

## Design language

`docs/ux/you-platform-reference.md` is the source of truth (S3-001
additions documented in `docs/ux/dashboard-shell.md`). Tokens live in
`src/app/globals.css` (CSS custom properties, exact §3 palette); the typed
mirror is `src/lib/design-tokens.ts`. Both are asserted against the
reference by `test/design-tokens.test.ts`. Base components:
`src/components/ui/` (Card, Button, Badge, SearchInput, SidebarNav,
EvidenceClassBadge). Shell: `src/components/shell/` (AppShell, Sidebar,
SiteHeader, CommandPalette, NavDrawerProvider, ModeProvider, ModeToggle,
ModeBadge). Developers: `src/components/developers/`. Home:
`src/components/home/`.

## Environment (server-side only — no secret reaches a client bundle)

| Variable | Default | Purpose |
|---|---|---|
| `RECKON_API_BASE_URL` | `http://127.0.0.1:8080` | API origin the studio points at |
| `RECKON_DEMO_API_KEY` | — | Bearer key for the demo tenant (**secret**, server-only) |
| `RECKON_ENV` | from `NODE_ENV` | Honest environment label for the `ENV:` badge |
| `RECKON_DOCS_BASE_URL` | `https://docs.reckon.dev` | Docs portal origin for the quickstart link (non-secret) |
| `RECKON_DEMO_TENANT_ID` | `demo` | Ad-lane tenant the Ads section queries for (non-secret, display-safe) |
| `RECKON_DEMO_SUBJECT_REF` | `demo-user` | Ad-lane subject whose Personal Ad Memory the Ads section browses (non-secret, display-safe) |

`src/lib/reckon-client.ts` is guarded by `import "server-only"`: any
accidental client import fails the build. Display helpers expose only
non-secrets (origin, booleans, labels). If a public demo value is ever
needed it must use an explicitly non-secret `NEXT_PUBLIC_RECKON_DEMO_*`
name — none exist today.

## Scripts

```bash
pnpm --filter @reckon/web build   # builds @reckon/contracts first, then next build
pnpm --filter @reckon/web dev     # next dev (http://localhost:3000)
pnpm --filter @reckon/web start   # next start (production server)
pnpm test                         # repo battery picks up apps/web/test/*
```

`next build` typechecks the whole app module tree (the app tsconfig covers
`src/**`); the root `pnpm typecheck` covers `apps/web/test/**` under the
repo-wide NodeNext config — the same split every other workspace package
uses.

## Status / limitations (this wave)

- **Dashboard authentication + self-service keys (TL6-003) are live**:
  `/signup` (progressive two-step), `/login`, sign-out, httpOnly session
  persistence, protected-route handling on `/developers/keys`, and the
  account-key manager (mint with the exact-once reveal, revoke with
  live-mode confirm, metadata-only list) over the real `/v1/account/**`
  family. Sessions require the API's account surface (TL6-001) to be
  mounted — the honest not-wired state names the route when it is not.
- **The dashboard shell (S3-001) is live**: the nav IA, the Developers
  section (keys/logs/events with honest not-wired states naming the
  pending routes), the test/live toggle with confirm gating, and the Home
  overview (status + quick links + onboarding).
- **The analytics views (S3-002) are live**: `/analytics` renders the four
  views (CTR lift, decision latency, drift indicators, decision-loop
  funnel) computed by pure modules over real trail records; the trail
  reads (`GET /v1/decisions`, `GET /v1/outcomes`,
  `GET /v1/preferences/events`, `GET /v1/request-logs`, `GET /v1/events`)
  are pending on the API side, so today each view shows its honest
  not-wired state naming the route — they light up with zero UI changes
  when the routes land.
- **Decisions (UI-004) is live**: the `/decisions` workspace retrieves one
  decision by id through the SDK seam and renders the full record; a plain
  GET form performs the lookup (shareable, JS-optional).
- The other foundation routes render titled honest empty states; the
  Overview/Home keeps the system status card with a real server-side
  `/healthz` probe and the five-class evidence badge demo.
- The remaining dashboard placeholder sections (Recommendations, Models,
  Data Sources, Settings) state precisely what lands next (the dashboard
  backend waves) and link the related live workspaces; Analytics is live
  as of S3-002.
- The developer-platform API routes are pending (S2-002/S2-003): the
  surfaces attempt them for real and report the observed state — they will
  light up without UI changes when the routes land.
- The command palette lists the real workspace routes (no fabricated
  search results).
- No theme toggle: the captured reference is the light shell with the dark
  rail; dark mode is not part of this wave.

## REDEPLOY-002b (stripe phase, 2026-10-05 23:2xZ)

Production deploy note (Lead): same as apps/api REDEPLOY-002b — the deployed
dashboard ran the pre-stripe-phase shell (title "Overview", DEPLOY-002-era
routes; S5-003 drift register web-2: S3-001 nav IA absent, no docs link).
This note triggers the git-path production redeploy of current main (67b9b7b)
so the shell matches the frozen surface (WORKSPACE_ROUTES nav IA + the
S1-004 onboarding card's docs quickstart link).

## REDEPLOY-002c (2026-10-05 23:32Z)

Git-path production redeploy trigger (Lead): main 7d5d84d carries the full
stripe-phase + TL5 tree; reckon-api redeployed live 23:29Z (verified: webhook
family 401, typed envelopes with class/doc_url). This touch re-arms the
reckon-web change-detection for its production redeploy (the S3-001 nav IA
+ S1-004 docs-link shell).
