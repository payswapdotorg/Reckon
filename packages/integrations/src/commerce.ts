/**
 * W3-007 — the commerce reference adapter.
 *
 * Proves the commerce vertical over the frozen normalized contracts
 * (docs/work-items/worker-3.md: product → offer/realization →
 * experience → decision → schedule → outcome):
 *
 *   commerce catalog (products, categories, sale windows, offers)
 *                             → `CatalogItem` + `Realization`
 *   merchandising slate rows  → `CandidateSet`
 *   shopping session          → `ContextSnapshot`
 *   shopping purpose / mode   → `Objective` / `AttentionPolicy`
 *   host present/stage/swap/suspend/abandon actions → scheduler
 *   action inputs (plan-state truth + `SwitchEvaluationInput` + host flags)
 *   commerce system purchase reports → `OutcomeEvent`s with an
 *   OBSERVED evidence class
 *   observed outcomes         → `PreferenceDelta`s (deterministic
 *   documented category-affinity rule)
 *
 * LAWS enforced here (structural peer of W3-005/W3-006):
 * - HOST-BOUNDARY LAW: the adapter NEVER imports host-internal
 *   persistence — every commerce-shaped value enters through interface
 *   types declared in THIS package (plain data in, contract records
 *   out). The only imports are the frozen contracts, type-only
 *   scheduler/experience seams and local modules.
 * - HOST-AUTHORITY LAW: identity, consent, catalog authoring, rights,
 *   provider access, delivery, and payment remain the host commerce
 *   system's. The adapter passes host commerce policy tags and prices
 *   through; it never verifies rights and never computes prices.
 * - NO CORE RANKING LOGIC here (forbidden dependency direction): the
 *   adapter maps data; decisions come from the W2 kernels. The only
 *   host policy it implements is the injected objective-fit function
 *   (documented deterministic category-affinity overlap).
 * - EVIDENCE LAW: purchase reports are an OBSERVATION channel — only
 *   observed evidence classes are accepted; simulated/counterfactual/
 *   fixture classes are typed errors (architecture-lock #20).
 * - Determinism: same input ⇒ byte-identical output. Derived ids use
 *   canonical content digests; no clocks, no randomness, no network.
 * - Fixture-only: no live commerce system has been contacted. See
 *   COMMERCE_ADAPTER_DECLARATION.liveVerification.
 */
