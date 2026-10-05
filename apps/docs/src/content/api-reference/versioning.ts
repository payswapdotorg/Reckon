/**
 * API reference — Versioning (S1-004).
 *
 * Version pinning per the survey §3: a Reckon-Version header on every
 * request, an account-level default, and dated API versions. TARGET
 * surface (S2-001); today every payload already self-describes with
 * `schema` + `schemaVersion` and /healthz reports the API version.
 */

import type { TocEntry } from "../types.js";

export const VERSIONING_HEADINGS: readonly TocEntry[] = [
  { id: "pinning-a-version", label: "Pinning a version", level: 2 },
  { id: "what-a-version-covers", label: "What a version covers", level: 2 },
  { id: "example", label: "Example", level: 2 },
  { id: "changelog", label: "Changelog", level: 2 },
];

export const VERSIONING_EXAMPLE = {
  language: "bash" as const,
  label: "Pinned request",
  code: `curl https://api.reckon.dev/v1/decisions/dec_01J8ZWM6X4 \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39" \\
  -H "Reckon-Version: 2026-10-01"`,
  caption:
    "Omit the header and the account's pinned default is used (set in the dashboard) — pinning per request is for gradual rollouts and tests.",
};

export const VERSIONING_SDK_EXAMPLE = {
  language: "typescript" as const,
  label: "SDK",
  code: `const reckon = createReckonClient({
  baseUrl: "https://api.reckon.dev",
  apiKey: process.env.RECKON_API_KEY!,
  apiVersion: "2026-10-01", // sent as Reckon-Version on every call
});`,
};

export const VERSIONING_ROWS: readonly (readonly string[])[] = [
  ["`Reckon-Version`", "Date-shaped (`2026-10-01`). Applied to the whole request: routing, envelopes, error taxonomy."],
  ["Account default", "Pinned in the dashboard; new versions never apply silently."],
  ["Contract self-description", "Every payload carries `schema` (`reckon.decision-result`) + `schemaVersion` (`0.1.0`) — independent of the API version."],
  ["Breaking changes", "Ship only as a **new** version; frozen contracts additionally require a TL3 Architecture Change Record."],
  ["Support window", "Every version is supported for at least 12 months after its successor ships."],
  ["Additive changes", "New optional fields and new event types land in-place — code that ignores unknown fields is always safe."],
];

export const CHANGELOG_ROWS: readonly (readonly string[])[] = [
  ["`2026-10-01`", "Initial GA version (target, S2-001): sk_/pk_ keys, typed error classes, Idempotency-Key header, `?expand[]`, cursor pagination."],
  ["`0.1.0` (contracts)", "The frozen contract registry all payloads self-describe against — live today (CONTRACT-001)."],
];
