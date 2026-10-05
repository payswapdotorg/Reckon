/**
 * API reference — Authentication (S1-004).
 *
 * Documents the TARGET sk_/pk_ key model per docs/surveys/stripe-com-survey.md
 * §3 (S2-001 lands the implementation; S2-003 adds test mode), bridged
 * honestly to the v0.1.0 static-key API that ships today.
 */

import type { TocEntry } from "../types.js";

export const AUTH_HEADINGS: readonly TocEntry[] = [
  { id: "key-model", label: "Key model", level: 2 },
  { id: "using-a-key", label: "Using a key", level: 2 },
  { id: "scopes", label: "Scopes", level: 2 },
  { id: "key-safety", label: "Key safety & rotation", level: 2 },
];

export const KEY_MODEL_ROWS: readonly (readonly string[])[] = [
  ["`sk_live_…`", "Secret key", "Full API access for one live tenant. Server-side only."],
  ["`sk_test_…`", "Secret test key", "Full API access in test mode — canned scenarios, no live learning."],
  ["`pk_live_…`", "Publishable key", "Restricted, browser-safe: decision **streaming reads** only."],
  ["`pk_test_…`", "Publishable test key", "Streaming reads against test mode."],
  ["`whsec_…`", "Webhook signing secret", "Per-endpoint HMAC key for [webhook verification](/webhooks)."],
];

export const AUTH_STATUS = {
  variant: "target" as const,
  label: "Target contract · lands with S2-001 (keys) + S2-003 (test mode)",
};

export const AUTH_CURL = {
  language: "bash" as const,
  label: "Authenticated request",
  code: `curl https://api.reckon.dev/v1/decisions/dec_01J8ZWM6X4 \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39"`,
  caption:
    "Tenant identity comes **exclusively** from the key — a `tenant` value in the request body that disagrees with the key is rejected with `403 tenant_mismatch`.",
};

export const AUTH_ERROR_EXAMPLE = {
  language: "json" as const,
  label: "401 · authentication_error",
  code: `{
  "error": {
    "type": "authentication_error",
    "code": "invalid_api_key",
    "message": "Unknown or invalid API key.",
    "details": {
      "scheme": "Bearer"
    }
  }
}`,
};

export const SCOPES_ROWS: readonly (readonly string[])[] = [
  ["`decisions`", "POST/GET `/v1/decisions` — request and look up decisions."],
  ["`outcomes`", "POST `/v1/outcomes` — append outcome events."],
  ["`plans`", "Create, replan, read experience plans."],
  ["`catalog`", "Upsert catalog items and realizations."],
  ["`candidates`", "Submit candidate sets."],
  ["`experiences`", "Resolve items/realizations into experiences."],
  ["`preferences`", "Append preference deltas."],
  ["`research`", "Enqueue and read research jobs."],
  ["`agents`", "Agent Body and Agent Organization declarations."],
  ["`integrations`", "Adapter declarations (read-only)."],
];

export const KEY_SAFETY_BULLETS: readonly string[] = [
  "Secret keys live in server environment variables or a secrets manager — never in git, client code, or logs.",
  "Keys are stored hashed (sha-256) server-side; the raw key is never logged and never echoed in error messages.",
  "Rotate by creating the new key, deploying it, then revoking the old one — both work during the overlap.",
  "Publishable keys are safe to expose, but scoped: they cannot write, and they cannot read other tenants.",
];
