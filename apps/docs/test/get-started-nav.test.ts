/**
 * Get-started track nav + pager wiring (S5-002) — contract tests.
 *
 * Laws under test (work item S5-002, task packet e):
 *  e. the track nav data (src/content/get-started-nav.ts) covers
 *     EXACTLY the "Get started" + "API reference" sidebar sections —
 *     every page of both sections, in sidebar order, with no gaps and
 *     no duplicates — and the Previous/Next pager on the track pages is
 *     driven by that data (each track page wires DocsPager with its own
 *     path; off-track pages wire nothing).
 *
 * Conventions: .js-suffixed relative imports (NodeNext typecheck
 * compatibility), readFileSync source contracts for page/component
 * modules ("@/" alias), vitest from the repo root, no network.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  GET_STARTED_TRACK,
  TRACK_SECTION_IDS,
  trackNeighbors,
} from "../src/content/get-started-nav.js";
import { DOCS_SECTIONS } from "../src/content/navigation.js";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, relative), "utf8");

/** The pages of the two track sections, in sidebar order. */
const trackSections = DOCS_SECTIONS.filter((section) => TRACK_SECTION_IDS.includes(section.id));
const expectedTrack = trackSections.flatMap((section) =>
  section.pages.map((page) => ({ id: page.id, title: page.title, path: page.path })),
);

/** Off-track routes: everything else the portal serves. */
const OFF_TRACK_PATHS = ["/", "/webhooks", "/sdks", "/changelog"];

describe("get-started track data (no gaps, no duplicates)", () => {
  it("covers exactly the get-started + api-reference sections, in sidebar order", () => {
    expect(TRACK_SECTION_IDS).toEqual(["get-started", "api-reference"]);
    expect(GET_STARTED_TRACK).toEqual(expectedTrack);
  });

  it("is the eight-page reading track: quickstart → versioning", () => {
    expect(GET_STARTED_TRACK.map((entry) => entry.path)).toEqual([
      "/get-started/quickstart",
      "/get-started/core-concepts",
      "/api-reference/authentication",
      "/api-reference/errors",
      "/api-reference/idempotent-requests",
      "/api-reference/expanding-responses",
      "/api-reference/pagination",
      "/api-reference/versioning",
    ]);
  });

  it("has no duplicate ids or paths", () => {
    expect(new Set(GET_STARTED_TRACK.map((entry) => entry.id)).size).toBe(GET_STARTED_TRACK.length);
    expect(new Set(GET_STARTED_TRACK.map((entry) => entry.path)).size).toBe(
      GET_STARTED_TRACK.length,
    );
  });

  it("every track path maps to an existing app-router page file", () => {
    for (const entry of GET_STARTED_TRACK) {
      const file = join(here, "..", "src", "app", entry.path, "page.tsx");
      expect(existsSync(file), `missing page file for ${entry.path}`).toBe(true);
    }
  });
});

describe("trackNeighbors (the pager's data)", () => {
  it("the first stop has no previous, only a next", () => {
    const { prev, next } = trackNeighbors(GET_STARTED_TRACK[0].path);
    expect(prev).toBeUndefined();
    expect(next?.path).toBe(GET_STARTED_TRACK[1].path);
  });

  it("the last stop has no next, only a previous", () => {
    const last = GET_STARTED_TRACK[GET_STARTED_TRACK.length - 1];
    const { prev, next } = trackNeighbors(last.path);
    expect(next).toBeUndefined();
    expect(prev?.path).toBe(GET_STARTED_TRACK[GET_STARTED_TRACK.length - 2].path);
  });

  it("every middle stop neighbors its immediate track neighbors", () => {
    for (let i = 1; i < GET_STARTED_TRACK.length - 1; i += 1) {
      const { prev, next } = trackNeighbors(GET_STARTED_TRACK[i].path);
      expect(prev?.path, `prev of ${GET_STARTED_TRACK[i].path}`).toBe(GET_STARTED_TRACK[i - 1].path);
      expect(next?.path, `next of ${GET_STARTED_TRACK[i].path}`).toBe(GET_STARTED_TRACK[i + 1].path);
    }
  });

  it("neighbors carry titles (the pager renders them, not raw paths)", () => {
    for (const entry of GET_STARTED_TRACK) {
      const { prev, next } = trackNeighbors(entry.path);
      for (const neighbor of [prev, next]) {
        if (neighbor !== undefined) {
          expect(neighbor.title.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("off-track routes have no neighbors (the pager renders nothing)", () => {
    for (const path of OFF_TRACK_PATHS) {
      expect(trackNeighbors(path), `${path} must be off-track`).toEqual({});
    }
  });
});

describe("pager wiring (source contract)", () => {
  it("every track page wires DocsPager with its own path", () => {
    for (const entry of GET_STARTED_TRACK) {
      const source = read(`../src/app${entry.path}/page.tsx`);
      expect(
        source.includes(`<DocsPager currentPath="${entry.path}" />`),
        `${entry.path} does not wire its DocsPager`,
      ).toBe(true);
    }
  });

  it("off-track pages wire no pager", () => {
    const offTrackFiles = [
      "../src/app/page.tsx",
      "../src/app/webhooks/page.tsx",
      "../src/app/sdks/page.tsx",
      "../src/app/changelog/page.tsx",
    ];
    for (const file of offTrackFiles) {
      expect(read(file).includes("DocsPager"), `${file} wires an off-track pager`).toBe(false);
    }
  });

  it("the DocsPager component renders data-driven neighbors and nulls off-track", () => {
    const source = read("../src/components/docs-pager.tsx");
    expect(source).toContain("trackNeighbors(currentPath)");
    expect(source).toMatch(/prev === undefined && next === undefined/);
    expect(source).toContain('aria-label="Previous and next documentation pages"');
    expect(source).toMatch(/← Previous/);
    expect(source).toMatch(/Next →/);
  });
});
