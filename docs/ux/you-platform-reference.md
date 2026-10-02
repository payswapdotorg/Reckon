# You Platform — Live Visual Reference (UI-002 mandatory reading)

> Per FINAL TL HANDOFF §6: the TL performed the live visual inspection on
> 2026-10-02 (worker environments cannot fetch the JS-rendered SPA). This
> document + the committed screenshots under `docs/ux/assets/` are the
> authoritative reference for the Reckon web UI design language
> (Reckon remains its own product; do not copy branding/content/semantics).

**Reference URL:** `https://you-platform.vercel.app`
**Inspected live:** 2026-10-02, via headless Chrome (CDP), render-verified
**Framework observed:** Next.js (App-Router-style shell), system font stack

---

## 1. Reference artifacts

| Artifact | Viewport | Notes |
|---|---|---|
| `assets/you-platform-desktop-1440.jpg` | 1440×900 (desktop) | full-page capture |
| `assets/you-platform-tablet-768.jpg` | 768×1024 (tablet) | full-page capture |
| `assets/you-platform-mobile-390.jpg` | 390×844 @2x (mobile) | full-page capture |
| `assets/you-platform-tokens-raw.json` | — | raw computed-style + CSS-var extraction |
| `assets/you-platform-nav-raw.json` | — | nav structure enumeration |

---

## 2. Layout composition

- **Shell:** dark fixed left sidebar (~240–260px, full viewport height) +
  light main content area. Classic "pro tool" dashboard shell.
- **Content header:** minimal top bar with breadcrumb (e.g.
  `YOU Demo Studio > Overview`), search field with `⌘K` hint, and the
  primary CTA on the right. Vertical padding ~16–24px.
- **Content body:** single-column, generous padding (~32–48px), clear
  vertical rhythm; page title → subtitle → content blocks with 24–32px gaps.
- **Density:** low-to-medium ("airy"); significant whitespace; premium feel.

## 3. Color system (extracted CSS custom properties)

```text
background          #fbfbfa   (warm off-white main surface)
card                #fff      (pure white cards on the off-white surface)
foreground          #17171a   (near-black text)
muted               #f4f4f9   (muted surface)
muted-foreground    #71717b   (secondary text)
border              #e5e5ea   (hairline borders — the primary separation device)
input               #e5e5ea
primary             #009768   (emerald green — the ONLY high-saturation color)
primary-foreground  #fafaf9
ring                #009768
destructive         #e40015
sidebar             #121215   (near-black sidebar)
sidebar-foreground  #d0d0d5
sidebar-accent      #26262a   (hover/active fill in sidebar)
sidebar-primary     #25a777   (brand green variant inside sidebar)
sidebar-border      #28262c
accent              #efeff5
radius              0.625rem  (10px base; buttons 8px)
chart-1..5          #009768 / #dc8b18 / #e15753 / #009789 / #62626c
```

**Color discipline:** one accent color (green) used for the primary CTA and
brand moments only; everything else is neutral grayscale. Error red is
sparing (icon + light `red-50`-tinted card treatment). Dark sidebar vs light
content is the core structural contrast.

## 4. Typography

- **Stack:** `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
  "Helvetica Neue", Arial, sans-serif` (no custom webfont).
- **Scale (observed):** page H1 ~24px/600 with tight tracking (-0.6px) at
  token level (renders larger via utility classes in hero contexts);
  H2 18px/600; body 16px/400/24px line-height; buttons 13px/500;
  sidebar items ~14px/500; sidebar GROUP LABELS 11–12px uppercase,
  medium weight, wide tracking (+0.05em).
- **Casing:** sentence case for titles/nav/buttons; UPPERCASE reserved for
  sidebar category groupings (BUILD, EMBODIMENT, DEVELOP, TRUST, ACCOUNT).

## 5. Components

- **Cards:** white surface, ~12–16px radius, `1px solid #e5e5ea` border,
  generous internal padding (40px+ for state cards); NOT shadow-driven.
- **Buttons:** primary = solid green fill, white text, 8px radius, compact
  padding (6px 8px base, larger for CTA), `+` icon prefix on create-actions.
  Secondary = white/outline "ghost" with gray border.
