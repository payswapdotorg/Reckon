/**
 * W3-008 — the advertising reference adapter.
 *
 * Proves the advertising vertical over the frozen normalized contracts
 * (docs/work-items/worker-3.md: creative → placement/format →
 * experience → show/defer/interrupt → outcome):
 *
 *   ad catalog (creatives, topics, flight windows, placements)
 *                             → `CatalogItem` + `Realization`
 *   campaign mix rows        → `CandidateSet`
 *   ad serving session       → `ContextSnapshot`
 *   campaign aim / mode      → `Objective` / `AttentionPolicy`
 *   host show/reserve/rotate/cut/wrap actions → scheduler action
 *   inputs (plan-state truth + `SwitchEvaluationInput` + host flags).
 *   The show/defer/interrupt decision points route through the
 *   EXISTING scheduler actions (HOLD/CONTINUE/QUEUE/SUGGEST/SWITCH/
 *   INTERRUPT/RESUME/END) — no parallel scheduling path is invented:
 *     show   → QUEUE/SUGGEST from the scheduler + host-authoritative
 *              "show" start (plan-state truth);
 *     defer  → CONTINUE/HOLD verdicts (weak rotation numbers never
 *              interrupt; SEPARATION LAW);
 *     interrupt → SWITCH (caller-supplied rotation numbers) or
 *              INTERRUPT (host "cut" request), both with resume
 *              checkpoints; RESUME returns to the interrupted spot.
 *   ad server serving reports → `OutcomeEvent`s with an OBSERVED
 *   evidence class
 *   observed outcomes         → `PreferenceDelta`s (deterministic
 *   documented topic-affinity rule; impressions carry NO affinity
 *   evidence — delivery is not audience interest, never fabricated)
 *
 * LAWS enforced here (structural peer of W3-005/W3-006/W3-007):
 * - HOST-BOUNDARY LAW: the adapter NEVER imports host-internal
 *   persistence — every ad-shaped value enters through interface types
 *   declared in THIS package (plain data in, contract records out).
 *   The only imports are the frozen contracts, type-only
 *   scheduler/experience seams and local modules.
 * - HOST-AUTHORITY LAW: identity, consent, catalog authoring, rights,
 *   provider access, delivery, campaign policy and payment remain the
 *   host ad system's. The adapter passes host policy tags through; it
 *   never verifies brand safety, never enforces frequency caps or
 *   pacing and never bills.
 * - NO CORE RANKING LOGIC here (forbidden dependency direction): the
 *   adapter maps data; decisions come from the W2 kernels. The only
 *   host policy it implements is the injected objective-fit function
 *   (documented deterministic topic-affinity overlap).
 * - EVIDENCE LAW: serving reports are an OBSERVATION channel — only
 *   observed evidence classes are accepted; simulated/counterfactual/
 *   fixture classes are typed errors (architecture-lock #20).
 * - Determinism: same input ⇒ byte-identical output. Derived ids use
 *   canonical content digests; no clocks, no randomness, no network.
 * - Fixture-only: no live ad system has been contacted. See
 *   ADVERTISING_ADAPTER_DECLARATION.liveVerification.
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

/** An ad surface a creative can be served on. */
export type AdSurface = "in-stream" | "banner-slot" | "feed-slot" | "interstitial-gate";

/** A placement the ad host declares for one creative (becomes a Realization). */
export interface AdPlacement {
  /** Host placement id (becomes the Realization id). */
  placementId: string;
  surface: AdSurface;
  /** Primary serving locale (optional, BCP-47). */
  locale?: string;
  /** Host-declared maximum spot length in seconds. */
  maxDurationSeconds?: number;
  /** Host-declared whether the spot can be cut short by the viewer. */
  skippable: boolean;
  /** Additional cut-downs this placement can serve beyond its base format. */
  alternateCuts?: ("clip" | "card")[];
}

