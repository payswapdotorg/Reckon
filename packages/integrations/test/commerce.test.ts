/**
 * W3-007 — commerce reference adapter proof.
 *
 * Proves, from REAL commands run in this suite:
 * - the commerce-shaped catalog maps into schema-valid frozen contracts
 *   (CatalogItem kind "commerce"/Realization with product names,
 *   categories, sale windows, prices and commerce policy tags
 *   preserved as pass-through);
 * - host present/stage/swap/suspend/abandon actions map into scheduler
 *   action inputs (host-authoritative plan-state transitions and the
 *   caller-supplied switch evaluation);
 * - commerce system purchase reports map into `OutcomeEvent`s carrying
 *   an OBSERVED evidence class (non-observed classes are typed errors);
 * - the FULL COMMERCE VERTICAL — product → offer/realization →
 *   experience → decision → schedule → outcome → preference delta —
 *   runs end-to-end through the real W2 kernels (normalize → expand →
 *   policy → scheduler) for a commerce fixture, with honest absence
 *   for unknown products, constraint defense-in-depth, resume
 *   checkpoints on SWITCH, and byte-identical determinism across
 *   repeated runs;
 * - every record at every stage validates against the frozen schemas.
 *
 * Fixture evidence only — nothing here proves a live commerce
 * integration (COMMERCE_ADAPTER_DECLARATION.liveVerification).
 */
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  CatalogItemSchema,
  CandidateSetSchema,
  ContextSnapshotSchema,
  AttentionPolicySchema,
  DecisionRequestSchema,
  DecisionResultSchema,
  ExperienceSchema,
  ObjectiveSchema,
  OutcomeEventSchema,
  PreferenceDeltaSchema,
  RealizationSchema,
  type CatalogItem,
  type HardConstraint,
  type OutcomeEvent,
} from "@reckon/contracts";
import {
  createCommerceAdapter,
  COMMERCE_ADAPTER_DECLARATION,
  type CommerceCatalogImport,
  type CommerceHostAction,
  type CommercePurchaseReport,
  type ObservedEvidenceClass,
  type ShoppingPurpose,
} from "../src/index.js";
import { expectValid } from "./helpers.js";
import { idleState, runVertical, unwrapVertical } from "./vertical.js";

// ---------------------------------------------------------------------------
// Fixture (caller-supplied timestamps only — deterministic)
// ---------------------------------------------------------------------------

const T0 = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z (fixture epoch)
const T1 = T0 + 3_600_000; // session/decision 1
const T2 = T0 + 3_660_000; // decision 2 (swap)
const T3 = T0 + 7_200_000; // purchase outcomes

const adapter = createCommerceAdapter();

const catalogImport: CommerceCatalogImport = {
  merchant: "merchants-guild-export",
  exportedAt: T0,
  products: [
    {
      productId: "co-p-aurora-beans",
      name: "Aurora Single-Origin Coffee Beans",
      productKind: "physical",
      categories: ["coffee", "grocery", "pantry"],
      saleStartsAt: T0,
      saleEndsAt: T0 + 2_592_000_000,
      commercePolicyTags: ["standard-listing"],
      offers: [
        {
          offerId: "co-off-beans-checkout",
          surface: "checkout",
          locale: "en",
          currency: "USD",
          priceAmount: 18.5,
          fulfillment: "shipping",
          inStock: true,
          presentSeconds: 90,
          presentations: ["card"],
        },
        {
          offerId: "co-off-beans-page",
          surface: "product-page",
          currency: "USD",
          priceAmount: 18.5,
          fulfillment: "shipping",
          inStock: true,
          presentSeconds: 120,
        },
      ],
    },
    {
      productId: "co-p-trailhead-socks",
      name: "Trailhead Running Socks",
      productKind: "physical",
      categories: ["running", "apparel"],
      commercePolicyTags: ["standard-listing"],
      offers: [
        {
          offerId: "co-off-socks-page",
          surface: "product-page",
          currency: "USD",
          priceAmount: 14,
          fulfillment: "shipping",
          inStock: true,
          presentSeconds: 75,
        },
      ],
    },
    {
      productId: "co-p-focus-flow",
      name: "Focus Flow Annual",
      productKind: "subscription",
      categories: ["productivity", "software"],
      commercePolicyTags: ["premium-listing"],
      offers: [
        {
          offerId: "co-off-focus-app",
          surface: "shop-app",
          currency: "USD",
          priceAmount: 96,
          fulfillment: "digital-delivery",
          inStock: true,
          backorderEligible: false,
          presentSeconds: 210,
        },
      ],
    },
  ],
};

