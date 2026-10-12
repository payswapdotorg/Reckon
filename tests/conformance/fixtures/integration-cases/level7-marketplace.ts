/**
 * SIM-003 — LADDER LEVEL 7 INTEGRATION CASES: MARKETPLACE.
 * "seller/offer/item separation, competing objectives, uncertain inventory"
 *
 * The synthetic host: MarketBridge (tenant-marketbridge), a marketplace
 * product. The seller/offer/item separation maps onto the frozen contracts
 * exactly: products are catalog items (kind `commerce`), SELLER OFFERS are
 * realizations (kind `seller-offer` carrying seller/price/stock delivery
 * constraints), and a decision resolves a product+offer into an experience.
 * Competing objectives are declared as versioned multi-term REWARD specs
 * (buyer satisfaction vs marketplace revenue vs policy risk — constraints
 * stay separate from reward, lock #21). Uncertain inventory surfaces as
 * availability/stock on offers, budget ceilings as `max-cost` constraints,
 * and stock-out substitutions as abandonment + replan outcomes.
 *
 * Scenarios (through the PUBLIC standard loop only):
 * - offer-selection      — the item/offer/decision vertical, including a
 *   same-product OFFER SWAP (different realization ⇒ SWITCH);
 * - competing-objectives — the reward mix shifts across steps (buyer →
 *   marketplace → trust), retrieval order follows, one mindful SUGGEST;
 * - uncertain-inventory  — stock-out substitution, budget tightening and a
 *   restock replan (max-cost constraints, abandonment + replan outcomes);
 * - deal-interruption-resume — a time-critical flash deal INTERRUPTs
 *   browsing (checkpoint), is purchased, and browsing RESUMEs.
 */
import type {
  ScenarioHostInstance,
  ScenarioScript,
  IntegrationCaseScenario,
  CatalogItemInput,
  RealizationInput,
  RewardSpecInput,
} from "../../../../packages/simulation/src/index.js";
import {
  createScenarioHost,
  standardLoopManifestContent,
  standardLoopProfile,
  capabilityProbeProfile,
} from "../../../../packages/simulation/src/index.js";

const TENANT = { tenantId: "tenant-marketbridge" };
const SUBJECT = { kind: "user", ref: "user-shopper-21" } as const;

const OBJECTIVE_SHOP = {
  objectiveId: "obj-marketbridge-shop",
  version: "1",
  kind: "shop",
  params: { mission: "home-office-upgrade" },
} as const;

const AP_BALANCED = { policyId: "ap-marketbridge-balanced", version: "1", style: "balanced", params: {} } as const;
const AP_MINDFUL = { policyId: "ap-marketbridge-mindful", version: "1", style: "mindful", params: {} } as const;

/** Competing-objective reward specs (host-declared, versioned, multi-term). */
const REWARD_BUYER: RewardSpecInput = {
  rewardId: "marketbridge-buyer-value-v1",
  version: "1",
  terms: [
    { termId: "buyer-satisfaction", version: "1", kind: "satisfaction-proxy", weight: 0.6 },
    { termId: "purchase-conversion", version: "1", kind: "conversion", weight: 0.3 },
    { termId: "marketplace-revenue", version: "1", kind: "revenue", weight: 0.1 },
    { termId: "policy-risk-penalty", version: "1", kind: "policy-risk", weight: -0.05 },
  ],
};

const REWARD_MARKETPLACE: RewardSpecInput = {
  rewardId: "marketplace-mixed-v1",
  version: "1",
  terms: [
    { termId: "buyer-satisfaction", version: "1", kind: "satisfaction-proxy", weight: 0.2 },
    { termId: "purchase-conversion", version: "1", kind: "conversion", weight: 0.3 },
    { termId: "marketplace-revenue", version: "1", kind: "revenue", weight: 0.5 },
    { termId: "policy-risk-penalty", version: "1", kind: "policy-risk", weight: -0.05 },
  ],
};

