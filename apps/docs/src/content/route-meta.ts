/**
 * Per-route metadata content (S5-002) — the single source of truth for
 * every route's `title` and `description`, consumed by each page module's
 * `metadata` export through `routeMetadata()` (src/lib/site-routes.ts) so
 * every route ships a full Open Graph + Twitter social card.
 *
 * Laws (work item S5-002):
 *  - covers EXACTLY the portal's public routes — the home, the ten content
 *    pages from the sidebar IA (navigation.ts), and /changelog; the set is
 *    cross-checked against src/lib/site-routes.ts PUBLIC_ROUTE_PATHS and
 *    the IA itself by test/docs-seo.test.ts (no import here — the sitemap
 *    module stays dependency-free, the S5-001 marketing convention);
 *  - titles/descriptions are the page-level copy that already existed per
 *    route (the root layout's "%s · Reckon Docs" title template applies on
 *    top for nested routes; the home's plain title is its own default).
 */

export interface RouteMetaEntry {
  /** App-router path beginning with "/". */
  readonly path: string;
  readonly title: string;
  readonly description: string;
}

/** Metadata for every public route, in reading order. */
export const DOCS_ROUTE_META: readonly RouteMetaEntry[] = [
  {
    path: "/",
    title: "Reckon Docs",
    description:
      "Reckon developer documentation — serve your first recommendation in five minutes, then go deeper on the API reference, webhooks and SDKs.",
  },
  {
    path: "/get-started/quickstart",
    title: "Quickstart — serve your first recommendation",
    description:
      "Serve your first Reckon recommendation in about five minutes: get a key, call the decision endpoint, read the result, close the loop with an outcome.",
  },
  {
    path: "/get-started/core-concepts",
    title: "Core concepts",
    description:
      "The Reckon vertical: catalog, context, candidates, experience, decision, schedule, outcome, preference delta — plus two-speed runtimes, host authority and evidence classes.",
  },
  {
    path: "/api-reference/authentication",
    title: "Authentication",
    description:
      "Reckon API keys: secret sk_ keys for the full API, publishable pk_ keys for browser-safe streaming, route scopes, and key safety.",
  },
  {
    path: "/api-reference/errors",
    title: "Errors",
    description:
      "Reckon's typed error catalog: invalid_request_error, authentication_error, rate_limit_error and api_error classes with stable codes and an HTTP mapping.",
  },
  {
    path: "/api-reference/idempotent-requests",
    title: "Idempotent requests",
    description:
      "Reckon idempotency: send an Idempotency-Key, and a retry with the same key and body replays the original response for 24 hours instead of executing twice.",
  },
  {
    path: "/api-reference/expanding-responses",
    title: "Expanding responses",
    description:
      "Inline referenced objects on demand with ?expand[] — the decision that references a catalog item can come back carrying the item itself.",
  },
  {
    path: "/api-reference/pagination",
    title: "Pagination",
    description:
      "Reckon lists are cursor-paginated: ask with limit, follow next_cursor while has_more is true.",
  },
  {
    path: "/api-reference/versioning",
    title: "Versioning",
    description:
      "Pin the Reckon API version with the Reckon-Version header; breaking changes only ship as new versions, supported for at least 12 months after their successor.",
  },
  {
    path: "/webhooks",
    title: "Webhooks",
    description:
      "Reckon webhook events: recommendation.delivered, model.drift.detected, schedule.executed, preference.updated — with HMAC signature verification, retries and replay.",
  },
  {
    path: "/sdks",
    title: "SDKs",
    description:
      "Reckon reference SDKs for TypeScript and Python: typed clients over the frozen contracts, with contract validation on both sides and typed errors.",
  },
  {
    path: "/changelog",
    title: "Changelog",
    description:
      "What changed on Reckon, newest first: dated, categorized release notes for the API, SDKs, dashboard, docs and platform — every entry a repository fact.",
  },
];

const BY_PATH: ReadonlyMap<string, RouteMetaEntry> = new Map(
  DOCS_ROUTE_META.map((entry) => [entry.path, entry]),
);

/** Look up one route's metadata content — throws loudly on a path typo. */
export function routeMetaFor(path: string): RouteMetaEntry {
  const entry = BY_PATH.get(path);
  if (entry === undefined) {
    throw new Error(`No DOCS_ROUTE_META entry for path "${path}" — add it in src/content/route-meta.ts`);
  }
  return entry;
}
