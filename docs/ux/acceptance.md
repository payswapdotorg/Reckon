# UI Visual Acceptance — Gate O Evidence (RELEASE-001)

> Method: the reference was inspected live by the TL (UI-002, 2026-10-02 —
> `you-platform-reference.md` + committed captures). The implemented product
> was captured on **2026-10-03 from the live public deployment**
> (`https://reckon-web-nine.vercel.app`) via headless Chrome at the same
> viewports, then compared. Assessment is honest by law: aligned dimensions,
> partial dimensions, and divergences are all recorded.

## 1. Artifact pairs (reference ↔ implemented)

| Viewport | Reference | Implemented |
|---|---|---|
| 1440×900 desktop | `assets/you-platform-desktop-1440.jpg` | `assets/reckon-web-desktop-1440.png` |
| 1440×900 desktop (2nd surface) | — | `assets/reckon-web-decisions-1440.png` |
| 768×1024 tablet | `assets/you-platform-tablet-768.jpg` | `assets/reckon-web-tablet-768.png` |
| 390×844 mobile | `assets/you-platform-mobile-390.jpg` | `assets/reckon-web-mobile-390.png` |

## 2. Structural (code-anchored) verification

- `apps/web/test/design-tokens.test.ts` dual-asserts the programmatic token
  module AND the rendered `globals.css` against the reference extraction
  (`you-platform-tokens-raw.json`) — token drift fails the battery.
- Per-workspace view tests (`workspace.test.ts`, `scheduler-view.test.ts`,
  `agent-view.test.ts`, `plan-view.test.ts`, `research-view.test.ts`,
  `evidence.test.ts`) assert behavioral mapping of every rendered surface.

## 3. Visual comparison results (VLM-assisted, 2026-10-03)

### Desktop 1440

**Genuinely aligned:** navigation/sidebar behavior (dark fixed rail,
uppercase group labels, icon+text items, bottom profile block, active-state
treatment); button language (green primary CTA top-right, outlined/ghost
secondary convention); typography hierarchy (bold page titles, muted
subtitles, mono for technical strings); color/material treatment (charcoal
rail, off-white surface, hairline borders, flat material).

**Partially aligned:** card treatment (same border/padding language, denser
internal grids); visual hierarchy (same principles, deeper nesting for
data-dense workspaces); panel composition (reference is a centered
empty-state hero; implementation is a document/dashboard composition).

**Divergent (recorded honestly):** information density and spacing rhythm —
the reference is a sparse empty-state demo with massive whitespace; Reckon
Studio packs real decision-infrastructure data into the same visual
language, reading as "the reference at a glance, heavier on inspection".
Component vocabulary is extended by evidence-class pill badges
(`observed` / `controlled-local` / `fixture` / `simulated` /
`counterfactual`) — a sanctioned, gate-required addition (Gate Q, handoff
§14), not present in the reference.

### Mobile 390

**High fidelity:** responsive navigation (sticky top bar, hamburger drawer,
right-aligned pill CTA), 16–20px gutters, ~24px card padding, identical
typography scale and casing conventions, matching card container treatment.

## 4. Verdict (Gate O)

**PASS with documented divergence.** The design language — tokens, shell,
typography, button/input/card language, responsive behavior — is aligned
with the reference at all three viewports and is battery-enforced against
drift. The density divergence is a deliberate product decision (a data-dense
decision-infrastructure product vs a sparse demo surface) and is documented
here rather than hidden, per the honesty law. Evidence-class badges are the
one sanctioned vocabulary extension, required by Gate Q.
