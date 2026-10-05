# @reckon/web — Reckon Studio (UI-001 + UI-002 + UI-004 + S3-001)

The product UI for Reckon: a Next.js (App Router, TypeScript strict) shell
that consumes **`@reckon/sdk` only** — it is a consumer of Reckon, never a
second source of domain truth (FINAL TL HANDOFF §29).

The first wave (UI-001 + UI-002) delivered the **foundation**: app shell,
design system, the seven workspace routes with honest empty states, and the
evidence-class badge vocabulary (Gate Q prep). UI-003 (Overview), UI-004
(Decisions) and UI-005 (Plans) are live workspaces on that foundation.
**S3-001 delivered the dashboard shell** — the operator face of the S2-001
hardened API: the dashboard nav IA, the Developers surfaces (API keys,
request logs, events console) and the account-level test/live toggle.

## Information architecture (S3-001)

The sidebar rail now carries the dashboard IA first, the foundation studio
workspaces below it (same hrefs as UI-001 — no route moved):

```
(landing)   Home                      /
OPERATE     Recommendations           /recommendations   (placeholder — dashboard backend)
            Models                    /models            (placeholder — dashboard backend)
            Data Sources              /data-sources      (placeholder — dashboard backend)
            Analytics                 /analytics         (placeholder — S3-002)
DEVELOPERS  Developers                /developers        (live surface states)
              API keys                /developers/keys   (key manager)
              Request logs            /developers/logs   (cursor pagination)
              Events                  /developers/events (S2-002 console)
BUILD       Decisions · Plans · Scheduler               (UI-004/005 workspaces)
INTELLIGENCE Agents · Research
INTEGRATE   Integrations
ACCOUNT     Settings                  /settings          (placeholder)
```

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

## Developers surfaces (S3-001) — honest degradation by design

The S2-001 API hardened the core surface, but the developer-platform
management routes are **not wired yet** (S2-002/S2-003 land them). The
dashboard therefore ATTEMPTS each pending route server-side and renders
exactly what was observed (`src/lib/developers-api.ts` — pure, tested;
`src/lib/developers-surface.ts` — server-only composition):

| Surface | Pending routes | Behavior until wired |
|---|---|---|
| API keys | `GET/POST /v1/api-keys`, `DELETE /v1/api-keys/{id}` | not-wired callout naming the route; create/revoke flows report the observed outcome — never a fake success |
| Request logs | `GET /v1/request-logs` | not-wired callout; cursor controls ready (S2-001 envelope) |
| Events | `GET /v1/events`, `POST /v1/events/{id}/replay` | not-wired callout; replay renders as a disabled placeholder; planned S2-002 catalog shown as labeled roadmap |

Outcome kinds: `ok` (data flows), `unconfigured` (no demo key),
`unreachable` (observed network failure), `not-wired` (404/501 — pending
route named verbatim), `error` (anything else, verbatim). When the real
routes land, the same attempts return `ok` and the surfaces light up with
zero UI changes.

**The once-only secret (Stripe pattern):** a created key's full secret
exists in exactly ONE state of the create flow (`created`); acknowledging
("I've stored it") or closing discards it — there is no transition back.
Enforced by the pure flow machine in `src/lib/api-keys-view.ts`
(tested), not by discipline.

**Key proxy:** the client never holds the demo key. Create/revoke POST to
the studio's own route handlers (`/api/dashboard/keys`,
`/api/dashboard/keys/{keyId}`) which perform the authenticated attempt
server-side.

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

## Laws (violations void the delivery)

- consumes `@reckon/sdk` + `@reckon/contracts` types ONLY (the one
  addition: the developer-platform surfaces attempt the API's own public
  routes server-side, exactly like the `/healthz` probe precedent);
- never imports `@reckon/persistence` internals or any package's internal
  modules (guarded by `test/workspace.test.ts`);
- never touches a database; never reimplements decision/policy/evaluation
  logic; no second scheduler, model router, or recommendation engine;
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

- **The dashboard shell (S3-001) is live**: the nav IA, the Developers
  section (keys/logs/events with honest not-wired states naming the
  pending routes), the test/live toggle with confirm gating, and the Home
  overview (status + quick links + onboarding).
- **Decisions (UI-004) is live**: the `/decisions` workspace retrieves one
  decision by id through the SDK seam and renders the full record; a plain
  GET form performs the lookup (shareable, JS-optional).
- The other foundation routes render titled honest empty states; the
  Overview/Home keeps the system status card with a real server-side
  `/healthz` probe and the five-class evidence badge demo.
- The dashboard placeholder sections (Recommendations, Models, Data
  Sources, Analytics, Settings) state precisely what lands next (S3-002
  and the dashboard backend waves) and link the related live workspaces.
- The developer-platform API routes are pending (S2-002/S2-003): the
  surfaces attempt them for real and report the observed state — they will
  light up without UI changes when the routes land.
- The command palette lists the real workspace routes (no fabricated
  search results).
- No theme toggle: the captured reference is the light shell with the dark
  rail; dark mode is not part of this wave.
