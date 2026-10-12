# TL6-003 — Dashboard authentication + self-service keys (UX notes)

Owner: UI. Status: implemented on `work/tl6-003-dashboard-auth`.

These notes record the UX decisions, the exact-once mechanics, the
honest-state design and the gaps recorded for the TL, per the work
order's laws (`docs/handoff/TL6-FINAL-HANDOFF.md` §TL6-003).

## Session model (what the browser holds)

- The reckonsess_ token from signup/login's show-once wire response
  moves **server-side, straight into an httpOnly cookie**
  (`reckon_studio_session`; sameSite=lax; secure in production; path=/;
  maxAge mirrors the frozen `SESSION_TTL_MS` = 7 days). The browser
  never renders the token at all — a stronger form of the show-once law
  (there is no "copy your session token" step to get wrong).
- A second cookie (`reckon_studio_account`) caches **display-safe
  account metadata only** (email, fullName, tier). It is
  non-authoritative: it renders only while a session cookie exists, and
  any observed 401 clears both.
- All account-family traffic rides the studio's server proxies
  (`/api/dashboard/account/*`, `/api/dashboard/keys*`) — the client
  never talks to the Reckon API directly, so no credential can leak
  into a bundle.

## Progressive signup

Two steps, one submit:

1. **Your account** — name, email, password (+ confirmation). Bounds
   mirror the frozen contracts (password ≥ 8, email ≤ 320, names ≤ 256);
   the client check is a UX pre-flight, the API's zod issues surface
   verbatim when they disagree.
2. **Your workspace** — prefilled from the founder's name
   ("Ada Founder's workspace", possessive-aware), editable.

Success signs the account in immediately (the first session parks in
the httpOnly cookie) and lands `/developers/keys?welcome=1` — the
product UX's next action (create your first key → make the call), not a
dead-end dashboard. The Home onboarding card opens with the same
progression: step 1 is the account (rendered as the verified signed-in
identity when a session exists — that state IS verifiable server-side),
then key → call → logs.

`EMAIL_TAKEN` (the API's typed 409, param `email`) renders as an email
field error with a **sign-in instead** link that pre-fills the email.

## Protected routes + session lifecycle

- `/developers/keys` is the account-owned surface: no session →
  redirect `/login?next=/developers/keys&reason=signin`.
- An observed **401** from any account call (expired/revoked session)
  exits through `GET /api/dashboard/account/expire` (server components
  cannot clear cookies) which clears both cookies and lands
  `/login?reason=expired` with the sanitized `next`.
- `/login` and `/signup` redirect already-signed-in browsers to their
  target.
- The `next` target is sanitized (`safeNextPath`, pure + tested):
  same-origin absolute paths only — absolute URLs, protocol-relative
  targets, `/api/` paths and oversized strings collapse to `/`.
- **Logout is honest**: the proxy attempts the real
  `POST /v1/account/logout`; cookies clear only when the API revoked
  (204) or said the session was already invalid (401). An unreachable
  API keeps the cookies (the session is still alive server-side —
  stranding it to fake a logout would be a silent fallback) and reports
  the observed failure inline with a retry.

## Exact-once key reveal (the mint flow)

- The mint request is `{ kind, mode }` — the frozen `CreateKeyRequest`
  has **no name field**; the dialog says so honestly ("Account keys are
  unnamed — the API mints kind + mode only") rather than collecting a
  name the API would drop.
- The mint mode rides the dashboard's test/live toggle (test/live
  separation), and the reveal labels the key from the **response**
  fields (kind/mode/tier), never from the toggle's assumption.
- The once-only law is enforced by the pure machine
  (`lib/api-keys-view.ts`, `nextMintKeyFlowState`): the RAW key exists
  in exactly one state (`created`); acknowledging ("I've stored it") or
  closing discards it; `stored` carries only metadata — **not even a
  prefix fragment** of the secret survives; no transition re-enters
  `created`. `visibleMintedSecret` is the single accessor. All
  invariants are unit-asserted (`test/api-keys-view.test.ts`).
- Copy affordance + the store-it-now warning (§7 degraded tint) during
  the reveal; the list never carries key material (the frozen
  `AccountKeySchema` strips unknown fields — asserted by test).

## Honest states (Gate Q)

- **Unconfigured does not exist on this lane**: signup/login are
  unauthenticated routes — the account family is exactly the surface
  that works with no pre-configured key. (The demo-lane
  `RECKON_DEMO_API_KEY` badge on Home/Developers describes the OTHER
  lane and stays as-is.)
- `unreachable` — the observed network failure, verbatim.
- `not-wired` — 404 (no typed code) / 501: names the pending route
  verbatim; a 404 carrying a typed code ≠ NOT_WIRED (e.g. NOT_FOUND for
  an unknown key id) is an honest `error` outcome with the code carried.
- `error` — anything else the API said, verbatim (code + param carried;
  `EMAIL_TAKEN` and login-401 get precise form copy).
- Revoked keys stay visible in the table (revoked chip + revokedAt,
  dimmed) — the API reports them; the inventory is never truncated to
  look tidy.

## Regression protection (the two credential lanes)

- The account lane (`lib/account-api.ts`) carries **only** the
  reckonsess_ bearer — asserted by test; the demo/static-key lane
  (`lib/developers-api.ts`) never rides key management (the dead
  `/v1/api-keys` key functions were removed; tests assert the demo lane
  keeps no key-management path).
- Test/live separation: mint mode flows from the toggle; row mode chips
  and the reveal label come from the API's response; the tier ladder
  renders per key (the API snapshots tier on the key row).
- `test/workspace.test.ts` guards: account-api purity (no env, no
  server-only), frozen-contract validation (no parallel wire model),
  server-only seam with httpOnly cookie options, proxies consume the
  account lane, auth pages/handlers exist, and no render surface
  references the session-token vocabulary in executable code.

## API_GAP findings (recorded for the TL)

1. **No session-introspection route** in the frozen account family (no
   `GET /v1/account/me` / session resource). The studio therefore
   caches display-safe account metadata in a cookie at signup/login.
   An additive `GET /v1/account/session` (or `me`) returning the
   `AccountSchema` view would let the shell render the signed-in
   identity from the source of truth and drop the cache cookie. Not
   needed for TL6-003 acceptance; recorded as the clean follow-up.

## PLATFORM_UPGRADE_CANDIDATE

- **Standalone auth layout**: `/login` and `/signup` currently render
  inside the studio shell (WorkspacePage card in the content column).
  The additive-only law ruled out restructuring the app tree into
  `(shell)`/`(auth)` route groups this wave (≈17 file moves + smoke-test
  churn). Candidate for a follow-up dashboard wave if the product wants
  full-bleed auth screens.

## Deliberate non-changes

- The demo-lane data surfaces (decisions/plans/analytics/logs/events)
  keep the `RECKON_DEMO_API_KEY` seam unchanged — TL6-003's auth owns
  the ACCOUNT lane only; account-scoped reads of operator data are a
  separate work item.
- `docs/work-items/state.json` untouched — the status ledger is the
  TL's to reconcile at merge.
