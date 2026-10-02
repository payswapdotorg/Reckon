/**
 * Typed mirror of the Reckon Studio design tokens.
 *
 * Source of truth for the VALUES: docs/ux/you-platform-reference.md §3
 * (TL live inspection 2026-10-02) + docs/ux/assets/you-platform-tokens-raw.json.
 * The rendered tokens live in src/app/globals.css; this module is the
 * programmatic mirror (charts, tests, future tooling) and is kept in sync
 * with the CSS by test/design-tokens.test.ts — which asserts BOTH this
 * module and the actual globals.css declarations against the reference.
 *
 * This module is intentionally dependency-free and React-free so it can be
 * consumed by tests, server components, and client components alike.
 */

export const DESIGN_TOKENS = {
  color: {
    background: "#fbfbfa",
    foreground: "#17171a",
    card: "#fff",
    cardForeground: "#17171a",
    popover: "#fff",
    popoverForeground: "#17171a",
    primary: "#009768",
    primaryForeground: "#fafaf9",
    secondary: "#f4f4f9",
    secondaryForeground: "#28282c",
    muted: "#f4f4f9",
    mutedForeground: "#71717b",
    accent: "#efeff5",
    accentForeground: "#28282c",
    destructive: "#e40015",
    destructiveForeground: "#fafaf9",
    border: "#e5e5ea",
    input: "#e5e5ea",
    ring: "#009768",
    chart1: "#009768",
    chart2: "#dc8b18",
    chart3: "#e15753",
    chart4: "#009789",
    chart5: "#62626c",
    sidebar: "#121215",
    sidebarForeground: "#d0d0d5",
    sidebarAccent: "#26262a",
    sidebarAccentForeground: "#f5f5f4",
    sidebarBorder: "#28262c",
    sidebarPrimary: "#25a777",
    sidebarPrimaryForeground: "#fafaf9",
    sidebarRing: "#25a777",
  },
  radius: {
    /** 10px base radius. */
    base: "0.625rem",
    /** 8px on controls (buttons, inputs). */
    control: "8px",
  },
  font: {
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  },
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;