const REWARD_TRUST: RewardSpecInput = {
  rewardId: "marketbridge-trust-v1",
  version: "1",
  terms: [
    { termId: "buyer-satisfaction", version: "1", kind: "satisfaction-proxy", weight: 0.4 },
    { termId: "purchase-conversion", version: "1", kind: "conversion", weight: 0.2 },
    { termId: "marketplace-revenue", version: "1", kind: "revenue", weight: 0.1 },
    { termId: "policy-risk-penalty", version: "1", kind: "policy-risk", weight: -0.3 },
  ],
};

// ---------------------------------------------------------------------------
// Domain catalog (host-owned marketplace authority: items = products,
// realizations = SELLER OFFERS with price/stock delivery constraints)
// ---------------------------------------------------------------------------

const CATALOG_ITEMS: CatalogItemInput[] = [
  { itemId: "item-mkt-headphones", kind: "commerce", labels: ["electronics", "audio"], attributes: { title: "Aurora Wireless Headphones", brand: "Aurora" } },
  { itemId: "item-mkt-standingdesk", kind: "commerce", labels: ["furniture", "office"], attributes: { title: "Rise Standing Desk", brand: "Rise" } },
  { itemId: "item-mkt-lamp", kind: "commerce", labels: ["home", "lighting"], attributes: { title: "Halo Desk Lamp", brand: "Halo" } },
  { itemId: "item-mkt-keyboard", kind: "commerce", labels: ["electronics", "peripherals"], attributes: { title: "Tactile 68 Keyboard", brand: "Tactile" } },
];

const CATALOG_REALIZATIONS: RealizationInput[] = [
  { realizationId: "real-offer-a1", itemId: "item-mkt-headphones", kind: "seller-offer", constraints: { sellerId: "seller-a", priceCents: 18900, currency: "USD", shippingDays: 2, stock: "in-stock" } },
  { realizationId: "real-offer-a2", itemId: "item-mkt-headphones", kind: "seller-offer", constraints: { sellerId: "seller-b", priceCents: 17900, currency: "USD", shippingDays: 4, stock: "low-stock" } },
  { realizationId: "real-offer-d1", itemId: "item-mkt-standingdesk", kind: "seller-offer", constraints: { sellerId: "seller-a", priceCents: 44900, currency: "USD", shippingDays: 7, stock: "in-stock" } },
  { realizationId: "real-offer-l1", itemId: "item-mkt-lamp", kind: "seller-offer", constraints: { sellerId: "seller-c", priceCents: 5400, currency: "USD", shippingDays: 3, stock: "low-stock" } },
  { realizationId: "real-offer-l2", itemId: "item-mkt-lamp", kind: "seller-offer", constraints: { sellerId: "seller-c", priceCents: 4900, currency: "USD", shippingDays: 3, stock: "in-stock" } },
  { realizationId: "real-offer-k1", itemId: "item-mkt-keyboard", kind: "seller-offer", constraints: { sellerId: "seller-b", priceCents: 8900, currency: "USD", shippingDays: 2, stock: "in-stock" } },
  { realizationId: "real-offer-k1f", itemId: "item-mkt-keyboard", kind: "seller-offer", constraints: { sellerId: "seller-b", priceCents: 6900, currency: "USD", shippingDays: 2, stock: "in-stock", flashDeal: true } },
];

const HOST_CATALOG = {
  items: CATALOG_ITEMS.map((item) => ({ ...item })),
  realizations: CATALOG_REALIZATIONS.map((realization) => ({ ...realization })),
};

const HOST_SYSTEM = { hostId: "host-marketbridge", name: "MarketBridge", version: "0.1.0" } as const;

const beyondSurface = [
  {
    capability: "decision-retrieval" as const,
    friction: "COMPOSITION_GAP" as const,
    notes:
      "the SDK/API exposes GET /v1/decisions/{id} with expand (decision-retrieval) for marketplace audit and offer-provenance lookup, but the SIM-001 harness port composes only the six standard-loop operations — audit/lookup flows are not reachable through the composed harness path",
  },
];

