# Dashboard Shell — S3-001 UX decisions

**Work item:** S3-001 — Dashboard shell (apps/web extension)
**Base:** b55eb205 (S2-001 hardened API) · **Design refs:**
`docs/surveys/stripe-com-survey.md` §1/§5 (dashboard.stripe.com model),
`docs/ux/you-platform-reference.md` (the studio's design language).

This document records the UX decisions behind the dashboard shell so later
waves (S3-002 analytics, S2-002 webhooks, S2-003 test mode) extend rather
than re-litigate them.

---

## 1. Information architecture

The rail carries the **dashboard IA first** (the S3-001 mandate: Home ·
Recommendations · Models · Data Sources · Analytics · Developers ·
Settings), then the foundation studio workspaces (unchanged hrefs — no
UI-001..UI-009 route moved), with Settings closing the rail in the ACCOUNT
group (the reference app's §6 arrangement language).

Groups: `(landing) Home` · `OPERATE` (Recommendations, Models, Data
Sources, Analytics) · `DEVELOPERS` (Developers + nested API keys / Request
logs / Events) · `BUILD` / `INTELLIGENCE` / `INTEGRATE` (the foundation
workspaces) · `ACCOUNT` (Settings).

Decisions:

- **Nested developer sub-surfaces** (not a flat list): the Developers
  section is one place with three surfaces — Stripe's Developers section
  pattern. The sidebar child gets `aria-current="page"`; the parent gets
  the section-active fill (visually open, not "the page").
- **Placeholder sections link their related live surfaces**
  (registry `relatedHrefs`): Recommendations → Decisions/Plans/Scheduler,
  Models → Agents, Data Sources → Integrations, Analytics → Research. An
  operator reaches live data without waiting for the section backend.
- **Most-specific route resolution**: `/developers/keys` resolves to the
  keys page (not its parent) — breadcrumb, nav active state and document
  title all agree.
- **Breadcrumb renders the parent chain**: `Reckon Studio > Developers >
  API keys`.

## 2. Honest degradation (Gate Q) — the not-wired callout

The S2-001 API hardened the core surface; the developer-platform
management routes are pending (S2-002/S2-003). The dashboard NEVER fakes
them:

- every surface **attempts its real pending route** server-side
  (`lib/developers-api.ts`, injectable fetch, fully tested) and renders
  the observed outcome: `ok` / `unconfigured` / `unreachable` /
  `not-wired` (404 or the typed 501 NOT_WIRED envelope — pending route
  named verbatim) / `error` (verbatim detail);
- the **not-wired callout** (`components/developers/surface-state.tsx`)
  uses the §7 degraded card language (light red tint) with the pending
  route in a code chip — alarming enough to read, precise enough to act
  on;
- a 200 body that does not match the expected S2-001 list envelope is an
  **error** ("withheld rather than guessed") — never reshaped, never
  padded with defaults;
- the **events console** shows the planned S2-002 catalog as clearly
  labeled ROADMAP (badge: "roadmap, not observed data") and the replay
  affordance renders disabled with the pending route
  (`POST /v1/events/{id}/replay`) — the affordance is real, the action
  never fakes a delivery.

When the real routes land, the same attempts return `ok` and the surfaces
light up with zero UI changes.

## 3. The once-only secret (Stripe key-creation pattern)

The create-key flow's state machine (`lib/api-keys-view.ts`) enforces the
Stripe pattern mechanically:

```
closed → naming → submitting → created(holds the full secret)
                              ↘ failed(observed outcome)
created → stored(summary only — secret DISCARDED)
any state → closed (secret discarded)
```

- `created` is reachable ONLY from `submitting` via a real `ok` result;
- `SECRET_STORED` or `CLOSE` transitions discard the secret — there is NO
  transition back into `created`, so the full key can never be re-shown;
- `visibleSecret()` is the single accessor: `null` in every phase except
  `created`;
- the UI shows the "Store this key now" warning (§7 degraded tint) + a
  copy button before the acknowledge action.

## 4. Cursor pagination controls (S2-001 envelope)

Request logs page with the API's own vocabulary: `starting_after` fed by
`next_cursor`, `limit` — no page arithmetic, no invented totals. The
envelope is forward-only, so the dashboard keeps the **cursor trail in the
URL** (`cursor_history=a,b,c`): "Older" advances (pushes the current
cursor), "Newer" pops. Server-rendered on every step — shareable,
JS-optional, and the href math is pure and tested
(`lib/request-logs-view.ts`). Disabled controls state WHY they are
disabled ("No more pages — has_more is false").

## 5. Test/live toggle (the signature affordance)

Placed at the top of the sidebar rail (Stripe's placement), a segmented
control wired to the pure mode machine (`lib/mode-machine.ts`):

| Transition | Behavior |
|---|---|
| test → live | confirm dialog ("real account data") |
| live → test | immediate (safe direction) |
| destructive in test | armed immediately — test mode never gates |
| destructive in live | confirm dialog, then armed exactly once |
| new request while a dialog is pending | replaces it (one pending at a time) |

- **Mode semantics recolor the shell** (toggle, header badge, sidebar
  footer badge, key mode chips): live = primary emerald `#009768`, test =
  chart-2 amber `#dc8b18` — both from the committed palette, no new hues
  (the single-accent law holds).
- **Honest placeholder:** persistence is `localStorage`
  (`reckon.studio.dashboard-mode`) and request routing does not change
  yet — stated in the toggle caption and the switch-confirm dialog;
  S2-003 lands the API-side semantics.
- Server render defaults to test (the safe mode); the persisted mode
  hydrates after mount, so there is no hydration mismatch — only a
  post-mount settle.
- Dialogs: Escape/overlay-click declines (the safe direction), cancel
  button auto-focused.

## 6. Accessibility & responsive behavior

- All interactive targets ≥ 44px on touch (§8 paddings on mobile).
- The toggle is a real radio group (arrow keys move, Space/Enter select);
  dialogs are `role="dialog" aria-modal` with labeled actions.
- Tables live in horizontally-scrollable cards with sticky headers and a
  capped vertical scroll (`max-height` + thin custom scrollbar).
- Data tables carry `<caption>`; pagination links carry `rel="prev/next"`;
  disabled controls explain themselves via `title`.
- Semantic HTML throughout (`nav`, `dl` status rows, `th scope="col"`),
  `prefers-reduced-motion` honored by the global sheet.
