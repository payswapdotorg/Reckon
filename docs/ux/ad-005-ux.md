# AD-005 — Ad Memory + Ad Query UX (UX notes)

Owner: UI. Status: implemented on `work/ad-005-ad-ux`.

These notes document the user-facing Ad Memory + Ad Query experience in
`apps/web`: the screen map, the provenance presentation law
implementation (laws 8 & 9 from `docs/architecture/ad-memory.md`), and
the control model (retention, permissions, defer/suppress, re-rank).
The UX sits ON TOP of the frozen ad contracts/SDK/API delivered by
AD-001..AD-004 — zero changes to `packages/**`, `apps/api/**`,
`tests/e2e/**`, `tests/conformance/**`.

## Screen map

The Ads section is a parent + children surface in the OPERATE nav group
(after Analytics, the dashboard IA's product lane), following the
Developers section's nested pattern:

| Route | Nav label | Surface |
|---|---|---|
| `/ads` | Ads | The Ad Query workspace — plain-language query ("What laptop ads have I seen?") + structured filters; answers in the two SEPARATE lanes; disclosed query understanding + honest notes |
| `/ads/remembered` | Remembered ads | The remembered-lane browser — every retained ad with encounter time, evidence trail, retention + expiry; mode pinned `remembered` |
| `/ads/available` | Current ads | The provider-supplied lane — availability declarations with their windows and memory links; mode pinned `available` |
| `/ads/records/[recordId]` | (not in nav) | Record detail — evidence trail, encounter context (by reference), identity/lineage, retention, permission history, rights, per-record forget |
| `/ads/consent` | Consent | Permission/consent — per-record retain/present grants with append-only history + the forget action |
| `/ads/retention` | Retention | Retention management — per-record basis/expiry with per-ad forget + bulk forget (item / advertiser / all) |
| `/ads/compare` | Compare | Compare + re-rank — BEFORE (retrieval lanes' order, hints) / AFTER (the kernel's order verbatim) with the defer/present/suppress WHY |

Every query surface is a **plain HTML GET form** (shareable URL,
JS-optional) like the Decisions lookup: `/ads?q=…&mode=…&labels=…` —
the server component re-renders from real SDK data at the URL's clock.
The record detail follows the `/login` precedent: a real page, not a
nav entry; breadcrumbs resolve to the Ads section.

## The provenance presentation law (law 9)

Remembered ads vs newly retrieved/provider-supplied ads are **always**
visually distinguishable, at three layers:

1. **Lane separation** — the two candidate arrays render as separate
   `<section>`s with their own headers and empty states
   (`AdLanes`/`RememberedAdsList`/`AvailableAdsList`). They are never
   merged into one list; mode discipline is pinned per page
   (`mode: "remembered"` never returns supply, `mode: "available"`
   never reads memory).
2. **Origin badge on every card** — `AdProvenanceBadge`, three
   unconfusable treatments following the `EvidenceClassBadge`
   accessibility law (hue + border style + icon, label always
   rendered):
   - **Remembered** (green, solid border, History icon) — a memory
     record whose provenance is an `observed-encounter`;
   - **Retained from supply** (teal, dashed border, Package icon) — a
     memory record seeded from supply (`provider-supplied`
     provenance inside the remembered lane);
   - **Provider-supplied** (gray, dashed border, Signal icon) — an
     available-lane candidate: a channel's availability declaration,
     never an observation, never in memory.
3. **Evidence trail** — the encounter time, the observed outcome event
   id, the evidence class, the surface and the context **by reference**
   ride every remembered card and the record detail; the provider-supplied
   card shows the declaring channel and its window instead. The two
   provenance kinds can never be confused because each card renders
   exactly the fields its contract carries.

## The ad/non-ad distinction (law 8)

`AdvertisingMark` (amber family, Megaphone icon, the word
"Advertising") rides **every** ad card, every origin badge row and the
BEFORE/AFTER re-rank rows. Where ads and ordinary recommendations
could coexist — the kernel's decision result — a result row that maps
to no ad candidate renders **without** the marks, labeled "ordinary
recommendation": the two treatments differ on sight, and the mapping
is tested (`rerankView` maps alternatives to their ads through the
resolved experiences; unmapped rows are the non-ad class). The frozen
`advertising: true` literal is carried on every card view row and
asserted in the test suite.

## The control model

**Retention (per-ad + bulk).** `/ads/retention` shows every record's
retention state with its **explicit basis** (law 1 — always visible,
never a bare state) and expiry evaluated against the caller clock
(law 3). Per-ad management is the terminal forget
(`ForgetAdButton`); bulk management is the frozen target vocabulary —
one ad by item id, an advertiser's ads, or everything
(`BulkForgetPanel`). Host-owned rights boundaries ride verbatim on
every row (law 4: redistribution defaults not-permitted).

**Permissions (consent).** `/ads/consent` inspects the per-record
`retain`/`present` grants with their append-only transition history,
and offers the one permission-changing operation the public surface
has: **forget** (revoking `retain` is terminal — law 2 — and
`/v1/ads/forget` is its public expression). The current consent state
is persisted through the public API: reads via `POST /v1/ads/query`,
the terminal transition via the forget proxy. Destructive actions are
mode-gated exactly like the key-revoke pattern (TEST arms immediately;
LIVE asks for confirmation first).

**Defer/present/suppress.** `/ads/compare` surfaces WHY from the
decision response: the scheduler action (QUEUE = defer, SUGGEST =
surface-as-suggestion, HOLD = suppress for now, SWITCH/INTERRUPT =
present), its meaning, the kernel's reason codes/messages, the
schedule delta, and per-alternative reasons/uncertainty/exclusions.

**Compare + re-rank.** The re-rank runs through the EXISTING decision
kernel — one query → the SDK's frozen-semantics candidate mapping
(`buildAdBearingCandidates`) → experience resolution → the declared
user-value reward term → ONE `DecisionRequest`. The BEFORE view is the
lanes' own order (hints only, never decisions); the AFTER view is the
kernel's order **verbatim** — the view never re-sorts (a law guard
asserts no `.sort(` anywhere in the re-rank path; law 7: commercial
value has no ranking path by design).

