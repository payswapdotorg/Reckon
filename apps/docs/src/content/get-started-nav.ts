/**
 * Get-started track nav data (S5-002) — the ordered reading track that the
 * Previous/Next pager (src/components/docs-pager.tsx) is driven by,
 * stripe-docs style:
 *
 *   Quickstart → Core concepts → Authentication → Errors →
 *   Idempotent requests → Expanding responses → Pagination → Versioning
 *
 * Derived from the sidebar IA (navigation.ts) so the track and the sidebar
 * can never disagree: exactly the "Get started" + "API reference" sections,
 * in sidebar order, with no gaps and no duplicates (asserted by
 * test/get-started-nav.test.ts).
 */

import { DOCS_SECTIONS } from "./navigation.js";
import type { DocsPageRef } from "./types.js";

/** The section ids that make up the reading track. */
export const TRACK_SECTION_IDS: readonly string[] = ["get-started", "api-reference"];

/** One stop on the reading track — the IA page, flattened. */
export interface GetStartedTrackEntry {
  readonly id: string;
  readonly title: string;
  readonly path: string;
}

function toTrackEntry(page: DocsPageRef): GetStartedTrackEntry {
  return { id: page.id, title: page.title, path: page.path };
}

/** The full ordered track — get-started pages first, then the API reference. */
export const GET_STARTED_TRACK: readonly GetStartedTrackEntry[] = DOCS_SECTIONS.filter(
  (section) => TRACK_SECTION_IDS.includes(section.id),
).flatMap((section) => section.pages.map(toTrackEntry));

/** The neighbors of a track path — `undefined` at the ends, `{}` off-track. */
export function trackNeighbors(
  path: string,
): { prev?: GetStartedTrackEntry; next?: GetStartedTrackEntry } {
  const index = GET_STARTED_TRACK.findIndex((entry) => entry.path === path);
  if (index === -1) return {};
  return {
    prev: index > 0 ? GET_STARTED_TRACK[index - 1] : undefined,
    next: index < GET_STARTED_TRACK.length - 1 ? GET_STARTED_TRACK[index + 1] : undefined,
  };
}