/** An ad catalog creative (host shape). */
export interface AdCreative {
  creativeId: string;
  name: string;
  creativeKind: "video-spot" | "display-banner" | "sponsored-listing" | "audio-spot";
  topics: string[];
  flightStartsAt?: number;
  flightEndsAt?: number;
  /** Host-declared policy/brand-safety tags (pass-through, never verified). */
  policyTags: string[];
  placements: AdPlacement[];
}

/** One ad catalog export batch (all-or-nothing import). */
export interface AdCatalogImport {
  adServer: string;
  exportedAt: number;
  creatives: AdCreative[];
}

/** One campaign mix row. */
export interface CampaignMixRow {
  creativeId: string;
  /** 1-based rank in the host mix (retrieval hint, never a decision). */
  rank: number;
  note?: string;
}

/** A campaign mix snapshot (host retrieval shape). */
export interface CampaignMixFeed {
  feedId: string;
  mixer: string;
  rows: CampaignMixRow[];
}

/** An ad serving session snapshot (host context shape). */
export interface AdServingSession {
  viewerId: string;
  sessionId: string;
  at: number;
  device: "connected-tv" | "phone" | "desktop";
  networkKind: "wifi" | "cellular" | "offline";
  /** 24h "HH:MM" local time at the host. */
  localTime: string;
  timezone: string;
  minutesAvailable?: number;
  recentAdBreaks?: number;
  midBreak?: boolean;
}

/** A campaign aim (host-declared objective). */
export interface CampaignAim {
  aim: "awareness" | "consideration" | "conversion" | "re-engage";
  /** Declared targeting topics (host policy input for objective fit). */
  targetingTopics: string[];
}

/** An ad delivery mode (host-declared attention policy). */
export type AdDeliveryMode = "light" | "standard" | "blitz";

/** Caller-supplied rotation numbers (SEPARATION LAW: every number is host-supplied). */
export interface RotationNumbers {
  fromExperienceId: string;
  toExperienceId: string;
  expectedImprovement: number;
  interruptionCost: number;
  uncertaintyPenalty: number;
  resumeLoss: number;
  switchThreshold: number;
  suggestThreshold: number;
}

/** An ad host action (serving/slot intent). */
export type AdHostAction =
  | { kind: "show"; experienceId: string }
  | { kind: "reserve"; experienceIds: string[] }
  | { kind: "rotate"; numbers: RotationNumbers }
  | { kind: "cut"; experienceId: string; resumeToken?: string }
  | { kind: "wrap" };

/** An ad server serving report (host OBSERVATION channel). */
export interface AdServingReport {
  impressionId: string;
  at: number;
  creativeId: string;
  /** Present when the serving came from a Reckon decision. */
  experienceId?: string;
  decisionId?: string;
  event:
    | "rendered"
    | "spot-started"
    | "viewed-through"
    | "left"
    | "skipped"
    | "clicked"
    | "dismissed"
    | "saved"
    | "shared"
    | "praised";
  /** Host-declared seconds of the spot actually viewed. */
  viewSeconds?: number;
  /** Host-declared total spot length in seconds. */
  totalSeconds?: number;
}

/** Options for mapping a serving report to an outcome event. */
export interface AdOutcomeOptions {
  tenant: TenantScope;
  subject: SubjectReference;
  /**
   * Host-declared class of the observation channel. Serving reports
   * are observations: only observed evidence classes are accepted
   * ("production-observed" | "staging" | "controlled-local").
   * Simulated/counterfactual/fixture classes are typed errors.
   */
  evidenceClass: ObservedEvidenceClass;
  contextId?: Id;
}

// ---------------------------------------------------------------------------
// Adapter declaration (typed constant — fixture-only, host-authoritative)
// ---------------------------------------------------------------------------

