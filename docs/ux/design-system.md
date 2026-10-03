# Reckon Studio — Design System (implemented)

> The implemented design language of `apps/web`, derived from the You Platform
> live reference (`docs/ux/you-platform-reference.md`) during UI-002.
> Values are owned by `apps/web/src/lib/design-tokens.ts` (programmatic mirror)
> and `apps/web/src/app/globals.css` (rendered declarations);
> `apps/web/test/design-tokens.test.ts` asserts BOTH against the reference —
> the tokens cannot silently drift from the inspected source of truth.

**Status:** implemented and deployed (production: `reckon-web-nine.vercel.app`).

---

## 1. Tokens

| Token | Value | Use |
|---|---|---|
| `background` | `#fbfbfa` | main surface (warm off-white) |
| `foreground` | `#17171a` | primary text |
| `card` / `card-foreground` | `#fff` / `#17171a` | cards on the off-white surface |
| `muted` / `muted-foreground` | `#f4f4f9` / `#71717b` | secondary surface / text |
| `border` / `input` | `#e5e5ea` | hairline separation (the primary separation device) |
| `primary` / `primary-foreground` | `#009768` / `#fafaf9` | the single high-saturation accent |
| `destructive` | `#e40015` | sparing error treatment |
| `sidebar` / `sidebar-foreground` | `#121215` / `#d0d0d5` | near-black rail vs light content — the core structural contrast |
| `sidebar-accent` / `sidebar-primary` | `#26262a` / `#25a777` | rail hover/active fill; rail brand green |
| `chart-1..5` | `#009768` `#dc8b18` `#e15753` `#009789` `#62626c` | data series |
| `radius.base` | `0.625rem` (10px) | cards/panels |
| `radius.control` | `8px` | buttons/inputs |

**Color discipline (inherited from the reference):** one accent green reserved
for primary CTAs and brand moments; everything else neutral grayscale; error
red sparing. No second accent; no decorative gradients.

**Typography:** the reference system stack (no custom webfont). Page H1
~24px/600 tight tracking; H2 18px/600; body 16px/400 (24px line-height);
buttons 13px/500; sidebar items 14px/500; sidebar GROUP LABELS 11–12px
UPPERCASE wide-tracked. Sentence case everywhere else; monospace stack for
IDs, URLs, and technical strings.

## 2. Component language

- **App shell:** dark fixed left sidebar (~250px, full height) + light
  content; minimal top bar with breadcrumb, search (⌘K), right-aligned
  primary CTA. Mobile: sticky top bar + hamburger drawer (nav-drawer).
- **Cards:** white, 10px radius, hairline border, ~24px internal padding;
  card headers carry the section label.
- **Buttons:** primary = solid green pill-ish 8px-radius; secondary/tertiary =
  outlined/ghost in the same shape language; retry affordances use the
  secondary form.
- **Inputs:** hairline-bordered, 8px radius, mono styling for ID/URL entry;
  JS-optional GET-form lookups degrade to plain forms.
- **Empty/unavailable states:** honest, never blank — each states WHAT is
  unavailable and WHY (reason strings come from the API/SDK surfaces, never
  invented client-side).
- **Loading states:** skeletons on async surfaces (decision lookup).
- **Evidence-class badges (Reckon-specific extension):** small uppercase pills
  (`observed`, `controlled-local`, `fixture`, `simulated`, `counterfactual`)
  — a deliberate vocabulary extension REQUIRED by the operational-honesty
  gates (Gate Q / handoff §14). The reference has no equivalent; this is the
  one sanctioned addition to its visual vocabulary.
- **Data displays:** rolling timeline (plan workspace), 8-action ladder +
  score breakdown (scheduler), pure-SVG organization graph (agents), learning
  ladder with visually distinct simulated/counterfactual rungs (research).

## 3. Density posture (documented divergence)

The reference is a sparse, empty-state demo surface; Reckon Studio ships
data-dense product workspaces. The design LANGUAGE (tokens, chrome,
typography, button/input/card treatment) is the reference's; the information
DENSITY is intentionally higher and is recorded as an honest divergence in
`docs/ux/acceptance.md` rather than hidden.