## Data path + scope

All data flows through the SDK seam (`getReckonClient()` →
`@reckon/sdk` → the documented HTTP surface: `/v1/ads/query`,
`/v1/ads/forget`, `/v1/decisions`, `/v1/experiences/resolve`) — never
a database, never domain internals. The ad-query scope is the demo
lane's subject/tenant (`RECKON_DEMO_TENANT_ID`, default "demo";
`RECKON_DEMO_SUBJECT_REF`, default "demo-user" — non-secret,
display-safe). Mutations go through the studio proxy
(`POST /api/dashboard/ads/forget`) exactly like the key-management
lane. The clock is caller-supplied per contract rule #4: request time
by default, the URL's `?at=` for deterministic replay.

## Honest states (Gate Q)

Every surface renders exactly what the API returned: idle
("nothing queried yet"), not-configured (no demo key), typed errors
verbatim (SDK error code + message + HTTP status), empty lanes with
the honest reason, "not provided" for absent contract fields. A record
that does not appear in the remembered lane is **not retrievable** —
forgotten (terminal), expired at the clock, retain-revoked or unknown —
and the detail page states exactly that set. No fixture/demo ad data
exists anywhere in the production surfaces.

## Gap findings (recorded, never worked around)

- **UX_DX_GAP-1** (consent): there is no public HTTP route for
  `AdPermissionTransition` — a `present`-only revoke/re-grant (keep the
  memory, stop presentation) cannot be expressed through `/v1/ads/**`
  (only `query` and `forget` exist; the AD-002
  `applyPermissionTransition` is a store port). The consent screen
  discloses this and never fakes a transition. Revoking `retain` IS
  expressible (terminal forget) and offered.
- **UX_DX_GAP-2** (retention): no public route changes a record's
  retention expiry — expiry is set by the retention basis's owner on
  the write path. The retention surface shows expiry verbatim and
  offers forget; no expiry edit is faked.
- **UX_DX_GAP-3** (detail): no get-record-by-id route. The record
  detail resolves records through the remembered lane at the request
  clock and matches by recordId; records not in the lane render the
  honest not-retrievable state. (A by-id route would also need a
  not-retrievable variant — forgotten records must never leak
  existence details, so the current honest-absent treatment may
  actually be the desired end state.)

## Test coverage (`apps/web/test/`)

- `ads-view.test.ts` — 37 tests: origin classes for all three lanes
  and both provenance kinds; the advertising literal on every card
  (law 8); lane separation (never merged); evidence/retention/rights
  detail rows (basis always present — law 1; redistribution default —
  law 4); permission grants + append-only history; query-param
  normalization + request plumbing (the GET-form → AdQueryRequest
  composition); forget-target parsing over the frozen vocabulary +
  mode-machine descriptors + the terminal outcome view; the re-rank
  plan (lane sources, positional hints, window gating with honest
  notes, the empty-set case); the decision-request composition
  (greedy-v1, context BY REFERENCE, the user-value reward bridge —
  law 7); and the BEFORE/AFTER order display (lanes' own order,
  kernel's order VERBATIM, the selected row, the ordinary-recommendation
  row for unmapped alternatives).
- `workspace.test.ts` — the registry/nav IA assertions extended to the
  Ads family (route order, OPERATE group, parent/children tree,
  breadcrumbs through the record detail) plus AD-005 smoke and law
  guards: component + CSS-module existence, the page set, the forget
  proxy handler, `ads-view` purity (client-safe: no server-only, no
  env, no SDK runtime import), the client-component bundle boundary
  (no server-loader imports), the SDK-seam-only data path, and the
  no-second-ranking guard (no `.sort(` in the re-rank path).
