import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_PAGES, DOCS_SECTIONS } from "../src/content/navigation.js";
import { QUICKSTART_HEADINGS } from "../src/content/quickstart.js";
import { CONCEPTS, CONCEPTS_HEADINGS } from "../src/content/core-concepts.js";
import { AUTH_HEADINGS } from "../src/content/api-reference/authentication.js";
import { ERRORS_HEADINGS } from "../src/content/api-reference/errors.js";
import { IDEMPOTENCY_HEADINGS } from "../src/content/api-reference/idempotency.js";
import { EXPAND_HEADINGS } from "../src/content/api-reference/expand.js";
import { PAGINATION_HEADINGS } from "../src/content/api-reference/pagination.js";
import { VERSIONING_HEADINGS } from "../src/content/api-reference/versioning.js";
import { WEBHOOKS_HEADINGS } from "../src/content/webhooks.js";
import { SDKS_HEADINGS } from "../src/content/sdks.js";
import { CHANGELOG_HEADINGS } from "../src/content/changelog.js";
import { QUICKSTART_STEPS } from "../src/content/quickstart.js";
import { SDKS_PHILOSOPHY, SDK_PY_TARGET, SDK_TS_TARGET, SDK_TS_TODAY } from "../src/content/sdks.js";
import {
  AUTH_CURL,
  AUTH_ERROR_EXAMPLE,
} from "../src/content/api-reference/authentication.js";
import {
  ERROR_CLASSES,
  ERROR_ENVELOPE_EXAMPLE,
  SDK_CATCH_EXAMPLE,
} from "../src/content/api-reference/errors.js";
import {
  IDEMPOTENCY_CONFLICT,
  IDEMPOTENCY_FIRST_CALL,
  IDEMPOTENCY_REPLAY_CALL,
  IDEMPOTENCY_SDK_EXAMPLE,
} from "../src/content/api-reference/idempotency.js";
import {
  EXPAND_REQUEST,
  EXPAND_RESPONSE,
  EXPAND_SDK_EXAMPLE,
} from "../src/content/api-reference/expand.js";
import {
  PAGINATION_FIRST,
  PAGINATION_FIRST_RESPONSE,
  PAGINATION_NEXT,
  PAGINATION_SDK_EXAMPLE,
} from "../src/content/api-reference/pagination.js";
import {
  VERSIONING_EXAMPLE,
  VERSIONING_SDK_EXAMPLE,
} from "../src/content/api-reference/versioning.js";
import {
  SIGNATURE_HEADER_EXAMPLE,
  SIGNATURE_VERIFY_PY,
  SIGNATURE_VERIFY_TS,
  WEBHOOK_EVENTS,
} from "../src/content/webhooks.js";
import { tokenize } from "../src/lib/highlight.js";
import type { CodeSample, TocEntry } from "../src/content/types.js";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Sidebar IA ⇄ App Router page files ⇄ TOC anchors (S1-004 laws). */
describe("docs information architecture", () => {
  it("every sidebar page maps to an existing app-router page file", () => {
    for (const page of ALL_PAGES) {
      const filePath = join(appRoot, "src", "app", page.path, "page.tsx");
      expect(existsSync(filePath), `missing page file for ${page.path}`).toBe(true);
    }
  });

  it("the home route exists", () => {
    expect(existsSync(join(appRoot, "src", "app", "page.tsx"))).toBe(true);
  });

  it("every page id and path is unique", () => {
    const ids = ALL_PAGES.map((page) => page.pageId);
    expect(new Set(ids).size).toBe(ids.length);
    const paths = ALL_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("the required S1-004 pages are all present in the IA", () => {
    const paths = new Set(ALL_PAGES.map((page) => page.path));
    for (const required of [
      "/get-started/quickstart",
      "/get-started/core-concepts",
      "/api-reference/authentication",
      "/api-reference/errors",
      "/api-reference/idempotent-requests",
      "/api-reference/expanding-responses",
      "/api-reference/pagination",
      "/api-reference/versioning",
      "/webhooks",
      "/sdks",
    ]) {
      expect(paths.has(required), `IA missing ${required}`).toBe(true);
    }
  });

  it("sections render from the four top-level groups", () => {
    expect(DOCS_SECTIONS.map((section) => section.id)).toEqual([
      "get-started",
      "api-reference",
      "webhooks",
      "sdks",
    ]);
  });
});

describe("per-page TOC anchors", () => {
  // The eleven TOC-bearing pages: the ten sidebar-IA content pages plus
  // the changelog feed (S5-002) — the "heading ids are unique within
  // every page" law covers every page with an on-this-page rail, no
  // exceptions (the home route is a hero page without a rail).
  const headingSets: readonly (readonly TocEntry[])[] = [
    QUICKSTART_HEADINGS,
    CONCEPTS_HEADINGS,
    AUTH_HEADINGS,
    ERRORS_HEADINGS,
    IDEMPOTENCY_HEADINGS,
    EXPAND_HEADINGS,
    PAGINATION_HEADINGS,
    VERSIONING_HEADINGS,
    WEBHOOKS_HEADINGS,
    SDKS_HEADINGS,
    CHANGELOG_HEADINGS,
  ];

  it("heading ids are unique within every page", () => {
    for (const headings of headingSets) {
      const ids = headings.map((heading) => heading.id);
      expect(new Set(ids).size, `duplicate anchors: ${ids.join(",")}`).toBe(ids.length);
    }
  });

  it("every core concept has an anchor section on the concepts page", () => {
    const conceptIds = new Set(CONCEPTS.map((concept) => concept.id));
    for (const heading of CONCEPTS_HEADINGS) {
      if (heading.level === 3) {
        expect(conceptIds.has(heading.id), `heading ${heading.id} has no concept entry`).toBe(
          true,
        );
      }
    }
  });
});

/** The highlighter must be lossless over every code sample in the portal. */
describe("mini highlighter covers every code sample losslessly", () => {
  const samples: CodeSample[] = [
    ...QUICKSTART_STEPS.flatMap((step) => [
      ...(step.tabs?.flatMap((tab) => tab.samples) ?? []),
      ...(step.extra ?? []),
    ]),
    AUTH_CURL,
    AUTH_ERROR_EXAMPLE,
    ERROR_ENVELOPE_EXAMPLE,
    SDK_CATCH_EXAMPLE,
    IDEMPOTENCY_FIRST_CALL,
    IDEMPOTENCY_REPLAY_CALL,
    IDEMPOTENCY_CONFLICT,
    IDEMPOTENCY_SDK_EXAMPLE,
    EXPAND_REQUEST,
    EXPAND_RESPONSE,
    EXPAND_SDK_EXAMPLE,
    PAGINATION_FIRST,
    PAGINATION_FIRST_RESPONSE,
    PAGINATION_NEXT,
    PAGINATION_SDK_EXAMPLE,
    VERSIONING_EXAMPLE,
    VERSIONING_SDK_EXAMPLE,
    SIGNATURE_HEADER_EXAMPLE,
    SIGNATURE_VERIFY_TS,
    SIGNATURE_VERIFY_PY,
    SDK_TS_TODAY,
    SDK_TS_TARGET,
    SDK_PY_TARGET,
    ...WEBHOOK_EVENTS.map((event) => ({
      language: "json" as const,
      code: event.payload,
    })),
  ];

  it("tokenizes every sample without losing characters", () => {
    for (const sample of samples) {
      const tokens = tokenize(sample.code, sample.language);
      const joined = tokens.map((token) => token.value).join("");
      expect(joined, `lossy tokenization (${sample.language}): ${sample.code.slice(0, 80)}…`).toBe(
        sample.code,
      );
    }
  });

  it("every json sample parses", () => {
    for (const sample of samples) {
      if (sample.language === "json") {
        expect(() => JSON.parse(sample.code), `unparseable JSON sample: ${sample.label}`).not.toThrow();
      }
    }
  });
});

/** Every content page ships real prose, not placeholder copy. */
describe("content honesty (no placeholder pages)", () => {
  it("every IA page file renders a PageHeader or hero with real copy", () => {
    for (const page of ALL_PAGES) {
      const filePath = join(appRoot, "src", "app", page.path, "page.tsx");
      const source = readFileSync(filePath, "utf8");
      expect(source.length).toBeGreaterThan(400);
      expect(source).toMatch(/lede|description/);
    }
  });

  it("webhook catalog carries the four mandated events", () => {
    const ids = WEBHOOK_EVENTS.map((event) => event.id);
    expect(ids).toEqual([
      "recommendation.delivered",
      "model.drift.detected",
      "schedule.executed",
      "preference.updated",
    ]);
  });

  it("quickstart exposes the three integration-option tabs", () => {
    const serveStep = QUICKSTART_STEPS.find((step) => step.id === "serve-your-first-recommendation");
    const tabs = serveStep?.tabs?.map((tab) => tab.id);
    expect(tabs).toEqual(["hosted", "sdk", "streaming"]);
  });

  it("error catalog exposes the four mandated classes", () => {
    expect(ERROR_CLASSES.map((errorClass) => errorClass.name)).toEqual([
      "invalid_request_error",
      "authentication_error",
      "rate_limit_error",
      "api_error",
    ]);
  });

  it("the component set referenced by pages exists on disk", () => {
    const componentsDir = join(appRoot, "src", "components");
    const files = readdirSync(componentsDir);
    for (const required of [
      "code-block.tsx",
      "code-tabs.tsx",
      "sidebar.tsx",
      "site-header.tsx",
      "on-this-page.tsx",
      "callout.tsx",
      "docs-table.tsx",
      "rich-text.tsx",
    ]) {
      expect(files, `missing component ${required}`).toContain(required);
    }
  });

  it("sdk philosophy and samples are populated", () => {
    expect(SDKS_PHILOSOPHY.length).toBeGreaterThanOrEqual(3);
    expect(SDK_TS_TODAY.code).toContain("createReckonClient");
    expect(SDK_PY_TARGET.code).toContain("ReckonClient");
  });
});
