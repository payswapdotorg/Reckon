/**
 * API reference — Expanding responses (S1-004).
 *
 * ?expand[]=… semantics per the survey §3: references that normally come
 * back as ids can be inlined on request. TARGET surface (S2-001); the
 * shapes expand INTO are the frozen contracts (catalog item,
 * realization, experience).
 */

import type { TocEntry } from "../types.js";
import { catalogItemExample, realizationExample } from "../fixtures/index.js";

export const EXPAND_HEADINGS: readonly TocEntry[] = [
  { id: "how-expansion-works", label: "How expansion works", level: 2 },
  { id: "example", label: "Example: expand the selected experience's item", level: 2 },
  { id: "rules", label: "Rules & performance", level: 2 },
];

export const EXPAND_REQUEST = {
  language: "bash" as const,
  label: "Request",
  code: `curl "https://api.reckon.dev/v1/decisions/dec_01J8ZWM6X4?expand[]=selectedExperience.item&expand[]=selectedExperience.realization" \\
  -H "Authorization: Bearer sk_test_51DmReckonExampleKey4eC39"`,
  caption:
    "Dot paths follow the response's field names (camelCase, like the contracts). Repeat `expand[]` for each path.",
};

/** Hand-composed TARGET response: decision result with expanded sub-objects. */
export const EXPAND_RESPONSE = {
  language: "json" as const,
  label: "Response · 200 OK (expanded)",
  code: JSON.stringify(
    {
      schema: "reckon.decision-result",
      schemaVersion: "0.1.0",
      decisionId: "dec_01J8ZWM6X4",
      requestId: "req_01J8ZWK3Q7",
      tenant: { tenantId: "demo" },
      action: "SUGGEST",
      selectedExperience: {
        experienceId: "exp_01J8ZWM8T2",
        itemId: "item_reef_doc",
        realizationId: "rlz_reef_en_hd",
        format: { kind: "card", params: { headline: "20 min · calm coral reefs", maxWidth: 360 } },
        // Expanded inline because of ?expand[]:
        item: catalogItemExample,
        realization: realizationExample,
      },
      at: 1769997720123,
    },
    null,
    2,
  ),
  caption:
    "`item` and `realization` appear **only** because they were requested. Without `expand[]` the response carries just `itemId` / `realizationId` — the unexpanded quickstart response is the contract-exact default.",
};

export const EXPAND_RULES: readonly string[] = [
  "Expansion is **opt-in per request** — default responses stay lean and contract-exact.",
  "Paths are relative to the response object and use the contract's field names (`selectedExperience.item`, not `selected_experience.item`).",
  "Expanded objects are the real frozen payloads (`reckon.catalog-item`, `reckon.realization`, …), not summaries.",
  "Deep chaining (`?expand[]=selectedExperience.item.availability`) is rejected with `400 validation_error` — expand one relation at a time.",
  "Every expanded relation adds a read: expand what a screen actually renders, not everything it could.",
];

export const EXPAND_SDK_EXAMPLE = {
  language: "typescript" as const,
  label: "SDK target (S2-001 / S2-004)",
  code: `const decision = await reckon.decisions.get("dec_01J8ZWM6X4", {
  expand: ["selectedExperience.item", "selectedExperience.realization"],
});

console.log(decision.selectedExperience?.item?.attributes?.title);`,
};
