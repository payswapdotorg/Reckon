/**
 * Changelog content contract (S5-002) — the stripe.com/changelog grammar
 * applied to data AND render.
 *
 * Laws under test (work item S5-002, task packet a + f):
 *  a. the entries are sorted reverse-chronologically, anchors are unique,
 *     categories come from the allowed chip set, and every date parses
 *     as a real calendar date;
 *  f. the /changelog page renders data-driven — one <article> per entry
 *     with its anchor, date and category chips — and ships the full
 *     social card like every other route.
 *
 * Conventions: mirrors the S1-002..S5-001 suites — .js-suffixed relative
 * imports (NodeNext typecheck compatibility), readFileSync source
 * contracts for page modules (they use the app's "@/" alias, which the
 * root NodeNext program cannot resolve), vitest from the repo root, no
 * network, no git.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHANGELOG_CATEGORIES,
  CHANGELOG_ENTRIES,
  CHANGELOG_HEADINGS,
  formatChangelogDate,
} from "../src/content/changelog.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");

/** ISO shape AND a real calendar date (Date.UTC round-trip). */
function isRealCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day;
}

/* ------------------------------------------------------------------ */
/* (a) The data — the changelog grammar                                */
/* ------------------------------------------------------------------ */

describe("changelog data (stripe.com/changelog grammar)", () => {
  it("carries the seeded release history (RELEASE-001 through S5-002)", () => {
    // Repo facts: RELEASE-001 (2026-10-03, 52 items), the stripe-phase
    // waves + journey proof + RELEASE-002 (2026-10-05), this work item.
    expect(CHANGELOG_ENTRIES.length).toBeGreaterThanOrEqual(8);
    const anchors = CHANGELOG_ENTRIES.map((entry) => entry.anchor);
    expect(anchors).toContain("2026-10-03-release-001");
    expect(anchors).toContain("2026-10-05-release-002");
    expect(anchors).toContain("2026-10-05-docs-changelog-seo");
  });

  it("entries are sorted reverse-chronologically by date", () => {
    for (let i = 1; i < CHANGELOG_ENTRIES.length; i += 1) {
      const previous = CHANGELOG_ENTRIES[i - 1].date;
      const current = CHANGELOG_ENTRIES[i].date;
      expect(previous >= current, `${previous} must not precede ${current}`).toBe(true);
    }
  });

  it("every date parses as a real calendar date", () => {
    for (const entry of CHANGELOG_ENTRIES) {
      expect(isRealCalendarDate(entry.date), `bad date ${entry.date}`).toBe(true);
    }
  });

  it("every date falls inside the repository's release-history window", () => {
    // The repo's own history: RELEASE-001 closed 2026-10-03 and the last
    // release commits (RELEASE-002 + this work item) are 2026-10-05 —
    // guards against invented future or pre-history entries.
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.date >= "2026-10-03", `${entry.date} predates the repo`).toBe(true);
      expect(entry.date <= "2026-10-05", `${entry.date} postdates the last release`).toBe(true);
    }
  });

  it("anchors are unique and slug-shaped (date-prefixed)", () => {
    const anchors = CHANGELOG_ENTRIES.map((entry) => entry.anchor);
    expect(new Set(anchors).size, "duplicate anchors").toBe(anchors.length);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.anchor).toMatch(new RegExp(`^${entry.date}-[a-z0-9]+(-[a-z0-9]+)*$`));
    }
  });

  it("categories come from the allowed set, at least one per entry", () => {
    const allowed = new Set<string>(CHANGELOG_CATEGORIES);
    expect(CHANGELOG_CATEGORIES).toEqual(["API", "SDKs", "Dashboard", "Docs", "Platform"]);
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.categories.length).toBeGreaterThanOrEqual(1);
      for (const category of entry.categories) {
        expect(allowed.has(category), `unknown category ${category}`).toBe(true);
      }
      expect(new Set(entry.categories).size, "duplicate chip").toBe(entry.categories.length);
    }
  });

  it("titles and one-liners are non-empty; detail is optional but never blank", () => {
    for (const entry of CHANGELOG_ENTRIES) {
      expect(entry.title.trim().length).toBeGreaterThan(0);
      expect(entry.oneLiner.trim().length).toBeGreaterThan(0);
      if (entry.detail !== undefined) {
        expect(entry.detail.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("the on-this-page rail mirrors the feed 1:1, in feed order", () => {
    expect(CHANGELOG_HEADINGS.map((heading) => heading.id)).toEqual(
      CHANGELOG_ENTRIES.map((entry) => entry.anchor),
    );
    expect(CHANGELOG_HEADINGS.map((heading) => heading.label)).toEqual(
      CHANGELOG_ENTRIES.map((entry) => entry.title),
    );
  });

  it("formatChangelogDate renders long-form dates deterministically", () => {
    expect(formatChangelogDate("2026-10-05")).toBe("October 5, 2026");
    expect(formatChangelogDate("2026-10-03")).toBe("October 3, 2026");
    expect(formatChangelogDate("2026-01-01")).toBe("January 1, 2026");
  });
});

/* ------------------------------------------------------------------ */
/* (f) The page — data-driven render, full social card                 */
/* ------------------------------------------------------------------ */

describe("changelog page render (source contract)", () => {
  const source = read("../src/app/changelog/page.tsx");

  it("renders one article per entry, straight from the content module", () => {
    expect(source).toContain("CHANGELOG_ENTRIES.map");
    expect(source).toMatch(/CHANGELOG_ENTRIES\.map\(\(entry\) => \(\s*<article/s);
  });

  it("every entry renders its anchor, date and category chips", () => {
    expect(source).toMatch(/<a id=\{entry\.anchor\} \/>/);
    expect(source).toMatch(/dateTime=\{entry\.date\}/);
    expect(source).toContain("formatChangelogDate(entry.date)");
    expect(source).toContain('className="changelog-chips"');
    expect(source).toMatch(/entry\.categories\.map\(\(category\) =>/);
    expect(source).toContain('className="changelog-chip"');
  });

  it("the one-liner and optional detail render from data", () => {
    expect(source).toContain("{entry.oneLiner}");
    expect(source).toMatch(/entry\.detail !== undefined && <p[^>]*>\{entry\.detail\}<\/p>/);
  });

  it("ships the full social card like every other route", () => {
    expect(source).toContain('routeMetadata(routeMetaFor("/changelog"))');
  });
});
