/**
 * Docs sidebar IA (S1-004) — the full information architecture of the
 * portal, mirroring the docs.stripe.com taxonomy analog from
 * docs/surveys/stripe-com-survey.md §3:
 *
 *   Get started · API reference · Webhooks · SDKs
 *
 * `status` marks TARGET-contract surfaces that ship with the S2 lane
 * (S2-001 API hardening, S2-002 webhooks, S2-004 reference SDKs) so the
 * portal never over-claims what the v0.1.0 API implements today.
 */

import type { DocsSection } from "./types.js";

export const DOCS_SECTIONS: readonly DocsSection[] = [
  {
    id: "get-started",
    title: "Get started",
    pages: [
      {
        id: "quickstart",
        title: "Quickstart",
        path: "/get-started/quickstart",
        description: "Serve your first recommendation in about five minutes.",
      },
      {
        id: "core-concepts",
        title: "Core concepts",
        path: "/get-started/core-concepts",
        description: "The Reckon vertical: catalog → context → candidates → experience → decision → schedule → outcome → preference delta.",
      },
    ],
  },
  {
    id: "api-reference",
    title: "API reference",
    pages: [
      {
        id: "authentication",
        title: "Authentication",
        path: "/api-reference/authentication",
        description: "sk_/pk_ API keys, scopes, and test mode.",
        status: "target",
      },
      {
        id: "errors",
        title: "Errors",
        path: "/api-reference/errors",
        description: "Typed error classes, stable codes, and HTTP mapping.",
        status: "target",
      },
      {
        id: "idempotency",
        title: "Idempotent requests",
        path: "/api-reference/idempotent-requests",
        description: "Replay-safe POSTs with Idempotency-Key semantics.",
        status: "target",
      },
      {
        id: "expanding-responses",
        title: "Expanding responses",
        path: "/api-reference/expanding-responses",
        description: "Inline referenced objects with ?expand[].",
        status: "target",
      },
      {
        id: "pagination",
        title: "Pagination",
        path: "/api-reference/pagination",
        description: "Cursor-based lists with has_more / next_cursor.",
        status: "target",
      },
      {
        id: "versioning",
        title: "Versioning",
        path: "/api-reference/versioning",
        description: "Pin the API version per request.",
        status: "target",
      },
    ],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    pages: [
      {
        id: "webhooks",
        title: "Event catalog & signatures",
        path: "/webhooks",
        description: "recommendation.delivered, model.drift.detected, schedule.executed, preference.updated + HMAC verification.",
        status: "target",
      },
    ],
  },
  {
    id: "sdks",
    title: "SDKs",
    pages: [
      {
        id: "sdks",
        title: "TypeScript & Python",
        path: "/sdks",
        description: "Reference SDKs over the frozen Reckon contracts.",
        status: "target",
      },
    ],
  },
];

/** Flat page lookup derived from the IA. */
export const ALL_PAGES: readonly {
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly pageId: string;
  readonly title: string;
  readonly path: string;
  readonly description: string;
  readonly status?: "live" | "target";
}[] = DOCS_SECTIONS.flatMap((section) =>
  section.pages.map((page) => ({
    sectionId: section.id,
    sectionTitle: section.title,
    pageId: page.id,
    title: page.title,
    path: page.path,
    description: page.description,
    status: page.status,
  })),
);

export function findPage(path: string): { section: DocsSection } | undefined {
  for (const section of DOCS_SECTIONS) {
    if (section.pages.some((page) => page.path === path)) return { section };
  }
  return undefined;
}
