/**
 * API reference — Pagination (S1-004).
 *
 * Cursor-based list pagination per the survey §3: `has_more` /
 * `next_cursor` with a single forward cursor. TARGET envelope (S2-001);
 * the list routes themselves already exist in v0.1.0
 * (GET /v1/plans?limit=N, /v1/agents/bodies?limit=N, /v1/research/jobs).
 */

import type { TocEntry } from "../types.js";

export const PAGINATION_HEADINGS: readonly TocEntry[] = [
  { id: "cursor-model", label: "The cursor model", level: 2 },
  { id: "example", label: "Example: walk recent plans", level: 2 },
  { id: "rules", label: "Rules", level: 2 },
];

export const PAGINATION_PARAMS: readonly (readonly string[])[] = [
  ["`limit`", "Page size — default `20`, max `100`."],
  ["`cursor`", "Opaque forward cursor from the previous page's `next_cursor`. Never construct it yourself."],
];

export const PAGINATION_FIRST = {
  language: "bash" as const,
  label: "First page",
  code: `curl "https://api.reckon.dev/v1/plans?limit=2" \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39"`,
};

export const PAGINATION_FIRST_RESPONSE = {
  language: "json" as const,
  label: "Response · 200 OK",
  code: `{
  "data": [
    {
      "schema": "reckon.experience-plan",
      "schemaVersion": "0.1.0",
      "planId": "plan_01J9B8K3T6",
      "tenant": { "tenantId": "demo" },
      "version": 4
    },
    {
      "schema": "reckon.experience-plan",
      "schemaVersion": "0.1.0",
      "planId": "plan_01J9B4M7Q2",
      "tenant": { "tenantId": "demo" },
      "version": 2
    }
  ],
  "has_more": true,
  "next_cursor": "plan_01J9B4M7Q2"
}`,
  caption: "Trimmed for brevity — real entries are the full frozen plan contract.",
};

export const PAGINATION_NEXT = {
  language: "bash" as const,
  label: "Next page",
  code: `curl "https://api.reckon.dev/v1/plans?limit=2&cursor=plan_01J9B4M7Q2" \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39"`,
  caption:
    "When `has_more` is `false`, `next_cursor` is absent — stop paging. The loop is `has_more`, not a null cursor.",
};

export const PAGINATION_SDK_EXAMPLE = {
  language: "typescript" as const,
  label: "SDK — auto-paginating loop (target, S2-004)",
  code: `// Reference SDK target shape: an async iterator over every page.
for await (const plan of reckon.plans.list({ limit: 100 })) {
  await archive(plan);
}`,
  caption:
    "The iterator follows `next_cursor` for you and is safe against append-only growth (plans are versioned, never mutated in place).",
};

export const PAGINATION_RULES: readonly string[] = [
  "Single forward cursor — list endpoints are ordered newest-first and there is no `ending_before`.",
  "Cursors are **opaque**: encode position only, never offsets, so pages stay stable while new records arrive (Reckon's stores are append-only).",
  "`has_more: false` means the end — `next_cursor` is omitted.",
  "Order is stable per collection, not configurable; sort views belong in your dashboard, not the API.",
  "Empty pages return `data: []` with `has_more: false` — not an error.",
];