import {
  CatalogItemSchema,
  CandidateSetSchema,
  ContextSnapshotSchema,
  AttentionPolicySchema,
  ObjectiveSchema,
  OutcomeEventSchema,
  OBSERVED_EVIDENCE_CLASSES,
  PreferenceDeltaSchema,
  RealizationSchema,
  TenantScopeSchema,
  contentDigest,
  type AttentionPolicy,
  type CatalogItem,
  type CandidateSet,
  type ContextSnapshot,
  type Id,
  type Objective,
  type OutcomeEvent,
  type PreferenceDelta,
  type Realization,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
// Type-only cross-package seams (erased at runtime; no package.json or
// lockfile change — same convention as the W2 packages).
import type { PlanState, SwitchEvaluationInput } from "../../scheduler/src/index.js";
import type { ObjectiveFitFn } from "../../experience/src/index.js";
import type {
  AdapterDeclaration,
  HostSchedulerIntents,
  ObservedEvidenceClass,
} from "./declaration.js";
import type { AdapterResult, IssueList } from "./errors.js";
import { invalidAdapterInput, limitExceeded, unsupportedEvidenceClass } from "./errors.js";
import {
  checkEnum,
  checkEnumArray,
  checkId,
  checkLocalTime,
  checkNonNegativeNumber,
  checkOptional,
  checkOptionalBoolean,
  checkOptionalLocale,
  checkPlanState,
  checkString,
  checkStringArray,
  checkTimestamp,
  dayPartOf,
  deriveId,
  hostEnqueueTransition,
  hostStartTransition,
  isPlainObject,
  sortedUniqueLabels,
} from "./internal.js";

// ---------------------------------------------------------------------------
// Host interface types (declared HERE — the host-boundary law)
// ---------------------------------------------------------------------------

/** A commerce surface an offer can be presented on. */
export type CommerceSurface = "product-page" | "cart" | "checkout" | "shop-app";

/** An offer a commerce host declares for one product (becomes a Realization). */
export interface CommerceOffer {
  /** Host offer id (becomes the Realization id). */
  offerId: string;
  surface: CommerceSurface;
  /** Primary presentation locale (optional, BCP-47). */
  locale?: string;
  /** Host-declared currency (ISO-4217, 3 letters; pass-through, never computed). */
  currency: string;
  /** Host-declared price in `currency` (pass-through; the adapter never prices). */
  priceAmount: number;
  /** How the host fulfills this offer. */
  fulfillment: "shipping" | "pickup" | "digital-delivery";
  /** Host-declared stock truth. */
  inStock: boolean;
  /** Host-declared backorder eligibility. */
  backorderEligible?: boolean;
  /** Host-declared estimated seconds to present this offer. */
  presentSeconds?: number;
  /** Additional presentation variants this offer supports (base "full" is implicit). */
  presentations?: ("card")[];
}

/** A commerce catalog product (host shape). */
export interface CommerceProduct {
  productId: string;
  name: string;
  productKind: "physical" | "digital" | "subscription";
  categories: string[];
  saleStartsAt?: number;
  saleEndsAt?: number;
  /** Host-declared commerce policy tags (pass-through, never verified). */
  commercePolicyTags: string[];
  offers: CommerceOffer[];
}

/** One commerce catalog export batch (all-or-nothing import). */
export interface CommerceCatalogImport {
  merchant: string;
  exportedAt: number;
  products: CommerceProduct[];
}

/** One merchandising slate row. */
export interface MerchandisingRow {
  productId: string;
  /** 1-based rank in the host slate (retrieval hint, never a decision). */
  rank: number;
  note?: string;
}

/** A merchandising slate snapshot (host retrieval shape). */
export interface MerchandisingSlate {
  slateId: string;
  merchant: string;
  rows: MerchandisingRow[];
}

/** A shopping session snapshot (host context shape). */
export interface ShoppingSession {
  shopperId: string;
  sessionId: string;
  at: number;
  device: "phone" | "desktop" | "tablet" | "store-kiosk";
  networkKind: "wifi" | "cellular" | "offline";
  /** 24h "HH:MM" local time at the host. */
  localTime: string;
  timezone: string;
  minutesAvailable?: number;
  recentPrompts?: number;
  midVisit?: boolean;
}

/** A shopping purpose (host-declared objective). */
export interface ShoppingPurpose {
  purpose: "replenish" | "browse" | "gift-hunt" | "decide" | "finish-order";
  /** Declared interest categories (host policy input for objective fit). */
  interestCategories: string[];
}

/** A shopping attention mode (host-declared attention policy). */
export type ShoppingAttentionMode = "focused" | "casual" | "deal-sprint";

/** Caller-supplied swap numbers (SEPARATION LAW: every number is host-supplied). */
export interface CommerceSwapNumbers {
  fromExperienceId: string;
  toExperienceId: string;
  expectedImprovement: number;
  interruptionCost: number;
  uncertaintyPenalty: number;
  resumeLoss: number;
  switchThreshold: number;
  suggestThreshold: number;
}

/** A commerce host action (storefront/cart/checkout intent). */
export type CommerceHostAction =
  | { kind: "present"; experienceId: string }
  | { kind: "stage"; experienceIds: string[] }
  | { kind: "swap"; numbers: CommerceSwapNumbers }
  | { kind: "suspend"; experienceId: string; resumeToken?: string }
  | { kind: "abandon" };

/** A commerce system purchase report (host OBSERVATION channel). */
export interface CommercePurchaseReport {
  purchaseId: string;
  at: number;
  productId: string;
  /** Present when the purchase came from a Reckon decision. */
  experienceId?: string;
  decisionId?: string;
  event:
    | "opened"
    | "purchased"
    | "order-completed"
    | "cart-abandoned"
    | "removed"
    | "saved-for-later"
    | "shared"
    | "reviewed"
    | "re-engaged";
  /** Host-declared cart value at report time (pass-through). */
  cartValue?: number;
  /** Host-declared order value for purchase-shaped reports (pass-through). */
  orderValue?: number;
  /** Host-declared item quantity. */
  quantity?: number;
}

/** Options for mapping a purchase report to an outcome event. */
export interface CommerceOutcomeOptions {
  tenant: TenantScope;
  subject: SubjectReference;
  /**
   * Host-declared class of the observation channel. The commerce
   * reporting channel is an OBSERVATION channel: only observed
   * evidence classes are accepted ("production-observed" |
   * "staging" | "controlled-local"). Simulated/counterfactual/fixture
   * classes are typed errors.
   */
  evidenceClass: ObservedEvidenceClass;
  contextId?: Id;
}

// ---------------------------------------------------------------------------
// Adapter declaration (typed constant — fixture-only, host-authoritative)
// ---------------------------------------------------------------------------

export const COMMERCE_ADAPTER_DECLARATION: AdapterDeclaration = {
  adapterId: "commerce-reference-adapter",
  domain: "commerce",
  contractVersion: "0.1.0",
  supportedCapabilities: [
    "catalog-import", // commerce catalog export → CatalogItem + Realization
    "retrieval-mapping", // merchandising slate → CandidateSet
    "context-mapping", // shopping session → ContextSnapshot
    "objective-mapping", // shopping purpose → Objective
    "attention-policy-mapping", // shopping mode → AttentionPolicy
    "objective-fit-host-policy", // deterministic category-affinity fit function
    "scheduler-intent-mapping", // present/stage/swap/suspend/abandon → scheduler inputs
    "commerce-outcome-mapping", // purchase reports → OutcomeEvent (observed class only)
    "preference-delta-mapping", // observed outcomes → PreferenceDelta
  ],
  unsupportedCapabilities: [
    "identity", // host-authoritative
    "consent-management", // host-authoritative
    "rights-verification", // commerce policy tags are pass-through only; host gates verify
    "catalog-authoring", // the adapter maps host catalog truth; it never authors it
    "provider-access", // marketplace/seller provider authorization stays host-side
    "offer-delivery", // the host storefront delivers presentations; the adapter never does
    "pricing", // prices are host-declared pass-through values; never computed here
    "payment", // host checkout owns payment; the adapter never touches it
    "live-provider-calls", // fixture-only: the adapter performs no network calls
  ],
  authorizationRequirements: [
    {
      resource: "commerce-catalog-export",
      requirement: "Host-issued service credential with catalog read scope; the adapter receives already-authorized export batches",
      enforcedBy: "host",
    },
    {
      resource: "commerce-purchase-telemetry",
      requirement: "Host commerce reporting consent for the reporting subject (host consent system)",
      enforcedBy: "host",
    },
    {
      resource: "commerce-policy-gates",
      requirement: "Host rights/entitlement/commerce policy gates pass before any offer delivery; the adapter only passes commercePolicyTags through",
      enforcedBy: "host",
    },
    {
      resource: "reckon-decision-api",
      requirement: "Tenant-scoped Reckon API bearer key for decision/outcome routes",
      enforcedBy: "reckon-api",
    },
  ],
  limits: {
    maxItemsPerImport: 256,
    maxRealizationsPerItem: 8,
    maxCandidatesPerSet: 256,
    mappingLatencyBudgetMs: 5,
  },
  liveVerification: {
    status: "fixture-only",
    evidenceClass: "fixture",
    note: "No live commerce provider has been contacted. All mapping evidence is fixture evidence; a live path additionally requires real authorization, observed output, measured latency and failure behavior (AGENTS.md production truth).",
  },
  provenance: {
    dataOwnership: "host",
    catalogSource: "Host commerce catalog export batches (adapter input; never host persistence)",
    rightsSource: "Host commerce policy service — host-declared commercePolicyTags pass through unverified",
    deliverySource: "Host storefront/checkout (host delivery authority)",
    identitySource: "Host identity system (host shopper ids)",
    consentSource: "Host consent system",
  },
  failureSemantics: {
    invalidInput: "typed-error",
    unknownVocabulary: "typed-error",
    unavailableData: "honest-absence",
    partialImport: "rejected",
    liveProviderCalls: "none",
    nonObservedEvidence: "typed-error",
  },
};

// ---------------------------------------------------------------------------
// Documented mapping tables (deterministic, host-declared semantics)
// ---------------------------------------------------------------------------

const COMMERCE_SURFACE_DEVICES: Record<CommerceSurface, string[]> = {
  "product-page": ["desktop", "phone", "tablet"],
  cart: ["desktop", "phone", "tablet"],
  checkout: ["desktop", "phone"],
  "shop-app": ["phone"],
};

const COMMERCE_DEVICE_CLASS: Record<ShoppingSession["device"], "phone" | "desktop" | "tablet" | "other"> = {
  phone: "phone",
  desktop: "desktop",
  tablet: "tablet",
  "store-kiosk": "other",
};

const COMMERCE_EVENT_TYPES: Record<CommercePurchaseReport["event"], OutcomeEvent["eventType"]> = {
  opened: "start",
  purchased: "purchase",
  "order-completed": "completion",
  "cart-abandoned": "abandonment",
  removed: "skip",
  "saved-for-later": "save",
  shared: "share",
  reviewed: "explicit-feedback",
  "re-engaged": "resume",
};

const COMMERCE_PURPOSE_KIND: Record<ShoppingPurpose["purpose"], Objective["kind"]> = {
  replenish: "shop",
  browse: "discover",
  "gift-hunt": "find-gift",
  decide: "compare",
  "finish-order": "complete-task",
};

const COMMERCE_MODE_POLICY: Record<ShoppingAttentionMode, AttentionPolicy["style"]> = {
  focused: "mindful",
  casual: "balanced",
  "deal-sprint": "immersive",
};

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/** The commerce reference adapter (pure deterministic mapper). */
export interface CommerceAdapter {
  readonly declaration: AdapterDeclaration;

  /** Commerce catalog export → Reckon CatalogItem + Realization records. */
  importCatalog(input: CommerceCatalogImport): AdapterResult<{ items: CatalogItem[]; realizations: Realization[] }>;

  /** Merchandising slate → Reckon CandidateSet. */
  toCandidateSet(slate: MerchandisingSlate): AdapterResult<CandidateSet>;

  /** Shopping session → Reckon ContextSnapshot. */
  toContextSnapshot(session: ShoppingSession): AdapterResult<ContextSnapshot>;

  /** Shopping purpose → Reckon Objective. */
  toObjective(purpose: ShoppingPurpose): AdapterResult<Objective>;

  /** Shopping attention mode → Reckon AttentionPolicy. */
  toAttentionPolicy(mode: ShoppingAttentionMode): AdapterResult<AttentionPolicy>;

  /**
   * Deterministic host objective-fit policy: overlap between the
   * product's mapped labels and the purpose's declared interest
   * categories, divided by the number of declared interests (0 when no
   * interest is declared — never fabricated). Pure port implementation
   * for the experience expander.
   */
  toObjectiveFit(items: CatalogItem[]): ObjectiveFitFn;

  /** Host present/stage/swap/suspend/abandon → scheduler action inputs. */
  toSchedulerIntents(action: CommerceHostAction, currentState: PlanState): AdapterResult<HostSchedulerIntents>;

  /** Purchase report → OutcomeEvent with an OBSERVED evidence class. */
  toOutcomeEvent(report: CommercePurchaseReport, options: CommerceOutcomeOptions): AdapterResult<OutcomeEvent>;

  /**
   * Observed outcome + catalog product → deterministic
   * category-affinity PreferenceDeltas (empty for outcome types that
   * carry no affinity evidence — documented rule, never fabricated).
   */
  toPreferenceDeltas(outcome: OutcomeEvent, item: CatalogItem): AdapterResult<PreferenceDelta[]>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateOffer(
  raw: unknown,
  path: string,
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be an offer object" });
    return;
  }
  checkId(raw["offerId"], `${path}.offerId`, issues);
  checkEnum(raw["surface"], `${path}.surface`, ["product-page", "cart", "checkout", "shop-app"] as const, issues);
  checkOptionalLocale(raw["locale"], `${path}.locale`, issues);
  checkString(raw["currency"], `${path}.currency`, 3, 3, issues);
  checkNonNegativeNumber(raw["priceAmount"], `${path}.priceAmount`, issues);
  checkEnum(raw["fulfillment"], `${path}.fulfillment`, ["shipping", "pickup", "digital-delivery"] as const, issues);
  checkOptionalBoolean(raw["inStock"], `${path}.inStock`, issues);
  checkOptionalBoolean(raw["backorderEligible"], `${path}.backorderEligible`, issues);
  checkOptional(raw["presentSeconds"], `${path}.presentSeconds`, checkNonNegativeNumber, issues);
  checkEnumArray(raw["presentations"], `${path}.presentations`, ["card"] as const, issues);
  const presentations = raw["presentations"];
  if (Array.isArray(presentations) && presentations.length > 1) {
    issues.push({ path: `${path}.presentations`, message: "must contain at most 1 presentation variant" });
  }
}

function validateProduct(
  raw: unknown,
  path: string,
  limits: AdapterDeclaration["limits"],
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a product object" });
    return;
  }
  checkId(raw["productId"], `${path}.productId`, issues);
  checkString(raw["name"], `${path}.name`, 1, 512, issues);
  checkEnum(raw["productKind"], `${path}.productKind`, ["physical", "digital", "subscription"] as const, issues);
  checkStringArray(raw["categories"], `${path}.categories`, 1, 16, 1, 64, issues);
  checkOptional(raw["saleStartsAt"], `${path}.saleStartsAt`, checkTimestamp, issues);
  checkOptional(raw["saleEndsAt"], `${path}.saleEndsAt`, checkTimestamp, issues);
  checkStringArray(raw["commercePolicyTags"], `${path}.commercePolicyTags`, 0, 16, 1, 64, issues);
  const offers = raw["offers"];
  if (!Array.isArray(offers) || offers.length === 0) {
    issues.push({ path: `${path}.offers`, message: "must be a non-empty array of offers" });
  } else {
    if (offers.length > limits.maxRealizationsPerItem) {
      issues.push({
        path: `${path}.offers`,
        message: `product declares ${offers.length} offers; limit is ${limits.maxRealizationsPerItem}`,
      });
    }
    offers.forEach((offer, index) => {
      validateOffer(offer, `${path}.offers[${index}]`, issues);
    });
  }
  const starts = raw["saleStartsAt"];
  const ends = raw["saleEndsAt"];
  if (
    typeof starts === "number" && typeof ends === "number" &&
    Number.isInteger(starts) && Number.isInteger(ends) && ends <= starts
  ) {
    issues.push({ path: `${path}.saleEndsAt`, message: "must be greater than saleStartsAt" });
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Create the commerce reference adapter (stateless, pure). */
export function createCommerceAdapter(): CommerceAdapter {
  const declaration = COMMERCE_ADAPTER_DECLARATION;

  return {
    declaration,

    importCatalog(input) {
      if (!isPlainObject(input)) {
        return invalidAdapterInput("importCatalog: input must be an object");
      }
      const issues: IssueList = [];
      checkString(input["merchant"], "merchant", 1, 64, issues);
      checkTimestamp(input["exportedAt"], "exportedAt", issues);
      const rawProducts = input["products"];
      if (!Array.isArray(rawProducts) || rawProducts.length === 0) {
        issues.push({ path: "products", message: "must be a non-empty array of products" });
      } else if (rawProducts.length > declaration.limits.maxItemsPerImport) {
        return limitExceeded(
          `importCatalog: ${rawProducts.length} products exceed the import limit of ${declaration.limits.maxItemsPerImport}`,
        );
      } else {
        rawProducts.forEach((product, index) => {
          validateProduct(product, `products[${index}]`, declaration.limits, issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("importCatalog: invalid commerce catalog import", issues);
      }

      const products = rawProducts as CommerceProduct[];
      // All-or-nothing duplicate detection (deterministic).
      const seenProducts = new Set<string>();
      const seenOffers = new Set<string>();
      for (const product of products) {
        if (seenProducts.has(product.productId)) {
          return invalidAdapterInput(`importCatalog: duplicate productId ${product.productId} (all-or-nothing import)`);
        }
        seenProducts.add(product.productId);
        for (const offer of product.offers) {
          if (seenOffers.has(offer.offerId)) {
            return invalidAdapterInput(
              `importCatalog: duplicate offerId ${offer.offerId} (realization ids must be unique per import)`,
            );
          }
          seenOffers.add(offer.offerId);
        }
      }

      const catalogItems: CatalogItem[] = [];
      const realizations: Realization[] = [];
      for (const product of products) {
        const parsedItem = CatalogItemSchema.safeParse({
          itemId: product.productId,
          kind: "commerce",
          labels: sortedUniqueLabels([product.productKind, ...product.categories]),
          attributes: {
            name: product.name,
            productKind: product.productKind,
            commercePolicyTags: [...product.commercePolicyTags],
          },
          ...(product.saleStartsAt !== undefined ? { availableFrom: product.saleStartsAt } : {}),
          ...(product.saleEndsAt !== undefined ? { availableUntil: product.saleEndsAt } : {}),
        });
        if (!parsedItem.success) {
          return invalidAdapterInput(
            `importCatalog: constructed catalog item for ${product.productId} failed schema validation`,
            parsedItem.error.issues.map((i) => ({ path: `items.${product.productId}.${i.path.join(".")}`, message: i.message })),
          );
        }
        catalogItems.push(parsedItem.data);

        for (const offer of product.offers) {
          const formats = sortedUniqueLabels(["full", ...(offer.presentations ?? [])]);
          const parsedRealization = RealizationSchema.safeParse({
            realizationId: offer.offerId,
            itemId: product.productId,
            kind: offer.surface,
            ...(offer.locale !== undefined ? { locale: offer.locale } : {}),
            constraints: {
              formats,
              ...(offer.presentSeconds !== undefined ? { durationSeconds: offer.presentSeconds } : {}),
              deviceClasses: [...COMMERCE_SURFACE_DEVICES[offer.surface]],
              requiresScreen: true,
              requiresAudio: false,
              minBandwidth: "low",
              currency: offer.currency,
              priceAmount: offer.priceAmount,
              fulfillment: offer.fulfillment,
              inStock: offer.inStock,
              ...(offer.backorderEligible !== undefined ? { backorderEligible: offer.backorderEligible } : {}),
            },
          });
          if (!parsedRealization.success) {
            return invalidAdapterInput(
              `importCatalog: constructed realization for ${offer.offerId} failed schema validation`,
              parsedRealization.error.issues.map((i) => ({ path: `realizations.${offer.offerId}.${i.path.join(".")}`, message: i.message })),
            );
          }
          realizations.push(parsedRealization.data);
        }
      }

      return { ok: true, value: { items: catalogItems, realizations } };
    },

    toCandidateSet(slate) {
      if (!isPlainObject(slate)) {
        return invalidAdapterInput("toCandidateSet: input must be an object");
      }
      const issues: IssueList = [];
      checkId(slate["slateId"], "slateId", issues);
      checkString(slate["merchant"], "merchant", 1, 64, issues);
      const rows = slate["rows"];
      if (!Array.isArray(rows) || rows.length === 0) {
        issues.push({ path: "rows", message: "must be a non-empty array of merchandising rows" });
      } else if (rows.length > declaration.limits.maxCandidatesPerSet) {
        return limitExceeded(
          `toCandidateSet: ${rows.length} rows exceed the candidate-set limit of ${declaration.limits.maxCandidatesPerSet}`,
        );
      } else {
        rows.forEach((row, index) => {
          if (!isPlainObject(row)) {
            issues.push({ path: `rows[${index}]`, message: "must be an object" });
            return;
          }
          checkId(row["productId"], `rows[${index}].productId`, issues);
          const rank = row["rank"];
          if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
            issues.push({ path: `rows[${index}].rank`, message: "must be a positive integer 1-based rank" });
          }
          checkOptional(row["note"], `rows[${index}].note`, (v, p, list) => checkString(v, p, 1, 256, list), issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("toCandidateSet: invalid merchandising slate", issues);
      }

      const parsed = CandidateSetSchema.safeParse({
        setId: slate.slateId,
        candidates: slate.rows.map((row) => ({
          itemId: row.productId,
          realizationIds: [],
          source: slate.merchant,
          rankHint: row.rank,
        })),
        provenance: {
          system: slate.merchant,
          correlationId: slate.slateId,
        },
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toCandidateSet: constructed candidate set failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toContextSnapshot(session) {
      if (!isPlainObject(session)) {
        return invalidAdapterInput("toContextSnapshot: input must be an object");
      }
      const issues: IssueList = [];
      checkString(session["shopperId"], "shopperId", 1, 512, issues);
      checkId(session["sessionId"], "sessionId", issues);
      checkTimestamp(session["at"], "at", issues);
      checkEnum(session["device"], "device", ["phone", "desktop", "tablet", "store-kiosk"] as const, issues);
      checkEnum(session["networkKind"], "networkKind", ["wifi", "cellular", "offline"] as const, issues);
      checkLocalTime(session["localTime"], "localTime", issues);
      checkString(session["timezone"], "timezone", 1, 64, issues);
      checkOptional(session["minutesAvailable"], "minutesAvailable", checkNonNegativeNumber, issues);
      checkOptional(session["recentPrompts"], "recentPrompts", (v, p, list) => {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          list.push({ path: p, message: "must be a non-negative integer" });
        }
      }, issues);
      checkOptionalBoolean(session["midVisit"], "midVisit", issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toContextSnapshot: invalid shopping session", issues);
      }

      const parsed = ContextSnapshotSchema.safeParse({
        contextId: session.sessionId,
        at: session.at,
        time: {
          localTime: session.localTime,
          timezone: session.timezone,
          dayPart: dayPartOf(session.localTime),
        },
        device: { class: COMMERCE_DEVICE_CLASS[session.device] },
        network: { class: session.networkKind },
        activity: session.midVisit === true ? ["mid-visit"] : [],
        ...(session.minutesAvailable !== undefined
          ? { attention: { availableMs: Math.round(session.minutesAvailable * 60_000) } }
          : {}),
        ...(session.recentPrompts !== undefined
          ? { fatigue: { recentInterruptions: session.recentPrompts } }
          : {}),
        session: { sessionId: session.sessionId },
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toContextSnapshot: constructed context snapshot failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toObjective(purpose) {
      if (!isPlainObject(purpose)) {
        return invalidAdapterInput("toObjective: input must be an object");
      }
      const issues: IssueList = [];
      checkEnum(purpose["purpose"], "purpose", ["replenish", "browse", "gift-hunt", "decide", "finish-order"] as const, issues);
      checkStringArray(purpose["interestCategories"], "interestCategories", 0, 16, 1, 64, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toObjective: invalid shopping purpose", issues);
      }
      const parsed = ObjectiveSchema.safeParse({
        objectiveId: `co-goal-${purpose.purpose}`,
        kind: COMMERCE_PURPOSE_KIND[purpose.purpose],
        params: { interestCategories: [...purpose.interestCategories] },
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toObjective: constructed objective failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toAttentionPolicy(mode) {
      const issues: IssueList = [];
      const mapped = checkEnum(mode, "mode", ["focused", "casual", "deal-sprint"] as const, issues);
      if (issues.length > 0 || mapped === undefined) {
        return invalidAdapterInput("toAttentionPolicy: invalid shopping attention mode", issues);
      }
      const parsed = AttentionPolicySchema.safeParse({
        policyId: `co-attention-${mapped}`,
        style: COMMERCE_MODE_POLICY[mapped],
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toAttentionPolicy: constructed attention policy failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toObjectiveFit(items) {
      // First occurrence wins (deterministic regardless of input order).
      const labelsByItem = new Map<string, Set<string>>();
      for (const item of Array.isArray(items) ? items : []) {
        if (!labelsByItem.has(item.itemId)) {
          labelsByItem.set(item.itemId, new Set(item.labels));
        }
      }
      return (experience, objective) => {
        const interests = objective.params?.["interestCategories"];
        if (!Array.isArray(interests) || interests.length === 0 || interests.some((c) => typeof c !== "string")) {
          return 0; // no declared interest evidence — never fabricated
        }
        const labels = labelsByItem.get(experience.itemId);
        if (labels === undefined) return 0;
        let hits = 0;
        for (const category of interests) {
          if (labels.has(category)) hits += 1;
        }
        return hits / interests.length;
      };
    },

    toSchedulerIntents(action, currentState) {
      // Validate the untrusted action shape at the boundary (kernel
      // convention: check the raw record, then narrow via cast).
      const raw: unknown = action;
      if (!isPlainObject(raw)) {
        return invalidAdapterInput("toSchedulerIntents: action must be an object");
      }
      const stateIssues: IssueList = [];
      checkPlanState(currentState, "currentState", stateIssues);
      if (stateIssues.length > 0) {
        return invalidAdapterInput("toSchedulerIntents: invalid current plan state", stateIssues);
      }
      const issues: IssueList = [];
      const kind = checkEnum(raw["kind"], "kind", ["present", "stage", "swap", "suspend", "abandon"] as const, issues);
      if (kind === "present") {
        checkId(raw["experienceId"], "experienceId", issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid present action", issues);
        const present = raw as unknown as { kind: "present"; experienceId: string };
        const transition = hostStartTransition(currentState, present.experienceId);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "stage") {
        checkStringArray(raw["experienceIds"], "experienceIds", 1, 16, 1, 128, issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid stage action", issues);
        const stage = raw as unknown as { kind: "stage"; experienceIds: string[] };
        const transition = hostEnqueueTransition(currentState, stage.experienceIds);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "swap") {
        const numbersRaw = raw["numbers"];
        if (!isPlainObject(numbersRaw)) {
          return invalidAdapterInput("toSchedulerIntents: swap action requires a numbers object");
        }
        checkId(numbersRaw["fromExperienceId"], "numbers.fromExperienceId", issues);
        checkId(numbersRaw["toExperienceId"], "numbers.toExperienceId", issues);
        for (const field of [
          "expectedImprovement",
          "interruptionCost",
          "uncertaintyPenalty",
          "resumeLoss",
          "switchThreshold",
          "suggestThreshold",
        ] as const) {
          const value = numbersRaw[field];
          if (typeof value !== "number" || !Number.isFinite(value)) {
            issues.push({ path: `numbers.${field}`, message: "must be a finite number (caller-supplied; never guessed)" });
          }
        }
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid swap numbers", issues);
        const numbers = numbersRaw as unknown as CommerceSwapNumbers;
        const switchInput: SwitchEvaluationInput = {
          currentExperienceId: numbers.fromExperienceId,
          candidateExperienceId: numbers.toExperienceId,
          expectedImprovement: numbers.expectedImprovement,
          interruptionCost: numbers.interruptionCost,
          uncertaintyPenalty: numbers.uncertaintyPenalty,
          resumeLoss: numbers.resumeLoss,
          switchThreshold: numbers.switchThreshold,
          suggestThreshold: numbers.suggestThreshold,
        };
        return { ok: true, value: { switch: switchInput } };
      }
      if (kind === "suspend") {
        checkId(raw["experienceId"], "experienceId", issues);
        checkOptional(raw["resumeToken"], "resumeToken", (v, p, list) => checkString(v, p, 1, 1024, list), issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid suspend action", issues);
        const suspend = raw as unknown as { kind: "suspend"; experienceId: string; resumeToken?: string };
        return {
          ok: true,
          value: {
            interruptRequested: true,
            ...(suspend.resumeToken !== undefined
              ? { resumeTokens: { [suspend.experienceId]: suspend.resumeToken } }
              : {}),
          },
        };
      }
      if (kind === "abandon") {
        return { ok: true, value: { endRequested: true } };
      }
      return invalidAdapterInput("toSchedulerIntents: action kind must be present, stage, swap, suspend or abandon", issues);
    },

    toOutcomeEvent(report, options) {
      if (!isPlainObject(report)) {
        return invalidAdapterInput("toOutcomeEvent: report must be an object");
      }
      const issues: IssueList = [];
      checkId(report["purchaseId"], "purchaseId", issues);
      checkTimestamp(report["at"], "at", issues);
      checkId(report["productId"], "productId", issues);
      checkOptional(report["experienceId"], "experienceId", checkId, issues);
      checkOptional(report["decisionId"], "decisionId", checkId, issues);
      checkEnum(
        report["event"],
        "event",
        ["opened", "purchased", "order-completed", "cart-abandoned", "removed", "saved-for-later", "shared", "reviewed", "re-engaged"] as const,
        issues,
      );
      checkOptional(report["cartValue"], "cartValue", checkNonNegativeNumber, issues);
      checkOptional(report["orderValue"], "orderValue", checkNonNegativeNumber, issues);
      checkOptional(report["quantity"], "quantity", (v, p, list) => {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
          list.push({ path: p, message: "must be a positive integer" });
        }
      }, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid commerce purchase report", issues);
      }

      // Observation-channel law: only observed evidence classes are
      // accepted on the commerce reporting path (defense in depth for
      // callers that bypass the narrowed input type).
      const evidenceClass = options.evidenceClass;
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass)) {
        return unsupportedEvidenceClass(
          `toOutcomeEvent: evidenceClass ${String(evidenceClass)} is not an observed class; the commerce reporting channel maps observations only (${OBSERVED_EVIDENCE_CLASSES.join(", ")})`,
          [{ path: "options.evidenceClass", message: "must be an observed evidence class" }],
        );
      }
      const optionIssues: IssueList = [];
      if (!TenantScopeSchema.safeParse(options.tenant).success) {
        optionIssues.push({ path: "options.tenant", message: "must be a valid tenant scope" });
      }
      if (
        !isPlainObject(options.subject) ||
        typeof options.subject.kind !== "string" ||
        !["user", "audience", "account", "session"].includes(options.subject.kind) ||
        typeof options.subject.ref !== "string" ||
        options.subject.ref.length < 1
      ) {
        optionIssues.push({ path: "options.subject", message: "must be a subject reference { kind, ref }" });
      }
      if (options.contextId !== undefined) {
        checkId(options.contextId, "options.contextId", optionIssues);
      }
      if (optionIssues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid outcome options", optionIssues);
      }

      const eventType = COMMERCE_EVENT_TYPES[report.event];
      const metrics: Record<string, number> = {};
      if (report.cartValue !== undefined) metrics["cartValue"] = report.cartValue;
      if (report.orderValue !== undefined) metrics["orderValue"] = report.orderValue;
      if (report.quantity !== undefined) metrics["quantity"] = report.quantity;
      if (report.orderValue !== undefined && report.cartValue !== undefined && report.cartValue > 0) {
        metrics["orderShareOfCart"] = Math.round((report.orderValue / report.cartValue) * 10_000) / 10_000;
      }

      const eventId = deriveId("evt-", "commerce.outcome-event", {
        tenantId: options.tenant.tenantId,
        purchaseId: report.purchaseId,
        eventType,
        at: report.at,
      });
      const idempotencyKey = deriveId("evtkey-", "commerce.outcome-idempotency", {
        tenantId: options.tenant.tenantId,
        purchaseId: report.purchaseId,
        eventType,
      });

      const parsed = OutcomeEventSchema.safeParse({
        eventId,
        tenant: options.tenant,
        ...(report.decisionId !== undefined ? { decisionId: report.decisionId } : {}),
        ...(report.experienceId !== undefined ? { experienceId: report.experienceId } : {}),
        subject: options.subject,
        eventType,
        occurredAt: report.at,
        ...(options.contextId !== undefined ? { context: { contextId: options.contextId } } : {}),
        provenance: { system: "commerce-reporting", version: "1" },
        metrics,
        evidenceClass,
        idempotencyKey,
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toOutcomeEvent: constructed outcome event failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toPreferenceDeltas(outcome, item) {
      const outcomeParse = OutcomeEventSchema.safeParse(outcome);
      if (!outcomeParse.success) {
        return invalidAdapterInput("toPreferenceDeltas: outcome must be a valid OutcomeEvent", outcomeParse.error.issues.map((i) => ({ path: `outcome.${i.path.join(".")}`, message: i.message })));
      }
      const itemParse = CatalogItemSchema.safeParse(item);
      if (!itemParse.success) {
        return invalidAdapterInput("toPreferenceDeltas: item must be a valid CatalogItem", itemParse.error.issues.map((i) => ({ path: `item.${i.path.join(".")}`, message: i.message })));
      }
      const observed = outcomeParse.data;
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(observed.evidenceClass)) {
        return unsupportedEvidenceClass(
          `toPreferenceDeltas: runtime preference updates consume OBSERVED outcomes only; ${observed.evidenceClass} evidence is research-class (ADR-004)`,
          [{ path: "outcome.evidenceClass", message: "must be an observed evidence class" }],
        );
      }

      // Documented deterministic affinity rule (never fabricated):
      // purchase → +0.50 (confidence +0.60); completion → +0.25
      // (+0.20); abandonment → −0.10 (+0.10); skip → −0.05 (+0.05);
      // explicit-feedback → +0.50 (+0.60). Every other outcome type
      // carries no affinity evidence and maps to NO delta.
      let value: number | undefined;
      let confidenceDelta: number | undefined;
      switch (observed.eventType) {
        case "purchase":
          value = 0.5;
          confidenceDelta = 0.6;
          break;
        case "completion":
          value = 0.25;
          confidenceDelta = 0.2;
          break;
        case "abandonment":
          value = -0.1;
          confidenceDelta = 0.1;
          break;
        case "skip":
          value = -0.05;
          confidenceDelta = 0.05;
          break;
        case "explicit-feedback":
          value = 0.5;
          confidenceDelta = 0.6;
          break;
        default:
          value = undefined;
          confidenceDelta = undefined;
          break;
      }
      if (value === undefined || confidenceDelta === undefined) {
        return { ok: true, value: [] };
      }

      // Affinity applies to the product's mapped labels (kind +
      // categories), sorted and capped at 8 (deterministic).
      const labels = sortedUniqueLabels(itemParse.data.labels).slice(0, 8);
      const deltas: PreferenceDelta[] = [];
      for (const label of labels) {
        const dimension = `commerce.category-affinity:${label}`;
        const parsed = PreferenceDeltaSchema.safeParse({
          deltaId: deriveId("pd-", "commerce.preference-delta", {
            eventId: observed.eventId,
            dimension,
          }),
          tenant: observed.tenant,
          subject: observed.subject,
          dimension,
          op: "add",
          value,
          ...(observed.context !== undefined ? { scope: { contextId: observed.context.contextId } } : {}),
          confidenceDelta,
          provenance: { system: "commerce-adapter", version: "0.1.0" },
          decay: { halfLifeSeconds: 2_592_000 },
          model: { modelId: "commerce-affinity-v1", version: "1" },
          timestamp: observed.occurredAt,
        });
        if (!parsed.success) {
          return invalidAdapterInput(
            `toPreferenceDeltas: constructed delta for ${dimension} failed schema validation`,
            parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
          );
        }
        deltas.push(parsed.data);
      }
      return { ok: true, value: deltas };
    },
  };
}

/**
 * Deterministic digest helper exposed for evidence/proof tooling that
 * needs to fingerprint adapter inputs (research tooling only).
 */
export function commerceFixtureDigest(payload: unknown): string {
  return contentDigest(payload);
}