- **Search input:** rounded-rect, light-gray fill, left magnifier icon,
  right `⌘K` kbd badge (pill, monospaced, light gray).
- **Badges/chips:** pill-shaped, light-gray, monospaced tags (e.g. env
  indicator `ENV: LOCAL`).
- **Dividers:** subtle hairlines; sidebar footer separated from nav.
- **Elevation strategy:** flat / low-elevation — separation via borders and
  background-color contrast, almost no drop shadows.

## 6. Navigation behavior

- Vertical list, grouped by uppercase category labels with vertical gaps
  between groups; outline (stroke) icons left of each item.
- Active item: darker fill (#26262a) + brighter text; hover fill similar.
- Reference app's groups: BUILD (Twins, Captures, Performances, Templates,
  Renders, Live), EMBODIMENT (Agent Avatars), DEVELOP (API & Tools, Labs),
  TRUST (Consent & Provenance), ACCOUNT (Usage & Billing, Settings).
  **Reckon mapping (per handoff §7):** BUILD → Decisions, Experiences,
  Plans; OBSERVE → Outcomes, Personalization; INTELLIGENCE → Agents,
  Research; INTEGRATE → Integrations; ACCOUNT → Settings — Overview stays
  the landing item. Follow the You Platform arrangement language, not its
  item names.
- Command palette (⌘K) with "Search for a command to run…" placeholder —
  global search + command surface is part of the language.

## 7. State design (honest-degradation language — critical for Reckon)

The reference shows its "data unavailable" state by design:
- centered composition; large outlined warning triangle icon;
- title ("Overview data unavailable") → precise reason
  ("authentication required") → single action ("Retry" ghost button);
- light red-tinted card (`red-50` + soft red border) — alarming but not
  aggressive;
- an explanatory line BELOW the card: "The Studio renders only real
  backend state — retry once the API is reachable."
  **Reckon must import this honesty pattern wholesale** (Gate Q):
  never render fabricated data; states must say what failed and why.

## 8. Responsive behavior

- **Desktop (≥1024px):** persistent dark sidebar; full header with search
  field + primary CTA.
- **Tablet (~768px):** sidebar retained (narrower) or collapsible; content
  column widens.
- **Mobile (390px):** sidebar hidden → hamburger drawer (off-canvas);
  header compact: search collapses to an icon button; theme toggle +
  primary CTA remain (right-aligned, touch-sized ~44px); content goes
  edge-to-edge with 16–20px horizontal padding; single-column stacking;
  state cards center-aligned; touch-optimized buttons.

## 9. Motion & micro-interaction notes

- Restrained: no large parallax/heavy animation visible; motion is implied
  through hover fills (sidebar items), focus rings (green `--ring` on
  inputs), and overlay fades. Target: 150–250ms ease-out transitions for
  hover/focus; drawer slide ~250ms; skeleton shimmers for loading.
- Loading states: use skeleton placeholders in card shapes (matching the
  airy density), never spinners blocking whole pages.

## 10. Design-language summary for Reckon UI

1. Dark-rail + light-canvas shell; hairline borders over shadows.
2. One accent (Reckon may keep the emerald family `#009768`/`#25a777` or
   shift hue while preserving the discipline: ONE accent, neutrals
   elsewhere).
3. System font stack; sentence case; uppercase only for sidebar groups.
4. Airy spacing rhythm: 32–48px content padding, 24–32px block gaps,
   generous card padding.
5. 10px base radius (8px on controls), pill badges, kbd hints (⌘K).
6. Command palette + breadcrumb + sticky header.
7. Honest states: precise failure reasons, retry affordances, explanatory
   subtext — never fabricated data (Gate Q).
8. Evidence-class differentiation gets a VISIBLE badge vocabulary
   (observed / controlled-local / fixture / simulated / counterfactual)
   consistent with the pill-badge language.

## 11. Acceptance comparison protocol (UI-002)

Implemented comparison screenshots must be captured at the same three
viewports (1440×900, 768×1024, 390×844) and placed side-by-side with the
reference artifacts above; the comparison must cover: shell composition,
sidebar grouping language, header (breadcrumb/search/CTA), card treatment,
button language, state design (incl. one honest-degradation state), and
mobile drawer behavior.