const shoppingSession = {
  shopperId: "co-shopper-11",
  sessionId: "co-ctx-restock-1",
  at: T1,
  device: "desktop" as const,
  networkKind: "wifi" as const,
  localTime: "19:40",
  timezone: "Africa/Accra",
  minutesAvailable: 20,
  recentPrompts: 1,
  midVisit: true,
};

const tenant = { tenantId: "co-tenant" };
const subject = { kind: "user" as const, ref: "co-shopper-11" };

function standardSlate() {
  return adapter.toCandidateSet({
    slateId: "co-slate-restock-1",
    merchant: "merchandiser-v2",
    rows: [
      { productId: "co-p-aurora-beans", rank: 1 },
      { productId: "co-p-trailhead-socks", rank: 2 },
      { productId: "co-p-focus-flow", rank: 3 },
      { productId: "co-p-ghost", rank: 4 }, // unknown product — honest absence
    ],
  });
}

// ---------------------------------------------------------------------------
// Declaration + catalog mapping
// ---------------------------------------------------------------------------

describe("W3-007 commerce adapter declaration", () => {
  it("declares fixture-only live verification and host-authoritative boundaries", () => {
    expect(COMMERCE_ADAPTER_DECLARATION.adapterId).toBe("commerce-reference-adapter");
    expect(COMMERCE_ADAPTER_DECLARATION.domain).toBe("commerce");
    expect(COMMERCE_ADAPTER_DECLARATION.liveVerification).toEqual({
      status: "fixture-only",
      evidenceClass: "fixture",
      note: expect.any(String) as unknown as string,
    });
    // Host stays authoritative for the commerce gates (worker-3.md).
    for (const capability of [
      "identity",
      "consent-management",
      "rights-verification",
      "catalog-authoring",
      "provider-access",
      "offer-delivery",
      "pricing",
      "payment",
      "live-provider-calls",
    ]) {
      expect(COMMERCE_ADAPTER_DECLARATION.unsupportedCapabilities).toContain(capability);
    }
    for (const requirement of COMMERCE_ADAPTER_DECLARATION.authorizationRequirements) {
      expect(["host", "reckon-api"]).toContain(requirement.enforcedBy);
    }
    expect(COMMERCE_ADAPTER_DECLARATION.provenance.dataOwnership).toBe("host");
    expect(adapter.declaration).toBe(COMMERCE_ADAPTER_DECLARATION);
  });
});