export const ADVERTISING_ADAPTER_DECLARATION: AdapterDeclaration = {
  adapterId: "advertising-reference-adapter",
  domain: "advertising",
  contractVersion: "0.1.0",
  supportedCapabilities: [
    "catalog-import", // ad catalog export → CatalogItem + Realization
    "retrieval-mapping", // campaign mix → CandidateSet
    "context-mapping", // serving session → ContextSnapshot
    "objective-mapping", // campaign aim → Objective
    "attention-policy-mapping", // delivery mode → AttentionPolicy
    "objective-fit-host-policy", // deterministic topic-affinity fit function
    "scheduler-intent-mapping", // show/reserve/rotate/cut/wrap → scheduler inputs
    "serving-outcome-mapping", // serving reports → OutcomeEvent (observed class only)
    "preference-delta-mapping", // observed outcomes → PreferenceDelta
  ],
  unsupportedCapabilities: [
    "identity", // host-authoritative
    "consent-management", // host-authoritative
    "rights-verification", // policy tags are pass-through only; host gates verify
    "catalog-authoring", // the adapter maps host ad catalog truth; it never authors it
    "provider-access", // ad-exchange/provider authorization stays host-side
    "creative-delivery", // the host ad server delivers; the adapter never does
    "campaign-policy", // pacing, frequency caps and brand safety stay host-authoritative
    "payment", // host billing/settlement owns payment; the adapter never touches it
    "live-provider-calls", // fixture-only: the adapter performs no network calls
  ],
  authorizationRequirements: [
    {
      resource: "ad-catalog-export",
      requirement: "Host-issued service credential with campaign read scope; the adapter receives already-authorized export batches",
      enforcedBy: "host",
    },
    {
      resource: "ad-serving-telemetry",
      requirement: "Host ad serving telemetry consent for the reporting subject (host consent system)",
      enforcedBy: "host",
    },
    {
      resource: "ad-policy-gates",
      requirement: "Host brand-safety/rights/frequency gates pass before any delivery; the adapter only passes policyTags through",
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
    note: "No live advertising provider has been contacted. All mapping evidence is fixture evidence; a live path additionally requires real authorization, observed output, measured latency and failure behavior (AGENTS.md production truth).",
  },
  provenance: {
    dataOwnership: "host",
    catalogSource: "Host ad catalog export batches (adapter input; never host persistence)",
    rightsSource: "Host campaign policy service — host-declared policyTags pass through unverified",
    deliverySource: "Host ad server (host delivery authority)",
    identitySource: "Host identity system (host viewer ids)",
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

/** The base contract format each surface delivers (first formats entry). */
const AD_SURFACE_BASE_FORMAT: Record<AdSurface, "full" | "banner" | "in-feed" | "interstitial"> = {
  "in-stream": "full",
  "banner-slot": "banner",
  "feed-slot": "in-feed",
  "interstitial-gate": "interstitial",
};

const AD_SURFACE_DEVICES: Record<AdSurface, string[]> = {
  "in-stream": ["tv", "desktop", "phone"],
  "banner-slot": ["desktop", "phone", "tablet"],
  "feed-slot": ["phone", "desktop"],
  "interstitial-gate": ["phone", "desktop"],
};

const AD_SURFACE_BANDWIDTH: Record<AdSurface, "low" | "medium" | "high"> = {
  "in-stream": "medium",
  "banner-slot": "low",
  "feed-slot": "low",
  "interstitial-gate": "medium",
};

const AD_DEVICE_CLASS: Record<AdServingSession["device"], "tv" | "desktop" | "phone"> = {
  "connected-tv": "tv",
  phone: "phone",
  desktop: "desktop",
};

const AD_EVENT_TYPES: Record<AdServingReport["event"], OutcomeEvent["eventType"]> = {
  rendered: "impression",
  "spot-started": "start",
  "viewed-through": "completion",
  left: "abandonment",
  skipped: "skip",
  clicked: "conversion",
  dismissed: "interruption-reject",
  saved: "save",
  shared: "share",
  praised: "explicit-feedback",
};

const CAMPAIGN_AIM_KIND: Record<CampaignAim["aim"], Objective["kind"]> = {
  awareness: "discover",
  consideration: "compare",
  conversion: "complete-task",
  "re-engage": "catch-up",
};

const AD_MODE_POLICY: Record<AdDeliveryMode, AttentionPolicy["style"]> = {
  light: "mindful",
  standard: "balanced",
  blitz: "immersive",
};

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/** The advertising reference adapter (pure deterministic mapper). */
export interface AdvertisingAdapter {
  readonly declaration: AdapterDeclaration;

  /** Ad catalog export → Reckon CatalogItem + Realization records. */
  importCatalog(input: AdCatalogImport): AdapterResult<{ items: CatalogItem[]; realizations: Realization[] }>;

  /** Campaign mix feed → Reckon CandidateSet. */
  toCandidateSet(feed: CampaignMixFeed): AdapterResult<CandidateSet>;

  /** Ad serving session → Reckon ContextSnapshot. */
  toContextSnapshot(session: AdServingSession): AdapterResult<ContextSnapshot>;

  /** Campaign aim → Reckon Objective. */
  toObjective(aim: CampaignAim): AdapterResult<Objective>;

  /** Ad delivery mode → Reckon AttentionPolicy. */
  toAttentionPolicy(mode: AdDeliveryMode): AdapterResult<AttentionPolicy>;

  /**
   * Deterministic host objective-fit policy: overlap between the
   * creative's mapped labels and the aim's declared targeting topics,
   * divided by the number of declared topics (0 when none declared —
   * never fabricated). Pure port implementation for the expander.
   */
  toObjectiveFit(items: CatalogItem[]): ObjectiveFitFn;

  /** Host show/reserve/rotate/cut/wrap → scheduler action inputs. */
  toSchedulerIntents(action: AdHostAction, currentState: PlanState): AdapterResult<HostSchedulerIntents>;

  /** Serving report → OutcomeEvent with an OBSERVED evidence class. */
  toOutcomeEvent(report: AdServingReport, options: AdOutcomeOptions): AdapterResult<OutcomeEvent>;

  /**
   * Observed outcome + catalog creative → deterministic
   * topic-affinity PreferenceDeltas (empty for outcome types that
   * carry no affinity evidence — an impression proves delivery, not
   * audience interest; documented rule, never fabricated).
   */
  toPreferenceDeltas(outcome: OutcomeEvent, item: CatalogItem): AdapterResult<PreferenceDelta[]>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validatePlacement(
  raw: unknown,
  path: string,
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a placement object" });
    return;
  }
  checkId(raw["placementId"], `${path}.placementId`, issues);
  checkEnum(raw["surface"], `${path}.surface`, ["in-stream", "banner-slot", "feed-slot", "interstitial-gate"] as const, issues);
  checkOptionalLocale(raw["locale"], `${path}.locale`, issues);
  checkOptional(raw["maxDurationSeconds"], `${path}.maxDurationSeconds`, checkNonNegativeNumber, issues);
  checkOptionalBoolean(raw["skippable"], `${path}.skippable`, issues);
  checkEnumArray(raw["alternateCuts"], `${path}.alternateCuts`, ["clip", "card"] as const, issues);
  const cuts = raw["alternateCuts"];
  if (Array.isArray(cuts) && cuts.length > 2) {
    issues.push({ path: `${path}.alternateCuts`, message: "must contain at most 2 alternate cuts" });
  }
}

function validateCreative(
  raw: unknown,
  path: string,
  limits: AdapterDeclaration["limits"],
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a creative object" });
    return;
  }
  checkId(raw["creativeId"], `${path}.creativeId`, issues);
  checkString(raw["name"], `${path}.name`, 1, 512, issues);
  checkEnum(raw["creativeKind"], `${path}.creativeKind`, ["video-spot", "display-banner", "sponsored-listing", "audio-spot"] as const, issues);
  checkStringArray(raw["topics"], `${path}.topics`, 1, 16, 1, 64, issues);
  checkOptional(raw["flightStartsAt"], `${path}.flightStartsAt`, checkTimestamp, issues);
  checkOptional(raw["flightEndsAt"], `${path}.flightEndsAt`, checkTimestamp, issues);
  checkStringArray(raw["policyTags"], `${path}.policyTags`, 0, 16, 1, 64, issues);
  const placements = raw["placements"];
  if (!Array.isArray(placements) || placements.length === 0) {
    issues.push({ path: `${path}.placements`, message: "must be a non-empty array of placements" });
  } else {
    if (placements.length > limits.maxRealizationsPerItem) {
      issues.push({
        path: `${path}.placements`,
        message: `creative declares ${placements.length} placements; limit is ${limits.maxRealizationsPerItem}`,
      });
    }
    placements.forEach((placement, index) => {
      validatePlacement(placement, `${path}.placements[${index}]`, issues);
    });
  }
  const starts = raw["flightStartsAt"];
  const ends = raw["flightEndsAt"];
  if (
    typeof starts === "number" && typeof ends === "number" &&
    Number.isInteger(starts) && Number.isInteger(ends) && ends <= starts
  ) {
    issues.push({ path: `${path}.flightEndsAt`, message: "must be greater than flightStartsAt" });
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Create the advertising reference adapter (stateless, pure). */
export function createAdvertisingAdapter(): AdvertisingAdapter {
  const declaration = ADVERTISING_ADAPTER_DECLARATION;

  return {
    declaration,

    importCatalog(input) {
      if (!isPlainObject(input)) {
        return invalidAdapterInput("importCatalog: input must be an object");
      }
      const issues: IssueList = [];
      checkString(input["adServer"], "adServer", 1, 64, issues);
      checkTimestamp(input["exportedAt"], "exportedAt", issues);
      const rawCreatives = input["creatives"];
      if (!Array.isArray(rawCreatives) || rawCreatives.length === 0) {
        issues.push({ path: "creatives", message: "must be a non-empty array of creatives" });
      } else if (rawCreatives.length > declaration.limits.maxItemsPerImport) {
        return limitExceeded(
          `importCatalog: ${rawCreatives.length} creatives exceed the import limit of ${declaration.limits.maxItemsPerImport}`,
        );
      } else {
        rawCreatives.forEach((creative, index) => {
          validateCreative(creative, `creatives[${index}]`, declaration.limits, issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("importCatalog: invalid ad catalog import", issues);
      }

      const creatives = rawCreatives as AdCreative[];
      // All-or-nothing duplicate detection (deterministic).
      const seenCreatives = new Set<string>();
      const seenPlacements = new Set<string>();
      for (const creative of creatives) {
        if (seenCreatives.has(creative.creativeId)) {
          return invalidAdapterInput(`importCatalog: duplicate creativeId ${creative.creativeId} (all-or-nothing import)`);
        }
        seenCreatives.add(creative.creativeId);
        for (const placement of creative.placements) {
          if (seenPlacements.has(placement.placementId)) {
            return invalidAdapterInput(
              `importCatalog: duplicate placementId ${placement.placementId} (realization ids must be unique per import)`,
            );
          }
          seenPlacements.add(placement.placementId);
        }
      }

      const catalogItems: CatalogItem[] = [];
      const realizations: Realization[] = [];
      for (const creative of creatives) {
        const parsedItem = CatalogItemSchema.safeParse({
          itemId: creative.creativeId,
          kind: "advertising",
          labels: sortedUniqueLabels([creative.creativeKind, ...creative.topics]),
          attributes: {
            name: creative.name,
            creativeKind: creative.creativeKind,
            policyTags: [...creative.policyTags],
          },
          ...(creative.flightStartsAt !== undefined ? { availableFrom: creative.flightStartsAt } : {}),
          ...(creative.flightEndsAt !== undefined ? { availableUntil: creative.flightEndsAt } : {}),
        });
        if (!parsedItem.success) {
          return invalidAdapterInput(
            `importCatalog: constructed catalog item for ${creative.creativeId} failed schema validation`,
            parsedItem.error.issues.map((i) => ({ path: `items.${creative.creativeId}.${i.path.join(".")}`, message: i.message })),
          );
        }
        catalogItems.push(parsedItem.data);

        for (const placement of creative.placements) {
          // Base format first (the expander treats entry 0 as the base
          // format), then the declared cut-downs — deduplicated.
          const formats = [AD_SURFACE_BASE_FORMAT[placement.surface], ...(placement.alternateCuts ?? [])]
            .filter((format, index, all) => all.indexOf(format) === index);
          const parsedRealization = RealizationSchema.safeParse({
            realizationId: placement.placementId,
            itemId: creative.creativeId,
            kind: placement.surface,
            ...(placement.locale !== undefined ? { locale: placement.locale } : {}),
            constraints: {
              formats,
              ...(placement.maxDurationSeconds !== undefined ? { durationSeconds: placement.maxDurationSeconds } : {}),
              deviceClasses: [...AD_SURFACE_DEVICES[placement.surface]],
              requiresScreen: true,
              requiresAudio: placement.surface === "in-stream",
              minBandwidth: AD_SURFACE_BANDWIDTH[placement.surface],
              skippable: placement.skippable,
            },
          });
          if (!parsedRealization.success) {
            return invalidAdapterInput(
              `importCatalog: constructed realization for ${placement.placementId} failed schema validation`,
              parsedRealization.error.issues.map((i) => ({ path: `realizations.${placement.placementId}.${i.path.join(".")}`, message: i.message })),
            );
          }
          realizations.push(parsedRealization.data);
        }
      }

      return { ok: true, value: { items: catalogItems, realizations } };
    },

    toCandidateSet(feed) {
      if (!isPlainObject(feed)) {
        return invalidAdapterInput("toCandidateSet: input must be an object");
      }
      const issues: IssueList = [];
      checkId(feed["feedId"], "feedId", issues);
      checkString(feed["mixer"], "mixer", 1, 64, issues);
      const rows = feed["rows"];
      if (!Array.isArray(rows) || rows.length === 0) {
        issues.push({ path: "rows", message: "must be a non-empty array of campaign mix rows" });
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
          checkId(row["creativeId"], `rows[${index}].creativeId`, issues);
          const rank = row["rank"];
          if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
            issues.push({ path: `rows[${index}].rank`, message: "must be a positive integer 1-based rank" });
          }
          checkOptional(row["note"], `rows[${index}].note`, (v, p, list) => checkString(v, p, 1, 256, list), issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("toCandidateSet: invalid campaign mix feed", issues);
      }

      const parsed = CandidateSetSchema.safeParse({
        setId: feed.feedId,
        candidates: feed.rows.map((row) => ({
          itemId: row.creativeId,
          realizationIds: [],
          source: feed.mixer,
          rankHint: row.rank,
        })),
        provenance: {
          system: feed.mixer,
          correlationId: feed.feedId,
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
      checkString(session["viewerId"], "viewerId", 1, 512, issues);
      checkId(session["sessionId"], "sessionId", issues);
      checkTimestamp(session["at"], "at", issues);
      checkEnum(session["device"], "device", ["connected-tv", "phone", "desktop"] as const, issues);
      checkEnum(session["networkKind"], "networkKind", ["wifi", "cellular", "offline"] as const, issues);
      checkLocalTime(session["localTime"], "localTime", issues);
      checkString(session["timezone"], "timezone", 1, 64, issues);
      checkOptional(session["minutesAvailable"], "minutesAvailable", checkNonNegativeNumber, issues);
      checkOptional(session["recentAdBreaks"], "recentAdBreaks", (v, p, list) => {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          list.push({ path: p, message: "must be a non-negative integer" });
        }
      }, issues);
      checkOptionalBoolean(session["midBreak"], "midBreak", issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toContextSnapshot: invalid ad serving session", issues);
      }

      const parsed = ContextSnapshotSchema.safeParse({
        contextId: session.sessionId,
        at: session.at,
        time: {
          localTime: session.localTime,
          timezone: session.timezone,
          dayPart: dayPartOf(session.localTime),
        },
        device: { class: AD_DEVICE_CLASS[session.device] },
        network: { class: session.networkKind },
        activity: session.midBreak === true ? ["mid-break"] : [],
        ...(session.minutesAvailable !== undefined
          ? { attention: { availableMs: Math.round(session.minutesAvailable * 60_000) } }
          : {}),
        ...(session.recentAdBreaks !== undefined
          ? { fatigue: { recentInterruptions: session.recentAdBreaks } }
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

    toObjective(aim) {
      if (!isPlainObject(aim)) {
        return invalidAdapterInput("toObjective: input must be an object");
      }
      const issues: IssueList = [];
      checkEnum(aim["aim"], "aim", ["awareness", "consideration", "conversion", "re-engage"] as const, issues);
      checkStringArray(aim["targetingTopics"], "targetingTopics", 0, 16, 1, 64, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toObjective: invalid campaign aim", issues);
      }
      const parsed = ObjectiveSchema.safeParse({
        objectiveId: `ad-goal-${aim.aim}`,
        kind: CAMPAIGN_AIM_KIND[aim.aim],
        params: { targetingTopics: [...aim.targetingTopics] },
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
      const mapped = checkEnum(mode, "mode", ["light", "standard", "blitz"] as const, issues);
      if (issues.length > 0 || mapped === undefined) {
        return invalidAdapterInput("toAttentionPolicy: invalid ad delivery mode", issues);
      }
      const parsed = AttentionPolicySchema.safeParse({
        policyId: `ad-attention-${mapped}`,
        style: AD_MODE_POLICY[mapped],
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
        const targeting = objective.params?.["targetingTopics"];
        if (!Array.isArray(targeting) || targeting.length === 0 || targeting.some((t) => typeof t !== "string")) {
          return 0; // no declared targeting evidence — never fabricated
        }
        const labels = labelsByItem.get(experience.itemId);
        if (labels === undefined) return 0;
        let hits = 0;
        for (const topic of targeting) {
          if (labels.has(topic)) hits += 1;
        }
        return hits / targeting.length;
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
      const kind = checkEnum(raw["kind"], "kind", ["show", "reserve", "rotate", "cut", "wrap"] as const, issues);
      if (kind === "show") {
        checkId(raw["experienceId"], "experienceId", issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid show action", issues);
        const show = raw as unknown as { kind: "show"; experienceId: string };
        const transition = hostStartTransition(currentState, show.experienceId);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "reserve") {
        checkStringArray(raw["experienceIds"], "experienceIds", 1, 16, 1, 128, issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid reserve action", issues);
        const reserve = raw as unknown as { kind: "reserve"; experienceIds: string[] };
        const transition = hostEnqueueTransition(currentState, reserve.experienceIds);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "rotate") {
        const numbersRaw = raw["numbers"];
        if (!isPlainObject(numbersRaw)) {
          return invalidAdapterInput("toSchedulerIntents: rotate action requires a numbers object");
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
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid rotate numbers", issues);
        const numbers = numbersRaw as unknown as RotationNumbers;
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
      if (kind === "cut") {
        checkId(raw["experienceId"], "experienceId", issues);
        checkOptional(raw["resumeToken"], "resumeToken", (v, p, list) => checkString(v, p, 1, 1024, list), issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid cut action", issues);
        const cut = raw as unknown as { kind: "cut"; experienceId: string; resumeToken?: string };
        return {
          ok: true,
          value: {
            interruptRequested: true,
            ...(cut.resumeToken !== undefined
              ? { resumeTokens: { [cut.experienceId]: cut.resumeToken } }
              : {}),
          },
        };
      }
      if (kind === "wrap") {
        return { ok: true, value: { endRequested: true } };
      }
      return invalidAdapterInput("toSchedulerIntents: action kind must be show, reserve, rotate, cut or wrap", issues);
    },

    toOutcomeEvent(report, options) {
      if (!isPlainObject(report)) {
        return invalidAdapterInput("toOutcomeEvent: report must be an object");
      }
      const issues: IssueList = [];
      checkId(report["impressionId"], "impressionId", issues);
      checkTimestamp(report["at"], "at", issues);
      checkId(report["creativeId"], "creativeId", issues);
      checkOptional(report["experienceId"], "experienceId", checkId, issues);
      checkOptional(report["decisionId"], "decisionId", checkId, issues);
      checkEnum(
        report["event"],
        "event",
        ["rendered", "spot-started", "viewed-through", "left", "skipped", "clicked", "dismissed", "saved", "shared", "praised"] as const,
        issues,
      );
      checkOptional(report["viewSeconds"], "viewSeconds", checkNonNegativeNumber, issues);
      checkOptional(report["totalSeconds"], "totalSeconds", checkNonNegativeNumber, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid ad serving report", issues);
      }

      // Observation-channel law: only observed evidence classes are
      // accepted on the serving report path (defense in depth for
      // callers that bypass the narrowed input type).
      const evidenceClass = options.evidenceClass;
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass)) {
        return unsupportedEvidenceClass(
          `toOutcomeEvent: evidenceClass ${String(evidenceClass)} is not an observed class; the ad serving report channel maps observations only (${OBSERVED_EVIDENCE_CLASSES.join(", ")})`,
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

      const eventType = AD_EVENT_TYPES[report.event];
      const metrics: Record<string, number> = {};
      if (report.viewSeconds !== undefined) metrics["viewSeconds"] = report.viewSeconds;
      if (report.totalSeconds !== undefined) metrics["totalSeconds"] = report.totalSeconds;
      if (report.viewSeconds !== undefined && report.totalSeconds !== undefined && report.totalSeconds > 0) {
        metrics["viewThroughRatio"] = Math.round((report.viewSeconds / report.totalSeconds) * 10_000) / 10_000;
      }

      const eventId = deriveId("evt-", "advertising.outcome-event", {
        tenantId: options.tenant.tenantId,
        impressionId: report.impressionId,
        eventType,
        at: report.at,
      });
      const idempotencyKey = deriveId("evtkey-", "advertising.outcome-idempotency", {
        tenantId: options.tenant.tenantId,
        impressionId: report.impressionId,
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
        provenance: { system: "ad-serving", version: "1" },
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
      // completion → +0.25 (confidence +0.20); conversion → +0.50
      // (+0.60); explicit-feedback → +0.50 (+0.60); skip → −0.05
      // (+0.05); abandonment → −0.10 (+0.10). An impression proves
      // DELIVERY, not audience interest — it carries no affinity
      // evidence and maps to NO delta. Every other outcome type also
      // maps to NO delta.
      let value: number | undefined;
      let confidenceDelta: number | undefined;
      switch (observed.eventType) {
        case "completion":
          value = 0.25;
          confidenceDelta = 0.2;
          break;
        case "conversion":
          value = 0.5;
          confidenceDelta = 0.6;
          break;
        case "explicit-feedback":
          value = 0.5;
          confidenceDelta = 0.6;
          break;
        case "skip":
          value = -0.05;
          confidenceDelta = 0.05;
          break;
        case "abandonment":
          value = -0.1;
          confidenceDelta = 0.1;
          break;
        default:
          value = undefined;
          confidenceDelta = undefined;
          break;
      }
      if (value === undefined || confidenceDelta === undefined) {
        return { ok: true, value: [] };
      }

      // Affinity applies to the creative's mapped labels (kind +
      // topics), sorted and capped at 8 (deterministic).
      const labels = sortedUniqueLabels(itemParse.data.labels).slice(0, 8);
      const deltas: PreferenceDelta[] = [];
      for (const label of labels) {
        const dimension = `advertising.topic-affinity:${label}`;
        const parsed = PreferenceDeltaSchema.safeParse({
          deltaId: deriveId("pd-", "advertising.preference-delta", {
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
          provenance: { system: "advertising-adapter", version: "0.1.0" },
          decay: { halfLifeSeconds: 2_592_000 },
          model: { modelId: "advertising-affinity-v1", version: "1" },
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
export function advertisingFixtureDigest(payload: unknown): string {
  return contentDigest(payload);
}