// ===== scenario: offer-selection ============================================
const offerSelectionScript: ScenarioScript = {
  hostAdapterId: "adapter-l7-mkt-offer-selection",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 111, customAdapterLoc: 108 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l7-mkt-offer-selection" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l7-offers-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-offers-1",
        candidates: [
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1"], source: "host-recommendation", rankHint: 2, scoreHint: 0.6 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      present: true,
      outcome: { eventType: "impression", metrics: { offerPriceCents: 18900 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-offers-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-offers-2",
        candidates: [
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.92 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { offerPriceCents: 17900, savedCents: 1000, offerSwapped: 1 } },
      preferenceDelta: { dimension: "shop.seller.seller-b", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-offers-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-offers-3",
        candidates: [
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.92 },
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 2, scoreHint: 0.7 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 17900, shippingDays: 4 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-offers-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-offers-4",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.75 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { offerPriceCents: 44900 } },
    },
    {
      contextId: "ctx-l7-offers-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-offers-5",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.75 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 44900, shippingDays: 7 } },
      preferenceDelta: { dimension: "shop.category.furniture", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel7OfferSelectionHost(): ScenarioHostInstance {
  return createScenarioHost(offerSelectionScript);
}
// ===== end scenario: offer-selection ========================================

// ===== scenario: competing-objectives =======================================
const competingObjectivesScript: ScenarioScript = {
  hostAdapterId: "adapter-l7-mkt-competing-objectives",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 110, customAdapterLoc: 107 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l7-mkt-competing-objectives" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l7-objectives-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-objectives-1",
        candidates: [
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1"], source: "host-recommendation", rankHint: 2, scoreHint: 0.6 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      present: true,
      outcome: { eventType: "impression", metrics: { dominantTerm: 1, offerPriceCents: 17900 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-objectives-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-objectives-2",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.8 },
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a2"], source: "host-recommendation", rankHint: 2, scoreHint: 0.9 },
        ],
      },
      reward: REWARD_MARKETPLACE,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "impression", metrics: { dominantTerm: 3, offerPriceCents: 44900 } },
    },
    {
      contextId: "ctx-l7-objectives-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_MINDFUL,
      candidates: {
        setId: "cs-l7-objectives-3",
        candidates: [
          { itemId: "item-mkt-lamp", realizationIds: ["real-offer-l1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.65 },
        ],
      },
      reward: REWARD_TRUST,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "impression", metrics: { dominantTerm: 4, suggestion: 1, offerPriceCents: 5400 } },
    },
    {
      contextId: "ctx-l7-objectives-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-objectives-4",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.8 },
        ],
      },
      reward: REWARD_TRUST,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "purchase", metrics: { dominantTerm: 4, offerPriceCents: 44900, shippingDays: 7 } },
      preferenceDelta: { dimension: "shop.category.furniture", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-objectives-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-objectives-5",
        candidates: [
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      reward: REWARD_BUYER,
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "purchase", metrics: { dominantTerm: 1, offerPriceCents: 8900, shippingDays: 2 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.62, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel7CompetingObjectivesHost(): ScenarioHostInstance {
  return createScenarioHost(competingObjectivesScript);
}
// ===== end scenario: competing-objectives ===================================

// ===== scenario: uncertain-inventory ========================================
const uncertainInventoryScript: ScenarioScript = {
  hostAdapterId: "adapter-l7-mkt-uncertain-inventory",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 123, customAdapterLoc: 120 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l7-mkt-uncertain-inventory" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l7-inventory-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-1",
        candidates: [
          { itemId: "item-mkt-lamp", realizationIds: ["real-offer-l1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.65 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      present: true,
      outcome: { eventType: "impression", metrics: { stockLevel: 2, offerPriceCents: 5400 } },
      preferenceDelta: { dimension: "shop.category.home", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-inventory-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-2",
        candidates: [
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "abandonment", metrics: { reason: 1, substituted: 1, offerPriceCents: 8900 } },
    },
    {
      contextId: "ctx-l7-inventory-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-3",
        candidates: [
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.7 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 8900, shippingDays: 2 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-inventory-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-4",
        candidates: [
          { itemId: "item-mkt-headphones", realizationIds: ["real-offer-a2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.9 },
        ],
      },
      constraints: [{ kind: "max-cost", cost: 20000, currency: "USD" }],
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "impression", metrics: { budgetCents: 20000, offerPriceCents: 17900 } },
    },
    {
      contextId: "ctx-l7-inventory-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-5",
        candidates: [
          { itemId: "item-mkt-lamp", realizationIds: ["real-offer-l2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.68 },
        ],
      },
      constraints: [{ kind: "max-cost", cost: 15000, currency: "USD" }],
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "custom", customEventType: "inventory-replan", metrics: { budgetCents: 15000, offerPriceCents: 4900, restocked: 1 } },
      preferenceDelta: { dimension: "shop.category.home", op: "add", newValue: 1, resultingConfidence: 0.55, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-inventory-6",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-inventory-6",
        candidates: [
          { itemId: "item-mkt-lamp", realizationIds: ["real-offer-l2"], source: "host-recommendation", rankHint: 1, scoreHint: 0.68 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 5 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 4900, shippingDays: 3 } },
      preferenceDelta: { dimension: "shop.category.home", op: "add", newValue: 1, resultingConfidence: 0.6, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel7UncertainInventoryHost(): ScenarioHostInstance {
  return createScenarioHost(uncertainInventoryScript);
}
// ===== end scenario: uncertain-inventory ====================================

// ===== scenario: deal-interruption-resume ===================================
const dealInterruptionResumeScript: ScenarioScript = {
  hostAdapterId: "adapter-l7-mkt-deal-interruption-resume",
  hostSystem: HOST_SYSTEM,
  glue: { functions: 7, loc: 103, customAdapterLoc: 100 },
  manifestContent: standardLoopManifestContent({
    hostSystem: { ...HOST_SYSTEM, hostAdapterId: "adapter-l7-mkt-deal-interruption-resume" },
    declaredAt: 1_100,
    beyondSurface,
  }),
  catalog: HOST_CATALOG,
  steps: [
    {
      contextId: "ctx-l7-deal-1",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-deal-1",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.75 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      present: true,
      outcome: { eventType: "impression", metrics: { offerPriceCents: 44900 } },
      preferenceDelta: { dimension: "shop.category.furniture", op: "add", newValue: 1, resultingConfidence: 0.5, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-deal-2",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-deal-2",
        candidates: [
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1f"], source: "host-time-critical", rankHint: 1, scoreHint: 0.95 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 1 },
      present: true,
      outcome: { eventType: "interruption-accept", metrics: { dealPriceCents: 6900, checkpointSaved: 1 } },
    },
    {
      contextId: "ctx-l7-deal-3",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-deal-3",
        candidates: [
          { itemId: "item-mkt-keyboard", realizationIds: ["real-offer-k1f"], source: "host-recommendation", rankHint: 1, scoreHint: 0.95 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 2 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 6900, shippingDays: 2, flashDeal: 1 } },
      preferenceDelta: { dimension: "shop.category.electronics", op: "add", newValue: 1, resultingConfidence: 0.62, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
    {
      contextId: "ctx-l7-deal-4",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-deal-4",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-resume", rankHint: 1, scoreHint: 0.75 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 3 },
      present: true,
      outcome: { eventType: "resume", metrics: { resumedItem: 1 } },
    },
    {
      contextId: "ctx-l7-deal-5",
      tenant: TENANT,
      subject: SUBJECT,
      objective: OBJECTIVE_SHOP,
      attentionPolicy: AP_BALANCED,
      candidates: {
        setId: "cs-l7-deal-5",
        candidates: [
          { itemId: "item-mkt-standingdesk", realizationIds: ["real-offer-d1"], source: "host-recommendation", rankHint: 1, scoreHint: 0.75 },
        ],
      },
      policySelector: { policyId: "marketbridge-shopping-v1" },
      currentExperience: { kind: "selected-from-step", step: 4 },
      present: true,
      outcome: { eventType: "purchase", metrics: { offerPriceCents: 44900, shippingDays: 7 } },
      preferenceDelta: { dimension: "shop.category.furniture", op: "add", newValue: 1, resultingConfidence: 0.58, modelId: "marketbridge-affinity-v1", modelVersion: "1" },
    },
  ],
};

export function createLevel7DealInterruptionResumeHost(): ScenarioHostInstance {
  return createScenarioHost(dealInterruptionResumeScript);
}
// ===== end scenario: deal-interruption-resume ===============================

// ---------------------------------------------------------------------------
// Profiles + the Level 7 scenario suite
// ---------------------------------------------------------------------------

export const level7Profile = standardLoopProfile({
  profileId: "profile-level-7-marketplace",
  name: "Marketplace",
  description: "Ladder level 7 — seller/offer/item separation, competing objectives, uncertain inventory.",
  ladderLevel: 7,
  declaredAt: 1_000,
});

export const level7ProbeProfile = capabilityProbeProfile({
  baseline: level7Profile,
  probeCapability: "decision-retrieval",
});

export const level7Scenarios: readonly IntegrationCaseScenario[] = [
  {
    level: 7,
    scenarioId: "offer-selection",
    description: "the item/offer/decision vertical with seller-offer realizations, a same-product OFFER SWAP and purchases under a buyer-value reward",
    archetypes: ["switching"],
    createHost: createLevel7OfferSelectionHost,
    profile: level7Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 7,
    scenarioId: "competing-objectives",
    description: "the declared reward mix shifts buyer → marketplace → trust across steps; retrieval order follows; a mindful SUGGEST appears in trust mode",
    archetypes: ["switching"],
    createHost: createLevel7CompetingObjectivesHost,
    profile: level7Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 7,
    scenarioId: "uncertain-inventory",
    description: "stock-out substitution (abandonment), budget ceilings (max-cost constraints), restock replan and purchase",
    archetypes: ["replan", "switching"],
    createHost: createLevel7UncertainInventoryHost,
    profile: level7Profile,
    steps: 6,
    expectReckonComplete: true,
  },
  {
    level: 7,
    scenarioId: "deal-interruption-resume",
    description: "a time-critical flash deal INTERRUPTs browsing (checkpoint kept), is purchased, and browsing RESUMEs to purchase",
    archetypes: ["interruption", "resume"],
    createHost: createLevel7DealInterruptionResumeHost,
    profile: level7Profile,
    steps: 5,
    expectReckonComplete: true,
  },
  {
    level: 7,
    scenarioId: "probe-decision-retrieval",
    description: "capability probe: the marketplace wants decision audit/lookup; the harness port composes only the standard loop — honestly incomplete (COMPOSITION_GAP)",
    archetypes: ["switching"],
    createHost: createLevel7OfferSelectionHost,
    profile: level7ProbeProfile,
    steps: 5,
    expectReckonComplete: false,
  },
  {
    level: 7,
    scenarioId: "resilience",
    description: "the uncertain-inventory scenario under a seeded transport-fault storm (faultRate 0.2, 3 retries) — failure/retry behavior measured honestly",
    archetypes: ["replan", "switching"],
    createHost: createLevel7UncertainInventoryHost,
    profile: level7Profile,
    steps: 6,
    faultRate: 0.2,
    maxRetries: 3,
    expectReckonComplete: true,
  },
];
