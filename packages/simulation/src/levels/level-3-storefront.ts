/**
 * SIM-002 — Ladder Level 3: the E-COMMERCE STOREFRONT synthetic host.
 *
 * Ladder definition:
 *   "E-commerce storefront — variants, price, availability, constraints, conversion."
 *
 * Mapping the storefront domain onto the frozen contracts (nothing
 * domain-specific is added to Reckon — the kernel stays generic):
 * - VARIANTS: each product item declares MULTIPLE realizations (size /
 *   color / capacity variants) — the frozen Realization is the variant
 *   surface, exactly as the cross-adapter conformance table uses it.
 * - PRICE + AVAILABILITY: price and stock are host-owned realization
 *   delivery characteristics (Realization.constraints — opaque to the
 *   core); availability windows ride CatalogItem.availableFrom/Until
 *   and gate retrieval host-side. The host decrements its OWN stock on
 *   conversion, EXCLUDES sold-out variants from subsequent retrieval,
 *   and does not re-surface products already seen this session —
 *   availability/consumption world-state transitions that feed back
 *   through candidates.
 * - CONSTRAINTS: every decision request declares five hard-constraint
 *   kinds: time-window (promo window), max-cost (cart budget),
 *   catalog-rule (host-side stock gate), policy-rights (host-owned
 *   payment eligibility gate) and custom (cart capacity).
 * - CONVERSION: outcome events are impression (viewed) or conversion
 *   (purchased) with order-value metrics; category preference deltas
 *   follow (+0.4 on conversion, ×0.98 decay on impression) and re-rank
 *   the next retrieval.
 *
 * RIGHTS/PRICE AUTHORITY STAYS HOST-OWNED (architecture law): Reckon
 * never sees or owns pricing rights — the policy-rights constraint
 * references a HOST gate id. This is the architecture working as
 * designed, recorded as HOST_RESPONSIBILITY / RIGHTS_POLICY_BOUNDARY
 * notes in the level report (not a Reckon gap).
 *
 * LAWS: zero internal imports; no Math.random / Date.now / wall clock /
 * LLM / network; synthetic outcomes are evidenceClass "fixture";
 * deterministic given (seed, fresh host factory) — replay gate applies.
 *
 * Glue (honest; re-verified mechanically by levels.test.ts): `loc` =
 * comment-stripped non-blank lines of this module; `customAdapterLoc`
 * = lines inside the glue:adapter markers; `functions` =
 * createLevel3WorldState, inStockVariantsOf, isListableAt, rankProducts,
 * isConversionStep, variantPriceOf, decrementStock,
 * categoryWeightUpdate, buildStorefrontConstraints,
 * provideDecisionInputs, consumeDecision, provideOutcome,
 * providePreferenceDelta, createLevel3StorefrontHost (14).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

const TENANT: TenantScope = { tenantId: "tenant-l3-storefront" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l3-shopper-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The storefront world: 6 products with size/capacity variants; price and
// stock are host-owned realization delivery characteristics; category
// preference weights re-rank retrieval; stock decrements on conversion.

interface ProductVariant {
  readonly realizationId: string;
  readonly label: string;
  readonly priceUsd: number;
  stock: number;
}

interface StorefrontProduct {
  readonly itemId: string;
  readonly title: string;
  readonly category: string;
  readonly brand: string;
  readonly variants: ProductVariant[];
  readonly availableFrom?: number;
  readonly availableUntil?: number;
}

const STOREFRONT_PRODUCTS: StorefrontProduct[] = [
  {
    itemId: "l3-tee-01",
    title: "Merino runner tee",
    category: "apparel",
    brand: "alpine",
    variants: [
      { realizationId: "l3-real-tee-s", label: "S", priceUsd: 19.5, stock: 1 },
      { realizationId: "l3-real-tee-m", label: "M", priceUsd: 19.5, stock: 4 },
      { realizationId: "l3-real-tee-l", label: "L", priceUsd: 21.0, stock: 2 },
    ],
  },
  {
    itemId: "l3-shoe-01",
    title: "Trail shoe",
    category: "footwear",
    brand: "crest",
    variants: [
      { realizationId: "l3-real-shoe-42", label: "EU 42", priceUsd: 89.0, stock: 2 },
      { realizationId: "l3-real-shoe-43", label: "EU 43", priceUsd: 89.0, stock: 1 },
    ],
  },
  {
    itemId: "l3-bottle-01",
    title: "Insulated bottle 750ml",
    category: "gear",
    brand: "summit",
    variants: [{ realizationId: "l3-real-bottle-750", label: "750ml", priceUsd: 24.0, stock: 5 }],
  },
  {
    itemId: "l3-sock-01",
    title: "Wool sock pair",
    category: "apparel",
    brand: "alpine",
    variants: [{ realizationId: "l3-real-sock-1pair", label: "1 pair", priceUsd: 12.0, stock: 6 }],
  },
  {
    itemId: "l3-lamp-01",
    title: "Headlamp 200lm",
    category: "gear",
    brand: "summit",
    availableFrom: 0,
    variants: [{ realizationId: "l3-real-lamp-200", label: "200lm", priceUsd: 34.5, stock: 3 }],
  },
  {
    itemId: "l3-shell-01",
    title: "Rain shell",
    category: "apparel",
    brand: "crest",
    availableUntil: 600_000,
    variants: [{ realizationId: "l3-real-shell-m", label: "M", priceUsd: 129.0, stock: 2 }],
  },
];

const STOREFRONT_CATEGORIES: readonly string[] = ["apparel", "footwear", "gear"];

interface Level3WorldState {
  stockByRealization: Map<string, number>;
  categoryWeights: Map<string, number>;
  seenItems: Set<string>;
  impressions: number;
  conversions: number;
  soldOutRealizations: string[];
  /** The single per-step weight transition (applied once, declared once). */
  lastWeightTransition: { category: string; oldValue: number; newValue: number } | undefined;
  presentedLog: { step: number; itemId: string; realizationId: string; eventType: string; orderValueUsd: number }[];
}