describe("W3-007 commerce catalog import", () => {
  it("maps products and offers into schema-valid CatalogItem/Realization records (kind commerce)", () => {
    const result = adapter.importCatalog(catalogImport);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.items).toHaveLength(3);
    expect(result.value.realizations).toHaveLength(4);

    for (const item of result.value.items) {
      const parsed = expectValid(CatalogItemSchema, item);
      expect(parsed.kind).toBe("commerce");
    }
    const beans = result.value.items[0] as CatalogItem;
    expect(beans.itemId).toBe("co-p-aurora-beans");
    expect(beans.labels).toEqual(["coffee", "grocery", "pantry", "physical"]);
    expect(beans.attributes).toMatchObject({
      name: "Aurora Single-Origin Coffee Beans",
      productKind: "physical",
      commercePolicyTags: ["standard-listing"],
    });
    expect(beans.availableFrom).toBe(T0);
    expect(beans.availableUntil).toBe(T0 + 2_592_000_000);

    for (const realization of result.value.realizations) {
      expectValid(RealizationSchema, realization);
    }
    const checkoutOffer = result.value.realizations.find((r) => r.realizationId === "co-off-beans-checkout");
    expect(checkoutOffer).toBeDefined();
    expect(checkoutOffer?.itemId).toBe("co-p-aurora-beans");
    expect(checkoutOffer?.kind).toBe("checkout");
    expect(checkoutOffer?.locale).toBe("en");
    // Cart/checkout-shaped realization surface with pass-through price
    // truth (the adapter never computes prices).
    expect(checkoutOffer?.constraints).toMatchObject({
      formats: ["card", "full"],
      durationSeconds: 90,
      deviceClasses: ["desktop", "phone"],
      requiresScreen: true,
      requiresAudio: false,
      minBandwidth: "low",
      currency: "USD",
      priceAmount: 18.5,
      fulfillment: "shipping",
      inStock: true,
    });
  });

  it("rejects duplicate product ids and duplicate offer ids (all-or-nothing)", () => {
    const duplicateProduct = adapter.importCatalog({
      merchant: "merchants-guild-export",
      exportedAt: T0,
      products: [
        catalogImport.products[0],
        { ...catalogImport.products[1], productId: "co-p-aurora-beans" },
      ],
    });
    expect(duplicateProduct.ok).toBe(false);
    if (duplicateProduct.ok) throw new Error("expected failure");
    expect(duplicateProduct.error.code).toBe("INVALID_INPUT");
    expect(duplicateProduct.error.message).toContain("duplicate productId");

    const duplicateOffer = adapter.importCatalog({
      merchant: "merchants-guild-export",
      exportedAt: T0,
      products: [
        catalogImport.products[0],
        { ...catalogImport.products[1], offers: [catalogImport.products[0].offers[0]] },
      ],
    });
    expect(duplicateOffer.ok).toBe(false);
    if (duplicateOffer.ok) throw new Error("expected failure");
    expect(duplicateOffer.error.code).toBe("INVALID_INPUT");
    expect(duplicateOffer.error.message).toContain("duplicate offerId");
  });

  it("returns typed issues for malformed host shapes (fail-closed)", () => {
    const malformed = adapter.importCatalog({
      merchant: "merchants-guild-export",
      exportedAt: T0,
      products: [
        {
          productId: "bad",
          name: "",
          productKind: "physical",
          categories: [],
          commercePolicyTags: ["x"],
          offers: [],
        },
      ],
    } as unknown as CommerceCatalogImport);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("expected failure");
    expect(malformed.error.code).toBe("INVALID_INPUT");
    expect(malformed.error.issues).toBeDefined();
    expect(malformed.error.issues?.length).toBeGreaterThan(0);

    // Sale window contradiction is rejected.
    const inverted = adapter.importCatalog({
      merchant: "merchants-guild-export",
      exportedAt: T0,
      products: [
        {
          productId: "co-p-x",
          name: "X",
          productKind: "physical",
          categories: ["c"],
          saleStartsAt: T0 + 1000,
          saleEndsAt: T0,
          commercePolicyTags: [],
          offers: [
            { offerId: "co-off-x", surface: "cart", currency: "USD", priceAmount: 1, fulfillment: "pickup", inStock: true },
          ],
        },
      ],
    });
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected failure");
    expect(inverted.error.issues?.some((i) => i.path === "products[0].saleEndsAt")).toBe(true);
  });

  it("enforces the declared import limits with typed LIMIT_EXCEEDED errors", () => {
    const limit = COMMERCE_ADAPTER_DECLARATION.limits.maxItemsPerImport;
    const products = Array.from({ length: limit + 1 }, (_, index) => ({
      productId: `co-p-bulk-${index}`,
      name: `Bulk ${index}`,
      productKind: "physical" as const,
      categories: ["bulk"],
      commercePolicyTags: [],
      offers: [
        { offerId: `co-off-bulk-${index}`, surface: "cart" as const, currency: "USD", priceAmount: 1, fulfillment: "shipping" as const, inStock: true },
      ],
    }));
    const result = adapter.importCatalog({ merchant: "merchants-guild-export", exportedAt: T0, products });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("LIMIT_EXCEEDED");
    expect(result.error.message).toContain(`${limit + 1}`);
  });
});

// ---------------------------------------------------------------------------
// Retrieval / context / objective / attention mappings
// ---------------------------------------------------------------------------

