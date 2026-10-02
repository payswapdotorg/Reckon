/**
 * Design-token sanity (UI-002) — asserts THREE-WAY fidelity:
 *   reference doc (§3 palette) ⇄ typed mirror (src/lib/design-tokens.ts)
 *   ⇄ rendered tokens (src/app/globals.css).
 *
 * The palette values below are transcribed from
 * docs/ux/you-platform-reference.md §3 (the committed live-inspection
 * reference) — if any of these assertions fail, the visual system has
 * drifted from the reference and Gate O is at risk.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DESIGN_TOKENS } from "../src/lib/design-tokens.js";

const here = dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(join(here, "../src/app/globals.css"), "utf8");

/** Reference §3 palette — transcribed verbatim from the committed doc. */
const REFERENCE_PALETTE: Record<string, string> = {
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
};

/** kebab-case CSS custom property name for a camelCase token key (chart1 → --chart-1). */
function cssVarName(key: string): string {
  return `--${key
    .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
    .replace(/\d+/g, (digits) => `-${digits}`)}`;
}

describe("design tokens — typed mirror matches the reference palette (§3)", () => {
  for (const [key, value] of Object.entries(REFERENCE_PALETTE)) {
    it(`token ${cssVarName(key)} is ${value}`, () => {
      expect(DESIGN_TOKENS.color[key as keyof typeof DESIGN_TOKENS.color]).toBe(value);
    });
  }

  it("radius base is 0.625rem (10px) and controls use 8px", () => {
    expect(DESIGN_TOKENS.radius.base).toBe("0.625rem");
    expect(DESIGN_TOKENS.radius.control).toBe("8px");
  });

  it("font stack is the system stack with no webfont", () => {
    expect(DESIGN_TOKENS.font.sans).toContain("system-ui");
    expect(DESIGN_TOKENS.font.sans).not.toMatch(/\.(woff2?|ttf|otf)/);
  });
});

describe("design tokens — globals.css declares every reference token with the exact value", () => {
  for (const [key, value] of Object.entries(REFERENCE_PALETTE)) {
    it(`globals.css declares ${cssVarName(key)}: ${value}`, () => {
      const pattern = new RegExp(
        `^\\s*${cssVarName(key)}:\\s*${value.replace(/[#.]/g, "\\$&")}\\s*;`,
        "m",
      );
      expect(globalsCss).toMatch(pattern);
    });
  }

  it("globals.css declares the radius tokens (10px base / 8px controls)", () => {
    expect(globalsCss).toMatch(/^\s*--radius:\s*0\.625rem\s*;/m);
    expect(globalsCss).toMatch(/^\s*--radius-control:\s*8px\s*;/m);
  });

  it("globals.css sets the system font stack on body", () => {
    expect(globalsCss).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(globalsCss).toMatch(/^\s*--font-sans:.*system-ui/m);
  });

  it("globals.css honors prefers-reduced-motion", () => {
    expect(globalsCss).toMatch(/prefers-reduced-motion:\s*reduce/);
  });
});