export interface Level3WorldView {
  readonly stockByRealization: ReadonlyMap<string, number>;
  readonly categoryWeights: ReadonlyMap<string, number>;
  readonly impressions: number;
  readonly conversions: number;
  readonly soldOutRealizations: readonly string[];
  readonly presentedLog: readonly {
    step: number;
    itemId: string;
    realizationId: string;
    eventType: string;
    orderValueUsd: number;
  }[];
}

function createLevel3WorldState(): Level3WorldState {
  const stockByRealization = new Map<string, number>();
  for (const product of STOREFRONT_PRODUCTS) {
    for (const variant of product.variants) stockByRealization.set(variant.realizationId, variant.stock);
  }
  const categoryWeights = new Map<string, number>();
  for (const category of STOREFRONT_CATEGORIES) categoryWeights.set(category, 1.0);
  return {
    stockByRealization,
    categoryWeights,
    seenItems: new Set(),
    impressions: 0,
    conversions: 0,
    soldOutRealizations: [],
    lastWeightTransition: undefined,
    presentedLog: [],
  };
}

/** In-stock variant ids of a product (availability gate host-side). */
function inStockVariantsOf(product: StorefrontProduct, stock: ReadonlyMap<string, number>): string[] {
  return product.variants.filter((variant) => (stock.get(variant.realizationId) ?? 0) > 0).map((variant) => variant.realizationId);
}

/** The host's availability gate: an item is listable inside its
 *  declared availability window, in the host's own time base
 *  (step · 60s — the same base as the time-window constraint). */
function isListableAt(product: StorefrontProduct, hostNowMs: number): boolean {
  if (product.availableFrom !== undefined && hostNowMs < product.availableFrom) return false;
  if (product.availableUntil !== undefined && hostNowMs > product.availableUntil) return false;
  return true;
}

/** Preference + stock + availability driven retrieval: category weight
 *  DESC, then index; unseen products only (a browsing session never
 *  re-surfaces the same product). */