describe("W3-007 commerce retrieval/context/objective/attention mappings", () => {
  it("maps merchandising slate rows into a schema-valid CandidateSet with rank hints and provenance", () => {
    const result = standardSlate();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(CandidateSetSchema, result.value);
    expect(parsed.setId).toBe("co-slate-restock-1");
    expect(parsed.candidates).toHaveLength(4);
    expect(parsed.candidates[0]).toMatchObject({
      itemId: "co-p-aurora-beans",
      realizationIds: [],
      source: "merchandiser-v2",
      rankHint: 1,
    });
    expect(parsed.provenance).toEqual({ system: "merchandiser-v2", correlationId: "co-slate-restock-1" });
  });

  it("maps a shopping session into a schema-valid ContextSnapshot (device, day-part, attention, fatigue)", () => {
    const result = adapter.toContextSnapshot(shoppingSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(ContextSnapshotSchema, result.value);
    expect(parsed.contextId).toBe("co-ctx-restock-1");
    expect(parsed.device).toEqual({ class: "desktop" });
    expect(parsed.network).toEqual({ class: "wifi" });
    expect(parsed.time).toEqual({ localTime: "19:40", timezone: "Africa/Accra", dayPart: "evening" });
    expect(parsed.attention).toEqual({ availableMs: 1_200_000 });
    expect(parsed.fatigue).toEqual({ recentInterruptions: 1 });
    expect(parsed.activity).toEqual(["mid-visit"]);
  });

  it("rejects malformed local times and empty slates with typed errors", () => {
    const badTime = adapter.toContextSnapshot({ ...shoppingSession, localTime: "25:99" });
    expect(badTime.ok).toBe(false);
    if (badTime.ok) throw new Error("expected failure");
    expect(badTime.error.issues?.some((i) => i.path === "localTime")).toBe(true);

    const emptySlate = adapter.toCandidateSet({ slateId: "co-slate-empty", merchant: "m", rows: [] });
    expect(emptySlate.ok).toBe(false);
    if (emptySlate.ok) throw new Error("expected failure");
    expect(emptySlate.error.issues?.some((i) => i.path === "rows")).toBe(true);
  });

  it("maps shopping purposes and modes into schema-valid Objectives and AttentionPolicies", () => {
    const cases: [ShoppingPurpose["purpose"], string][] = [
      ["replenish", "shop"],
      ["browse", "discover"],
      ["gift-hunt", "find-gift"],
      ["decide", "compare"],
      ["finish-order", "complete-task"],
    ];
    for (const [purpose, kind] of cases) {
      const result = adapter.toObjective({ purpose, interestCategories: ["coffee"] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const parsed = expectValid(ObjectiveSchema, result.value);
      expect(parsed.kind).toBe(kind);
      expect(parsed.objectiveId).toBe(`co-goal-${purpose}`);
      expect(parsed.params).toEqual({ interestCategories: ["coffee"] });
    }
    for (const [mode, style] of [
      ["focused", "mindful"],
      ["casual", "balanced"],
      ["deal-sprint", "immersive"],
    ] as const) {
      const result = adapter.toAttentionPolicy(mode);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const parsed = expectValid(AttentionPolicySchema, result.value);
      expect(parsed.style).toBe(style);
      expect(parsed.policyId).toBe(`co-attention-${mode}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Host actions → scheduler action inputs
// ---------------------------------------------------------------------------

describe("W3-007 commerce host actions → scheduler action inputs", () => {
  it("maps present to a host-authoritative plan-state transition (queue entry consumed)", () => {
    const queued = idleState();
    queued.status = "queued";
    queued.queue = ["co-exp-1", "co-exp-2"];
    const result = adapter.toSchedulerIntents({ kind: "present", experienceId: "co-exp-2" }, queued);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "co-exp-2",
      queue: ["co-exp-1"],
      resumeCheckpoints: [],
    });
  });

  it("maps stage without interrupting an active experience, and never duplicates entries", () => {
    const playing = {
      status: "playing" as const,
      currentExperienceId: "co-exp-1",
      queue: [],
      resumeCheckpoints: [],
    };
    const result = adapter.toSchedulerIntents({ kind: "stage", experienceIds: ["co-exp-2", "co-exp-2", "co-exp-3"] }, playing);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "co-exp-1",
      queue: ["co-exp-2", "co-exp-3"],
      resumeCheckpoints: [],
    });
  });

  it("maps stage from idle to the queued status", () => {
    const result = adapter.toSchedulerIntents({ kind: "stage", experienceIds: ["co-exp-9"] }, idleState());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState?.status).toBe("queued");
  });

  it("maps swap numbers to the caller-supplied SwitchEvaluationInput (SEPARATION LAW passthrough)", () => {
    const result = adapter.toSchedulerIntents(
      {
        kind: "swap",
        numbers: {
          fromExperienceId: "co-exp-1",
          toExperienceId: "co-exp-2",
          expectedImprovement: 0.42,
          interruptionCost: 0.02,
          uncertaintyPenalty: 0.03,
          resumeLoss: 0.01,
          switchThreshold: 0.3,
          suggestThreshold: 0.1,
        },
      },
      { status: "playing", currentExperienceId: "co-exp-1", queue: [], resumeCheckpoints: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.switch).toEqual({
      currentExperienceId: "co-exp-1",
      candidateExperienceId: "co-exp-2",
      expectedImprovement: 0.42,
      interruptionCost: 0.02,
      uncertaintyPenalty: 0.03,
      resumeLoss: 0.01,
      switchThreshold: 0.3,
      suggestThreshold: 0.1,
    });
  });

  it("maps suspend (with host resume token) and abandon actions to scheduler flags", () => {
    const suspend = adapter.toSchedulerIntents(
      { kind: "suspend", experienceId: "co-exp-1", resumeToken: "co-cart-hold-1" },
      { status: "playing", currentExperienceId: "co-exp-1", queue: [], resumeCheckpoints: [] },
    );
    expect(suspend.ok).toBe(true);
    if (!suspend.ok) throw new Error(suspend.error.message);
    expect(suspend.value.interruptRequested).toBe(true);
    expect(suspend.value.resumeTokens).toEqual({ "co-exp-1": "co-cart-hold-1" });

    const abandon = adapter.toSchedulerIntents({ kind: "abandon" }, idleState());
    expect(abandon.ok).toBe(true);
    if (!abandon.ok) throw new Error(abandon.error.message);
    expect(abandon.value.endRequested).toBe(true);
  });

  it("rejects host actions against a terminal plan and malformed action shapes", () => {
    const ended = { status: "ended" as const, queue: [], resumeCheckpoints: [] };
    const present = adapter.toSchedulerIntents({ kind: "present", experienceId: "co-exp-1" }, ended);
    expect(present.ok).toBe(false);
    if (present.ok) throw new Error("expected failure");
    expect(present.error.code).toBe("INVALID_INPUT");
    expect(present.error.message).toContain("ended");

    const malformed = adapter.toSchedulerIntents({ kind: "swap", numbers: { fromExperienceId: "" } } as unknown as CommerceHostAction, idleState());
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("expected failure");
    expect(malformed.error.issues?.length).toBeGreaterThan(0);

    const unknown = adapter.toSchedulerIntents({ kind: "purchase-now" } as unknown as CommerceHostAction, idleState());
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("expected failure");
    expect(unknown.error.message).toContain("present, stage, swap, suspend or abandon");
  });
});

// ---------------------------------------------------------------------------
// Purchase outcomes
// ---------------------------------------------------------------------------

describe("W3-007 commerce purchase outcomes", () => {
  const baseReport: CommercePurchaseReport = {
    purchaseId: "co-purchase-77",
    at: T3,
    productId: "co-p-aurora-beans",
    event: "purchased",
    cartValue: 32.5,
    orderValue: 18.5,
    quantity: 1,
  };

  it("maps purchase reports to schema-valid OutcomeEvents with observed evidence classes", () => {
    const result = adapter.toOutcomeEvent(baseReport, {
      tenant,
      subject,
      evidenceClass: "controlled-local",
      contextId: "co-ctx-restock-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(OutcomeEventSchema, result.value);
    expect(parsed.eventType).toBe("purchase");
    expect(parsed.evidenceClass).toBe("controlled-local");
    expect(parsed.subject).toEqual(subject);
    expect(parsed.context).toEqual({ contextId: "co-ctx-restock-1" });
    expect(parsed.metrics).toMatchObject({ cartValue: 32.5, orderValue: 18.5, quantity: 1, orderShareOfCart: 0.5692 });
    expect(parsed.provenance).toEqual({ system: "commerce-reporting", version: "1" });
  });

  it("rejects non-observed evidence classes on the observation channel (typed error)", () => {
    for (const researchClass of ["fixture", "simulated", "counterfactual"] as const) {
      // Bypass the narrowed input type deliberately: this test proves
      // the RUNTIME guard (defense in depth for callers that cast).
      const result = adapter.toOutcomeEvent(baseReport, {
        tenant,
        subject,
        evidenceClass: researchClass as unknown as ObservedEvidenceClass,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");
    }
  });

  it("derives deterministic event ids and idempotency keys (same report ⇒ same event)", () => {
    const first = adapter.toOutcomeEvent(baseReport, { tenant, subject, evidenceClass: "staging" });
    const second = adapter.toOutcomeEvent(baseReport, { tenant, subject, evidenceClass: "staging" });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("mapping failed");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
    // Different event ⇒ different idempotency key.
    const opened = adapter.toOutcomeEvent({ ...baseReport, event: "opened" }, { tenant, subject, evidenceClass: "staging" });
    expect(opened.ok).toBe(true);
    if (!opened.ok) throw new Error(opened.error.message);
    expect(opened.value.idempotencyKey).not.toBe(first.value.idempotencyKey);
  });

  it("maps every commerce event kind to its contract outcome type", () => {
    const expected: [CommercePurchaseReport["event"], OutcomeEvent["eventType"]][] = [
      ["opened", "start"],
      ["purchased", "purchase"],
      ["order-completed", "completion"],
      ["cart-abandoned", "abandonment"],
      ["removed", "skip"],
      ["saved-for-later", "save"],
      ["shared", "share"],
      ["reviewed", "explicit-feedback"],
      ["re-engaged", "resume"],
    ];
    for (const [event, eventType] of expected) {
      const result = adapter.toOutcomeEvent(
        { purchaseId: `co-purchase-${event}`, at: T3, productId: "co-p-aurora-beans", event },
        { tenant, subject, evidenceClass: "production-observed" },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`${event}: ${result.error.message}`);
      expect(result.value.eventType).toBe(eventType);
    }
  });
});

// ---------------------------------------------------------------------------
// Preference deltas
// ---------------------------------------------------------------------------

describe("W3-007 commerce preference deltas", () => {
  function observedOutcome(eventType: OutcomeEvent["eventType"]): OutcomeEvent {
    const result = adapter.toOutcomeEvent(
      { purchaseId: `co-purchase-${eventType}`, at: T3, productId: "co-p-aurora-beans", event: "purchased" },
      { tenant, subject, evidenceClass: "controlled-local", contextId: "co-ctx-restock-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    return { ...result.value, eventType };
  }

  it("maps an observed purchase to deterministic category-affinity PreferenceDeltas", () => {
    const outcome = observedOutcome("purchase");
    const item = adapter.importCatalog(catalogImport);
    expect(item.ok).toBe(true);
    if (!item.ok) throw new Error(item.error.message);
    const beans = item.value.items[0] as CatalogItem;

    const deltas = adapter.toPreferenceDeltas(outcome, beans);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    // beans labels: coffee, grocery, pantry, physical (sorted, capped 8)
    expect(deltas.value).toHaveLength(4);
    for (const delta of deltas.value) {
      const parsed = expectValid(PreferenceDeltaSchema, delta);
      expect(parsed.dimension).toMatch(/^commerce\.category-affinity:/);
      expect(parsed.op).toBe("add");
      expect(parsed.value).toBe(0.5);
      expect(parsed.confidenceDelta).toBe(0.6);
      expect(parsed.model).toEqual({ modelId: "commerce-affinity-v1", version: "1" });
      expect(parsed.scope).toEqual({ contextId: "co-ctx-restock-1" });
    }
  });

  it("maps skip/abandonment/completion/feedback with the documented signed values and no affinity for other types", () => {
    const item = adapter.importCatalog(catalogImport);
    expect(item.ok).toBe(true);
    if (!item.ok) throw new Error(item.error.message);
    const beans = item.value.items[0] as CatalogItem;
    const expected: [OutcomeEvent["eventType"], number, number][] = [
      ["completion", 0.25, 0.2],
      ["abandonment", -0.1, 0.1],
      ["skip", -0.05, 0.05],
      ["explicit-feedback", 0.5, 0.6],
    ];
    for (const [eventType, value, confidenceDelta] of expected) {
      const deltas = adapter.toPreferenceDeltas(observedOutcome(eventType), beans);
      expect(deltas.ok).toBe(true);
      if (!deltas.ok) throw new Error(deltas.error.message);
      expect(deltas.value.length).toBeGreaterThan(0);
      for (const delta of deltas.value) {
        expect(delta.value).toBe(value);
        expect(delta.confidenceDelta).toBe(confidenceDelta);
      }
    }
    for (const eventType of ["start", "save", "share", "resume", "impression"] as const) {
      const deltas = adapter.toPreferenceDeltas(observedOutcome(eventType), beans);
      expect(deltas.ok).toBe(true);
      if (!deltas.ok) throw new Error(deltas.error.message);
      expect(deltas.value).toEqual([]);
    }
  });

  it("rejects research-class outcomes on the runtime learning path (ADR-004)", () => {
    const item = adapter.importCatalog(catalogImport);
    expect(item.ok).toBe(true);
    if (!item.ok) throw new Error(item.error.message);
    const beans = item.value.items[0] as CatalogItem;
    const fixtureOutcome = { ...observedOutcome("purchase"), evidenceClass: "fixture" as const };
    const result = adapter.toPreferenceDeltas(fixtureOutcome, beans);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");
  });
});

// ---------------------------------------------------------------------------
// THE FULL COMMERCE VERTICAL (product → offer/realization → experience
// → decision → schedule → outcome → preference delta)
// ---------------------------------------------------------------------------

describe("W3-007 commerce full vertical: product → offer/realization → experience → decision → schedule → outcome → preference delta", () => {
  it("runs end-to-end through the real kernels with schema-valid records at every stage", () => {
    // --- Adapter mappings (host shapes → frozen contracts).
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const contextResult = adapter.toContextSnapshot(shoppingSession);
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) throw new Error(contextResult.error.message);
    const purposeResult = adapter.toObjective({ purpose: "replenish", interestCategories: ["coffee", "grocery"] });
    expect(purposeResult.ok).toBe(true);
    if (!purposeResult.ok) throw new Error(purposeResult.error.message);
    const modeResult = adapter.toAttentionPolicy("casual"); // → balanced
    expect(modeResult.ok).toBe(true);
    if (!modeResult.ok) throw new Error(modeResult.error.message);
    const slateResult = standardSlate();
    expect(slateResult.ok).toBe(true);
    if (!slateResult.ok) throw new Error(slateResult.error.message);

    const objectiveFit = adapter.toObjectiveFit(catalog.value.items);

    // --- Decision 1: idle start, balanced policy → the scheduler
    //     QUEUES the best scored candidate (the scheduler never
    //     auto-starts; "showing" is host-authoritative).
    const vertical1 = runVertical({
      tenant,
      subject,
      objective: purposeResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: slateResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "card"],
      objectiveFit,
      policySelector: { policyId: "co-restock-policy", version: "1" },
      at: T1,
      requestId: "co-req-1",
      idempotencyKey: "co-idem-1",
    });
    const run1 = unwrapVertical(vertical1);

    // Every stage record is a schema-valid frozen contract.
    for (const item of catalog.value.items) expectValid(CatalogItemSchema, item);
    for (const realization of catalog.value.realizations) expectValid(RealizationSchema, realization);
    expectValid(ContextSnapshotSchema, contextResult.value);
    expectValid(CandidateSetSchema, slateResult.value);
    for (const entry of run1.expansion.experiences) expectValid(ExperienceSchema, entry.experience);
    expectValid(DecisionRequestSchema, run1.request);
    expectValid(DecisionResultSchema, run1.result);

    // Balanced (not mindful) from idle ⇒ QUEUE the best candidate.
    expect(run1.decision.action).toBe("QUEUE");
    expect(run1.decision.selectedExperienceId).toBeDefined();
    // No reward spec declared ⇒ objective-fit evidence only (lock #22).
    expect(run1.rewardApplied).toBe(false);
    // The best fit is the coffee product (interests: coffee + grocery).
    expect(run1.decision.selectedExperience?.itemId).toBe("co-p-aurora-beans");
    // The checkout offer expands into full + card experiences.
    expect(run1.expansion.experiences.filter((e) => e.experience.itemId === "co-p-aurora-beans")).toHaveLength(3);

    // Honest absence: the unknown slate row is an exclusion, never an
    // invented experience.
    const ghostExclusion = run1.expansion.exclusions.find(
      (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === "co-p-ghost",
    );
    expect(ghostExclusion).toBeDefined();
    expect(ghostExclusion?.detail).toContain("no-catalog-item");

    // --- Host present action → host-authoritative plan state (the
    //     storefront starts presenting the queued offer).
    const presentingId = run1.decision.selectedExperienceId;
    expect(presentingId).toBeDefined();
    if (presentingId === undefined) throw new Error("no selected experience");
    const presentIntents = adapter.toSchedulerIntents(
      { kind: "present", experienceId: presentingId },
      run1.decision.nextState,
    );
    expect(presentIntents.ok).toBe(true);
    if (!presentIntents.ok) throw new Error(presentIntents.error.message);
    expect(presentIntents.value.planState?.status).toBe("playing");
    expect(presentIntents.value.planState?.currentExperienceId).toBe(presentingId);

    const currentExperience = run1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === presentingId,
    )?.experience;
    expect(currentExperience).toBeDefined();
    if (currentExperience === undefined) throw new Error("current experience missing");

    // --- Host swap action with explicit caller-supplied numbers.
    const swapTarget = run1.scored.find(
      (entry) => entry.experience.itemId !== currentExperience.itemId,
    );
    expect(swapTarget).toBeDefined();
    if (swapTarget === undefined) throw new Error("no swap target");
    const swapAction = adapter.toSchedulerIntents(
      {
        kind: "swap",
        numbers: {
          fromExperienceId: presentingId,
          toExperienceId: swapTarget.experience.experienceId,
          expectedImprovement: 0.8,
          interruptionCost: 0.1,
          uncertaintyPenalty: 0.1,
          resumeLoss: 0.05,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      presentIntents.value.planState ?? idleState(),
    );
    expect(swapAction.ok).toBe(true);
    if (!swapAction.ok) throw new Error(swapAction.error.message);

    // --- Decision 2: playing + swap input ⇒ SWITCH (net 0.55 > 0.5),
    //     with a resume checkpoint (RESUME LAW: token caller-supplied).
    const vertical2 = runVertical({
      tenant,
      subject,
      objective: purposeResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: slateResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "card"],
      objectiveFit,
      policySelector: { policyId: "co-restock-policy", version: "1" },
      at: T2,
      requestId: "co-req-2",
      idempotencyKey: "co-idem-2",
      startState: presentIntents.value.planState,
      currentExperience,
      intents: {
        switch: swapAction.value.switch,
        resumeTokens: { [presentingId]: "co-cart-hold-2" },
      },
    });
    const run2 = unwrapVertical(vertical2);
    expectValid(DecisionRequestSchema, run2.request);
    expectValid(DecisionResultSchema, run2.result);

    expect(run2.decision.action).toBe("SWITCH");
    expect(run2.decision.selectedExperienceId).toBe(swapTarget.experience.experienceId);
    expect(run2.decision.nextState.status).toBe("playing");
    expect(run2.decision.resumeCheckpointSlot).toEqual({
      experienceId: presentingId,
      resumeToken: "co-cart-hold-2",
      source: "SWITCH",
    });
    expect(run2.decision.scheduleDelta.resumeCheckpoint).toEqual({
      experienceId: presentingId,
      resumeToken: "co-cart-hold-2",
    });

    // --- Purchase outcome for the swapped-to product (observed class).
    const targetItem = catalog.value.items.find((item) => item.itemId === swapTarget.experience.itemId);
    expect(targetItem).toBeDefined();
    if (targetItem === undefined) throw new Error("target item missing");
    const outcomeResult = adapter.toOutcomeEvent(
      {
        purchaseId: "co-purchase-901",
        at: T3,
        productId: targetItem.itemId,
        experienceId: run2.decision.selectedExperienceId,
        decisionId: run2.result.decisionId,
        event: "purchased",
        cartValue: 32.5,
        orderValue: 14,
        quantity: 1,
      },
      { tenant, subject, evidenceClass: "controlled-local", contextId: contextResult.value.contextId },
    );
    expect(outcomeResult.ok).toBe(true);
    if (!outcomeResult.ok) throw new Error(outcomeResult.error.message);
    const outcome = expectValid(OutcomeEventSchema, outcomeResult.value);
    expect(outcome.eventType).toBe("purchase");
    expect(outcome.decisionId).toBe(run2.result.decisionId);
    expect(outcome.experienceId).toBe(run2.decision.selectedExperienceId);
    expect(outcome.evidenceClass).toBe("controlled-local");

    // --- Outcome → preference delta closes the vertical loop.
    const deltas = adapter.toPreferenceDeltas(outcome, targetItem);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    expect(deltas.value.length).toBeGreaterThan(0);
    for (const delta of deltas.value) expectValid(PreferenceDeltaSchema, delta);

    // --- Determinism: the whole vertical is byte-identical when re-run
    //     from the same fixture (all mappings and kernels deterministic).
    const replay1 = runVertical({
      tenant,
      subject,
      objective: purposeResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: slateResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "card"],
      objectiveFit,
      policySelector: { policyId: "co-restock-policy", version: "1" },
      at: T1,
      requestId: "co-req-1",
      idempotencyKey: "co-idem-1",
    });
    const replayRun1 = unwrapVertical(replay1);
    expect(canonicalJson(replayRun1)).toBe(canonicalJson(run1));
  });
});

// ---------------------------------------------------------------------------
// Constraint defense-in-depth on the vertical
// ---------------------------------------------------------------------------

describe("W3-007 commerce vertical constraint defense-in-depth", () => {
  it("excludes over-duration presentations at expansion (never scored, never selected)", () => {
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const contextResult = adapter.toContextSnapshot(shoppingSession);
    const purposeResult = adapter.toObjective({ purpose: "replenish", interestCategories: ["coffee", "grocery"] });
    const modeResult = adapter.toAttentionPolicy("casual");
    const slateResult = standardSlate();
    expect(contextResult.ok && purposeResult.ok && modeResult.ok && slateResult.ok).toBe(true);
    if (!contextResult.ok || !purposeResult.ok || !modeResult.ok || !slateResult.ok) {
      throw new Error("mapping failed");
    }

    // Every offer presentation longer than 120s is excluded: the
    // product-page beans offer (120s allowed — not excluded), the
    // Focus Flow subscription presentation (210s — excluded).
    const constraints: HardConstraint[] = [{ kind: "max-duration", seconds: 120 }];
    const vertical = runVertical({
      tenant,
      subject,
      objective: purposeResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: slateResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints,
      allowedFormats: ["full", "card"],
      objectiveFit: adapter.toObjectiveFit(catalog.value.items),
      policySelector: { policyId: "co-restock-policy", version: "1" },
      at: T1,
      requestId: "co-req-c",
      idempotencyKey: "co-idem-c",
    });
    const run = unwrapVertical(vertical);

    const focusExclusions = run.expansion.exclusions.filter(
      (exclusion) => exclusion.kind === "experience-excluded" && exclusion.itemId === "co-p-focus-flow",
    );
    expect(focusExclusions).toHaveLength(1);
    for (const exclusion of focusExclusions) {
      expect(exclusion.kind === "experience-excluded" && exclusion.reasons).toContain("max-duration");
    }
    // Excluded experiences are never scored.
    expect(run.scored.every((entry) => entry.experience.itemId !== "co-p-focus-flow")).toBe(true);
    // The selected experience respects the constraint.
    expect(run.decision.selectedExperience?.duration as number).toBeLessThanOrEqual(120);
  });
});
