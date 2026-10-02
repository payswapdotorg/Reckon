# @reckon/web — Reckon Studio (UI-001 + UI-002)

The product UI for Reckon: a Next.js (App Router, TypeScript strict) shell
that consumes **`@reckon/sdk` only** — it is a consumer of Reckon, never a
second source of domain truth (FINAL TL HANDOFF §29).

This wave (UI-001 + UI-002) delivers the **foundation**: app shell, design
system, the seven workspace routes with honest empty states, and the
evidence-class badge vocabulary (Gate Q prep). The workspaces themselves go
live in UI-003..UI-009.

## Laws (violations void the delivery)

- consumes `@reckon/sdk` + `@reckon/contracts` types ONLY;
- never imports `@reckon/persistence` internals or any package's internal
  modules (guarded by `test/workspace.test.ts`);
- never touches a database; never reimplements decision/policy/evaluation
  logic; no second scheduler, model router, or recommendation engine;
- new code lives only under `apps/web/**` (+ lockfile);
- honest states only (Gate Q): the studio renders real backend state or
  says precisely what is missing — never fabricated data.

## Design language

`docs/ux/you-platform-reference.md` is the source of truth. Tokens live in
`src/app/globals.css` (CSS custom properties, exact §3 palette); the typed
mirror is `src/lib/design-tokens.ts`. Both are asserted against the
reference by `test/design-tokens.test.ts`. Base components:
`src/components/ui/` (Card, Button, Badge, SearchInput, SidebarNav,
EvidenceClassBadge). Shell: `src/components/shell/` (AppShell, Sidebar,
SiteHeader, CommandPalette, NavDrawerProvider).

## Environment (server-side only — no secret reaches a client bundle)

| Variable | Default | Purpose |
|---|---|---|
| `RECKON_API_BASE_URL` | `http://127.0.0.1:8080` | API origin the studio points at |
| `RECKON_DEMO_API_KEY` | — | Bearer key for the demo tenant (**secret**, server-only) |
| `RECKON_ENV` | from `NODE_ENV` | Honest environment label for the `ENV:` badge |

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

- The seven routes render titled honest empty states
  ("No data loaded — connect the API"); the Overview adds a **system
  status** card with a real server-side `/healthz` probe and the
  five-class evidence badge demo.
- The SDK surface (W3-002) has no list endpoints, so no workspace can load
  collections yet; `getReckonClient()` is the seam UI-003+ will use.
- The command palette lists the real workspace routes (no fabricated
  search results).
- No theme toggle: the captured reference is the light shell with the dark
  rail; dark mode is not part of this wave.