function rankProducts(weights: ReadonlyMap<string, number>, stock: ReadonlyMap<string, number>, seen: ReadonlySet<string>, hostNowMs: number) {
  const available = STOREFRONT_PRODUCTS.filter(
    (product) =>
      !seen.has(product.itemId) &&
      isListableAt(product, hostNowMs) &&
      inStockVariantsOf(product, stock).length > 0,
  );
  const pool = available.length > 0 ? available : STOREFRONT_PRODUCTS.filter((product) => inStockVariantsOf(product, stock).length > 0);
  const ordered = [...pool].sort((a, b) => {
    const byWeight = (weights.get(b.category) ?? 1.0) - (weights.get(a.category) ?? 1.0);
    if (byWeight !== 0) return byWeight;
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
    return a.itemId < b.itemId ? -1 : 1;
  });
  return ordered.map((product, index) => ({
    itemId: product.itemId,
    realizationIds: inStockVariantsOf(product, stock),
    source: "host-storefront-retrieval",
    rankHint: index + 1,
  }));
}

/** The synthetic shopper converts every 3rd step (scripted pattern). */
function isConversionStep(step: number): boolean {
  return step % 3 === 0;
}

function variantPriceOf(realizationId: string): number {
  for (const product of STOREFRONT_PRODUCTS) {
    const variant = product.variants.find((entry) => entry.realizationId === realizationId);
    if (variant !== undefined) return variant.priceUsd;
  }
  return 0;
}

/** Stock transition on conversion; sold-out ledger for retrieval. */
function decrementStock(state: Level3WorldState, realizationId: string): number {
  const current = state.stockByRealization.get(realizationId) ?? 0;
  const next = Math.max(0, current - 1);
  state.stockByRealization.set(realizationId, next);
  if (next === 0 && !state.soldOutRealizations.includes(realizationId)) {
    state.soldOutRealizations.push(realizationId);
  }
  return next;
}

/** Category affinity transition: +0.4 on conversion, ×0.98 on impression. */
function categoryWeightUpdate(weights: Map<string, number>, category: string, eventType: string): number {
  const current = weights.get(category) ?? 1.0;
  const next = eventType === "conversion" ? Math.min(3.0, current + 0.4) : current * 0.98;
  weights.set(category, next);
  return next;
}

/** Five hard-constraint kinds on every decision request (host time base). */
function buildStorefrontConstraints(step: number): HardConstraint[] {
  return [
    { kind: "time-window", fromMs: (step - 1) * 60_000, untilMs: step * 60_000 + 60_000 },
    { kind: "max-cost", cost: 100, currency: "USD" },
    { kind: "catalog-rule", ruleId: "rule-stock-availability" },
    { kind: "policy-rights", gateId: "gate-payment-eligibility" },
    { kind: "custom", constraintId: "custom-cart-capacity", params: { maxItems: 3 } },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

const LEVEL3_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: STOREFRONT_PRODUCTS.map((product) => ({
    itemId: product.itemId,
    kind: "commerce" as const,
    labels: ["storefront", product.category, product.brand],
    attributes: { title: product.title, category: product.category, brand: product.brand },
    ...(product.availableFrom !== undefined ? { availableFrom: product.availableFrom } : {}),
    ...(product.availableUntil !== undefined ? { availableUntil: product.availableUntil } : {}),
  })),
  realizations: STOREFRONT_PRODUCTS.flatMap((product) =>
    product.variants.map((variant) => ({
      realizationId: variant.realizationId,
      itemId: product.itemId,
      kind: "sku",
      constraints: { priceUsd: variant.priceUsd, label: variant.label, channel: "web-storefront" },
    })),
  ),
};

const LEVEL3_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l3-storefront",
    name: "E-commerce Storefront",
    hostAdapterId: "adapter-l3-storefront-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
      notes: "products with availability windows (availableFrom/availableUntil)",
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
      notes: "size/capacity variants per product; price + stock as host-owned realization constraints",
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "in-stock variants only; category-affinity re-ranked every step; sold-out variants excluded",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "shop objective with cart budget params (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "five hard-constraint kinds per request: time-window, max-cost, catalog-rule, policy-rights, custom",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "attention policy declared on every decision request (in-request field)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "impression and conversion outcomes with order-value metrics",
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
      notes: "category affinity deltas (+ on conversion, decay on impression)",
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
  ],
};

