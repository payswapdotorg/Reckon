import { DocsLink } from "./docs-link.js";
import { trackNeighbors } from "@/content/get-started-nav.js";

/**
 * Previous / Next pager (S5-002) — stripe-docs style bottom navigation
 * over the get-started reading track (quickstart → core concepts → the
 * six API-reference pages). The track order comes from the typed nav-data
 * module src/content/get-started-nav.ts (derived from the sidebar IA), so
 * the pager and the sidebar can never disagree.
 *
 * Server component: neighbors are resolved from data at build time — no
 * client JavaScript. Pages off the track render nothing.
 */
export function DocsPager({ currentPath }: { currentPath: string }) {
  const { prev, next } = trackNeighbors(currentPath);
  if (prev === undefined && next === undefined) {
    return null;
  }
  return (
    <nav className="docs-pager" aria-label="Previous and next documentation pages">
      {prev !== undefined ? (
        <DocsLink href={prev.path} className="pager-card pager-prev">
          <span className="pager-label" aria-hidden="true">
            ← Previous
          </span>
          <span className="pager-title">{prev.title}</span>
        </DocsLink>
      ) : (
        <span className="pager-card pager-spacer" aria-hidden="true" />
      )}
      {next !== undefined ? (
        <DocsLink href={next.path} className="pager-card pager-next">
          <span className="pager-label" aria-hidden="true">
            Next →
          </span>
          <span className="pager-title">{next.title}</span>
        </DocsLink>
      ) : (
        <span className="pager-card pager-spacer" aria-hidden="true" />
      )}
    </nav>
  );
}