export const level3StorefrontProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l3-storefront",
  name: "E-commerce storefront",
  description: "SIM-002 ladder level 3 — variants, price, availability, constraints, conversion.",
  ladderLevel: 3,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "constraint-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

export interface Level3Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level3WorldView;
}

export function createLevel3StorefrontHost(): Level3Host {
  const state = createLevel3WorldState();

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l3-storefront-1",
    hostSystem: {
      hostId: "host-l3-storefront",
      name: "E-commerce Storefront",
      version: "0.1.0",
    },
    glue: { functions: 14, loc: 432, customAdapterLoc: 174 },
    manifestContent: LEVEL3_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL3_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL3_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const device = step % 2 === 0 ? "mobile" : "desktop";
      const hostNowMs = step * 60_000;
      return {
        contextId: `ctx-l3-${step}-${device}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l3-shop",
          version: "1",
          kind: "shop",
          params: { cartBudgetUsd: 100 },
        },
        attentionPolicy: { policyId: "ap-l3-balanced", version: "1", style: "balanced", params: {} },
        candidates: {
          setId: `cs-l3-${step}`,
          candidates: rankProducts(state.categoryWeights, state.stockByRealization, state.seenItems, hostNowMs),
        },
        constraints: buildStorefrontConstraints(step),
        policySelector: { policyId: "greedy-v1" },
      };
    },

    consumeDecision(_step: number, result: DecisionResult): HostDecisionReaction {
      // The storefront renders the surfaced product; the session marks it
      // seen so retrieval never re-surfaces it; conversion behavior is
      // recorded in the outcome phase.
      const itemId = result.selectedExperience?.itemId ?? "";
      state.seenItems.add(itemId);
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      const itemId = result.selectedExperience?.itemId ?? "";
      const realizationId = result.selectedExperience?.realizationId ?? "";
      const product = STOREFRONT_PRODUCTS.find((entry) => entry.itemId === itemId);
      const category = product?.category ?? "apparel";
      const eventType = isConversionStep(step) ? "conversion" : "impression";
      const orderValueUsd = eventType === "conversion" ? variantPriceOf(realizationId) : 0;
      let stockRemaining = state.stockByRealization.get(realizationId) ?? 0;
      if (eventType === "conversion") {
        state.conversions += 1;
        stockRemaining = decrementStock(state, realizationId);
      } else {
        state.impressions += 1;
      }
      const oldWeight = state.categoryWeights.get(category) ?? 1.0;
      const newWeight = categoryWeightUpdate(state.categoryWeights, category, eventType);
      state.lastWeightTransition = { category, oldValue: oldWeight, newValue: newWeight };
      state.presentedLog.push({ step, itemId, realizationId, eventType, orderValueUsd });
      const metrics: Record<string, number> =
        eventType === "conversion"
          ? { orderValueUsd, stockRemaining, categoryWeight: newWeight }
          : { viewSeconds: 15 + step };
      return {
        eventId: `ev-l3-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        occurredAt: nowMs,
        context: { contextId: `ctx-l3-${step}-${step % 2 === 0 ? "mobile" : "desktop"}` },
        evidenceClass: "fixture",
        metrics,
        idempotencyKey: `idem-out-l3-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const itemId = result.selectedExperience?.itemId ?? "";
      const product = STOREFRONT_PRODUCTS.find((entry) => entry.itemId === itemId);
      const category = product?.category ?? "apparel";
      const eventType = isConversionStep(step) ? "conversion" : "impression";
      // The transition was applied exactly once in the outcome phase;
      // the delta declares it honestly (old → new) with the matching op.
      const transition = state.lastWeightTransition ?? { category, oldValue: 1.0, newValue: 1.0 };
      return {
        deltaId: `delta-l3-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension: `category.${transition.category}`,
        op: eventType === "conversion" ? "add" : "multiply",
        oldValue: transition.oldValue,
        newValue: transition.newValue,
        resultingConfidence: 0.6,
        model: { modelId: "host-l3-storefront-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return { host, world: state };
}

export const level3StorefrontMeta = {
  level: 3,
  name: "E-commerce storefront",
  hostAdapterId: "adapter-l3-storefront-1",
  requiredCapabilities: 11,
  expectedSatisfied: 11,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;
