/**
 * W3-005 — the WebFlix reference adapter.
 *
 * WebFlix is the first intended real consumer of Reckon
 * (docs/work-items/worker-3.md). This adapter maps WebFlix-SHAPED host
 * data into the frozen normalized contracts:
 *
 *   WebFlix catalog (titles, genres, availability windows, playback
 *   options)            → `CatalogItem` + `Realization`
 *   WebFlix recommender feed rows → `CandidateSet`
 *   WebFlix viewing session        → `ContextSnapshot`
 *   WebFlix viewing goal/style     → `Objective` / `AttentionPolicy`
 *   host play/queue/switch/interrupt/end actions → scheduler action
 *   inputs (plan-state truth + `SwitchEvaluationInput` + host flags)
 *   WebFlix player playback reports → `OutcomeEvent`s with an
 *   OBSERVED evidence class
 *   observed outcomes               → `PreferenceDelta`s (deterministic
 *   documented affinity rule)
 *
 * LAWS enforced here:
 * - HOST-BOUNDARY LAW: the adapter NEVER imports WebFlix internal
 *   persistence — every WebFlix-shaped value enters through interface
 *   types declared in THIS package (plain data in, contract records
 *   out). The only imports are the frozen contracts, type-only
 *   scheduler/experience seams and local modules.
 * - HOST-AUTHORITY LAW: identity, consent, catalog authoring, rights,
 *   delivery and payment remain WebFlix's. The adapter passes host
 *   rights tags through; it never verifies rights.
 * - NO CORE RANKING LOGIC here (forbidden dependency direction): the
 *   adapter maps data; decisions come from the W2 kernels. The only
 *   host policy it implements is the injected objective-fit function
 *   (documented deterministic genre-affinity overlap).
 * - EVIDENCE LAW: playback reports are an OBSERVATION channel — only
 *   observed evidence classes are accepted; simulated/counterfactual/
 *   fixture classes are typed errors (architecture-lock #20).
 * - Determinism: same input ⇒ byte-identical output. Derived ids use
 *   canonical content digests; no clocks, no randomness, no network.
 * - Fixture-only: no live WebFlix system has been contacted. See
 *   WEBFLIX_ADAPTER_DECLARATION.liveVerification.
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

/** A delivery capability WebFlix declares for one media item. */
export interface WebFlixPlaybackOption {
  /** WebFlix playback option id (becomes the Realization id). */
  optionId: string;
  surface: "tv-app" | "web-player" | "mobile-app" | "download";
  /** Primary delivery locale (optional, BCP-47). */
  locale?: string;
  maxResolution: "480p" | "720p" | "1080p" | "4k";
  /** Audio tracks offered by this option. */
  audioTracks: string[];
  /** Host-declared estimated duration (seconds). */
  durationSeconds?: number;
  downloadable: boolean;
  offlineEligible: boolean;
  /** Additional formats this option can deliver (base "full" is implicit). */
  variants?: ("clip" | "subtitled" | "dubbed" | "audio-only")[];
}

/** A WebFlix catalog media item (host shape). */
export interface WebFlixMediaItem {
  mediaId: string;
  title: string;
  mediaType: "movie" | "series" | "documentary" | "short";
  genres: string[];
  availableFrom?: number;
  availableUntil?: number;
  /** Host-declared rights/entitlement tags (pass-through, never verified). */
  rightsTags: string[];
  playbacks: WebFlixPlaybackOption[];
}

/** One WebFlix catalog export batch (all-or-nothing import). */
export interface WebFlixCatalogImport {
  source: string;
  exportedAt: number;
  items: WebFlixMediaItem[];
}

/** One WebFlix recommender row. */
export interface WebFlixRetrievalRow {
  mediaId: string;
  /** 1-based rank in the WebFlix feed (host retrieval hint, never a decision). */
  rank: number;
  reason?: string;
}

/** A WebFlix recommendation feed snapshot. */
export interface WebFlixRecommendationFeed {
  feedId: string;
  source: string;
  rows: WebFlixRetrievalRow[];
}

/** A WebFlix viewing session snapshot (host context shape). */
export interface WebFlixViewingSession {
  profileId: string;
  sessionId: string;
  at: number;
  deviceKind: "living-room-tv" | "web" | "phone" | "tablet";
  networkKind: "wifi" | "cellular" | "offline";
  /** 24h "HH:MM" local time at the host. */
  localTime: string;
  timezone: string;
  minutesAvailable?: number;
  recentInterruptions?: number;
  continuing?: boolean;
}

/** A WebFlix viewing goal (host-declared objective). */
export interface WebFlixViewingGoal {
  goal: "discover" | "catch-up" | "relax" | "stay-informed";
  /** Declared taste genres (host policy input for objective fit). */
  tasteGenres: string[];
}

/** A WebFlix viewing style (host-declared attention policy). */
export type WebFlixViewingStyle = "mindful" | "balanced" | "lean-back";

/** Caller-supplied switch numbers (SEPARATION LAW: every number is host-supplied). */
export interface WebFlixSwitchNumbers {
  fromExperienceId: string;
  toExperienceId: string;
  expectedImprovement: number;
  interruptionCost: number;
  uncertaintyPenalty: number;
  resumeLoss: number;
  switchThreshold: number;
  suggestThreshold: number;
}

/** A WebFlix host action (player/queue/UI intent). */
export type WebFlixHostAction =
  | { kind: "play"; experienceId: string }
  | { kind: "queue"; experienceIds: string[] }
  | { kind: "switch"; numbers: WebFlixSwitchNumbers }
  | { kind: "interrupt"; experienceId: string; resumeToken?: string }
  | { kind: "end" };

/** A WebFlix player playback report (host OBSERVATION channel). */
export interface WebFlixPlaybackReport {
  playbackId: string;
  at: number;
  mediaId: string;
  /** Present when the playback came from a Reckon decision. */
  experienceId?: string;
  decisionId?: string;
  event:
    | "started"
    | "completed"
    | "abandoned"
    | "skipped"
    | "seeked"
    | "resumed"
    | "liked"
    | "shared"
    | "saved";
  positionSeconds?: number;
  totalSeconds?: number;
}

/** Options for mapping a playback report to an outcome event. */
export interface WebFlixOutcomeOptions {
  tenant: TenantScope;
  subject: SubjectReference;
  /**
   * Host-declared class of the observation channel. The player channel
   * is an OBSERVATION channel: only observed evidence classes are
   * accepted ("production-observed" | "staging" | "controlled-local").
   * Simulated/counterfactual/fixture classes are typed errors.
   */
  evidenceClass: ObservedEvidenceClass;
  contextId?: Id;
}

// ---------------------------------------------------------------------------
// Adapter declaration (typed constant — fixture-only, host-authoritative)
// ---------------------------------------------------------------------------

export const WEBFLIX_ADAPTER_DECLARATION: AdapterDeclaration = {
  adapterId: "webflix-reference-adapter",
  domain: "media",
  contractVersion: "0.1.0",
  supportedCapabilities: [
    "catalog-import", // WebFlix catalog export → CatalogItem + Realization
    "retrieval-mapping", // recommender feed → CandidateSet
    "context-mapping", // viewing session → ContextSnapshot
    "objective-mapping", // viewing goal → Objective
    "attention-policy-mapping", // viewing style → AttentionPolicy
    "objective-fit-host-policy", // deterministic genre-affinity fit function
    "scheduler-intent-mapping", // host play/queue/switch/interrupt/end → scheduler inputs
    "playback-outcome-mapping", // player reports → OutcomeEvent (observed class only)
    "preference-delta-mapping", // observed outcomes → PreferenceDelta
  ],
  unsupportedCapabilities: [
    "identity", // host-authoritative
    "consent-management", // host-authoritative
    "rights-verification", // rights tags are pass-through only; WebFlix verifies rights
    "catalog-authoring", // the adapter maps host catalog truth; it never authors it
    "content-delivery", // the WebFlix player delivers; the adapter never does
    "payment", // host-authoritative
    "live-provider-calls", // fixture-only: the adapter performs no network calls
  ],
  authorizationRequirements: [
    {
      resource: "webflix-catalog-export",
      requirement: "WebFlix-issued service credential with catalog read scope; the adapter receives already-authorized export batches",
      enforcedBy: "host",
    },
    {
      resource: "webflix-player-telemetry",
      requirement: "WebFlix player telemetry consent for the reporting subject (host consent system)",
      enforcedBy: "host",
    },
    {
      resource: "webflix-rights",
      requirement: "WebFlix rights/entitlement gates pass before any delivery; the adapter only passes rightsTags through",
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
    note: "No live WebFlix system has been contacted. All mapping evidence is fixture evidence; a live path additionally requires real authorization, observed output, measured latency and failure behavior (AGENTS.md production truth).",
  },
  provenance: {
    dataOwnership: "host",
    catalogSource: "WebFlix catalog export batches (adapter input; never host persistence)",
    rightsSource: "WebFlix rights service — host-declared rightsTags pass through unverified",
    deliverySource: "WebFlix player (host delivery authority)",
    identitySource: "WebFlix identity system (host profile ids)",
    consentSource: "WebFlix consent system",
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

const WEBFLIX_SURFACE_DEVICES: Record<WebFlixPlaybackOption["surface"], string[]> = {
  "tv-app": ["tv"],
  "web-player": ["desktop"],
  "mobile-app": ["phone"],
  download: ["phone", "tablet"],
};

const WEBFLIX_RESOLUTION_BANDWIDTH: Record<WebFlixPlaybackOption["maxResolution"], "low" | "medium" | "high"> = {
  "480p": "low",
  "720p": "low",
  "1080p": "medium",
  "4k": "high",
};

const WEBFLIX_DEVICE_CLASS: Record<WebFlixViewingSession["deviceKind"], "tv" | "desktop" | "phone" | "tablet"> = {
  "living-room-tv": "tv",
  web: "desktop",
  phone: "phone",
  tablet: "tablet",
};

const WEBFLIX_EVENT_TYPES: Record<WebFlixPlaybackReport["event"], OutcomeEvent["eventType"]> = {
  started: "start",
  completed: "completion",
  abandoned: "abandonment",
  skipped: "skip",
  seeked: "seek",
  resumed: "resume",
  liked: "explicit-feedback",
  shared: "share",
  saved: "save",
};

const WEBFLIX_GOAL_KIND: Record<WebFlixViewingGoal["goal"], Objective["kind"]> = {
  discover: "discover",
  "catch-up": "catch-up",
  relax: "relax",
  "stay-informed": "stay-informed",
};

const WEBFLIX_STYLE_POLICY: Record<WebFlixViewingStyle, AttentionPolicy["style"]> = {
  mindful: "mindful",
  balanced: "balanced",
  "lean-back": "immersive",
};

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/** The WebFlix reference adapter (pure deterministic mapper). */
export interface WebFlixAdapter {
  readonly declaration: AdapterDeclaration;

  /** WebFlix catalog export → Reckon CatalogItem + Realization records. */
  importCatalog(input: WebFlixCatalogImport): AdapterResult<{ items: CatalogItem[]; realizations: Realization[] }>;

  /** WebFlix recommender feed → Reckon CandidateSet. */
  toCandidateSet(feed: WebFlixRecommendationFeed): AdapterResult<CandidateSet>;

  /** WebFlix viewing session → Reckon ContextSnapshot. */
  toContextSnapshot(session: WebFlixViewingSession): AdapterResult<ContextSnapshot>;

  /** WebFlix viewing goal → Reckon Objective. */
  toObjective(goal: WebFlixViewingGoal): AdapterResult<Objective>;

  /** WebFlix viewing style → Reckon AttentionPolicy. */
  toAttentionPolicy(style: WebFlixViewingStyle): AdapterResult<AttentionPolicy>;

  /**
   * Deterministic host objective-fit policy: overlap between the item's
   * mapped labels and the goal's declared taste genres, divided by the
   * number of declared tastes (0 when no taste is declared — never
   * fabricated). Pure port implementation for the experience expander.
   */
  toObjectiveFit(items: CatalogItem[]): ObjectiveFitFn;

  /** Host play/queue/switch/interrupt/end → scheduler action inputs. */
  toSchedulerIntents(action: WebFlixHostAction, currentState: PlanState): AdapterResult<HostSchedulerIntents>;

  /** Player playback report → OutcomeEvent with an OBSERVED evidence class. */
  toOutcomeEvent(report: WebFlixPlaybackReport, options: WebFlixOutcomeOptions): AdapterResult<OutcomeEvent>;

  /**
   * Observed outcome + catalog item → deterministic genre-affinity
   * PreferenceDeltas (empty for outcome types that carry no affinity
   * evidence — documented rule, never fabricated).
   */
  toPreferenceDeltas(outcome: OutcomeEvent, item: CatalogItem): AdapterResult<PreferenceDelta[]>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validatePlaybackOption(
  raw: unknown,
  path: string,
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a playback option object" });
    return;
  }
  checkId(raw["optionId"], `${path}.optionId`, issues);
  checkEnum(raw["surface"], `${path}.surface`, ["tv-app", "web-player", "mobile-app", "download"] as const, issues);
  checkOptionalLocale(raw["locale"], `${path}.locale`, issues);
  checkEnum(raw["maxResolution"], `${path}.maxResolution`, ["480p", "720p", "1080p", "4k"] as const, issues);
  checkStringArray(raw["audioTracks"], `${path}.audioTracks`, 1, 8, 2, 8, issues);
  checkOptional(raw["durationSeconds"], `${path}.durationSeconds`, checkNonNegativeNumber, issues);
  checkOptionalBoolean(raw["downloadable"], `${path}.downloadable`, issues);
  checkOptionalBoolean(raw["offlineEligible"], `${path}.offlineEligible`, issues);
  checkEnumArray(raw["variants"], `${path}.variants`, ["clip", "subtitled", "dubbed", "audio-only"] as const, issues);
  const variants = raw["variants"];
  if (Array.isArray(variants) && variants.length > 4) {
    issues.push({ path: `${path}.variants`, message: "must contain at most 4 variants" });
  }
}

function validateMediaItem(
  raw: unknown,
  path: string,
  limits: AdapterDeclaration["limits"],
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a media item object" });
    return;
  }
  checkId(raw["mediaId"], `${path}.mediaId`, issues);
  checkString(raw["title"], `${path}.title`, 1, 512, issues);
  checkEnum(raw["mediaType"], `${path}.mediaType`, ["movie", "series", "documentary", "short"] as const, issues);
  checkStringArray(raw["genres"], `${path}.genres`, 1, 16, 1, 64, issues);
  checkOptional(raw["availableFrom"], `${path}.availableFrom`, checkTimestamp, issues);
  checkOptional(raw["availableUntil"], `${path}.availableUntil`, checkTimestamp, issues);
  checkStringArray(raw["rightsTags"], `${path}.rightsTags`, 0, 16, 1, 64, issues);
  const playbacks = raw["playbacks"];
  if (!Array.isArray(playbacks) || playbacks.length === 0) {
    issues.push({ path: `${path}.playbacks`, message: "must be a non-empty array of playback options" });
  } else {
    if (playbacks.length > limits.maxRealizationsPerItem) {
      issues.push({
        path: `${path}.playbacks`,
        message: `item declares ${playbacks.length} playback options; limit is ${limits.maxRealizationsPerItem}`,
      });
    }
    playbacks.forEach((option, index) => {
      validatePlaybackOption(option, `${path}.playbacks[${index}]`, issues);
    });
  }
  const from = raw["availableFrom"];
  const until = raw["availableUntil"];
  if (
    typeof from === "number" && typeof until === "number" &&
    Number.isInteger(from) && Number.isInteger(until) && until <= from
  ) {
    issues.push({ path: `${path}.availableUntil`, message: "must be greater than availableFrom" });
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Create the WebFlix reference adapter (stateless, pure). */
export function createWebFlixAdapter(): WebFlixAdapter {
  const declaration = WEBFLIX_ADAPTER_DECLARATION;

  return {
    declaration,

    importCatalog(input) {
      if (!isPlainObject(input)) {
        return invalidAdapterInput("importCatalog: input must be an object");
      }
      const issues: IssueList = [];
      checkString(input["source"], "source", 1, 64, issues);
      checkTimestamp(input["exportedAt"], "exportedAt", issues);
      const rawItems = input["items"];
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        issues.push({ path: "items", message: "must be a non-empty array of media items" });
      } else if (rawItems.length > declaration.limits.maxItemsPerImport) {
        return limitExceeded(
          `importCatalog: ${rawItems.length} items exceed the import limit of ${declaration.limits.maxItemsPerImport}`,
        );
      } else {
        rawItems.forEach((item, index) => {
          validateMediaItem(item, `items[${index}]`, declaration.limits, issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("importCatalog: invalid WebFlix catalog import", issues);
      }

      const items = rawItems as WebFlixMediaItem[];
      // All-or-nothing duplicate detection (deterministic).
      const seenMedia = new Set<string>();
      const seenOptions = new Set<string>();
      for (const item of items) {
        if (seenMedia.has(item.mediaId)) {
          return invalidAdapterInput(`importCatalog: duplicate mediaId ${item.mediaId} (all-or-nothing import)`);
        }
        seenMedia.add(item.mediaId);
        for (const option of item.playbacks) {
          if (seenOptions.has(option.optionId)) {
            return invalidAdapterInput(
              `importCatalog: duplicate playback optionId ${option.optionId} (realization ids must be unique per import)`,
            );
          }
          seenOptions.add(option.optionId);
        }
      }

      const catalogItems: CatalogItem[] = [];
      const realizations: Realization[] = [];
      for (const item of items) {
        const parsedItem = CatalogItemSchema.safeParse({
          itemId: item.mediaId,
          kind: "media",
          labels: sortedUniqueLabels([item.mediaType, ...item.genres]),
          attributes: {
            title: item.title,
            mediaType: item.mediaType,
            rightsTags: [...item.rightsTags],
          },
          ...(item.availableFrom !== undefined ? { availableFrom: item.availableFrom } : {}),
          ...(item.availableUntil !== undefined ? { availableUntil: item.availableUntil } : {}),
        });
        if (!parsedItem.success) {
          return invalidAdapterInput(
            `importCatalog: constructed catalog item for ${item.mediaId} failed schema validation`,
            parsedItem.error.issues.map((i) => ({ path: `items.${item.mediaId}.${i.path.join(".")}`, message: i.message })),
          );
        }
        catalogItems.push(parsedItem.data);

        for (const option of item.playbacks) {
          const variants = sortedUniqueLabels(["full", ...(option.variants ?? [])]);
          const parsedRealization = RealizationSchema.safeParse({
            realizationId: option.optionId,
            itemId: item.mediaId,
            kind: option.surface,
            ...(option.locale !== undefined ? { locale: option.locale } : {}),
            constraints: {
              formats: variants,
              ...(option.durationSeconds !== undefined ? { durationSeconds: option.durationSeconds } : {}),
              deviceClasses: [...WEBFLIX_SURFACE_DEVICES[option.surface]],
              requiresScreen: true,
              requiresAudio: true,
              minBandwidth: WEBFLIX_RESOLUTION_BANDWIDTH[option.maxResolution],
              maxResolution: option.maxResolution,
              audioTracks: [...option.audioTracks],
              downloadable: option.downloadable,
              offlineEligible: option.offlineEligible,
            },
          });
          if (!parsedRealization.success) {
            return invalidAdapterInput(
              `importCatalog: constructed realization for ${option.optionId} failed schema validation`,
              parsedRealization.error.issues.map((i) => ({ path: `realizations.${option.optionId}.${i.path.join(".")}`, message: i.message })),
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
      checkString(feed["source"], "source", 1, 64, issues);
      const rows = feed["rows"];
      if (!Array.isArray(rows) || rows.length === 0) {
        issues.push({ path: "rows", message: "must be a non-empty array of retrieval rows" });
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
          checkId(row["mediaId"], `rows[${index}].mediaId`, issues);
          const rank = row["rank"];
          if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1) {
            issues.push({ path: `rows[${index}].rank`, message: "must be a positive integer 1-based rank" });
          }
          checkOptional(row["reason"], `rows[${index}].reason`, (v, p, list) => checkString(v, p, 1, 256, list), issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("toCandidateSet: invalid WebFlix recommendation feed", issues);
      }

      const parsed = CandidateSetSchema.safeParse({
        setId: feed.feedId,
        candidates: feed.rows.map((row) => ({
          itemId: row.mediaId,
          realizationIds: [],
          source: feed.source,
          rankHint: row.rank,
        })),
        provenance: {
          system: feed.source,
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
      checkString(session["profileId"], "profileId", 1, 512, issues);
      checkId(session["sessionId"], "sessionId", issues);
      checkTimestamp(session["at"], "at", issues);
      checkEnum(session["deviceKind"], "deviceKind", ["living-room-tv", "web", "phone", "tablet"] as const, issues);
      checkEnum(session["networkKind"], "networkKind", ["wifi", "cellular", "offline"] as const, issues);
      checkLocalTime(session["localTime"], "localTime", issues);
      checkString(session["timezone"], "timezone", 1, 64, issues);
      checkOptional(session["minutesAvailable"], "minutesAvailable", checkNonNegativeNumber, issues);
      checkOptional(session["recentInterruptions"], "recentInterruptions", (v, p, list) => {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          list.push({ path: p, message: "must be a non-negative integer" });
        }
      }, issues);
      checkOptionalBoolean(session["continuing"], "continuing", issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toContextSnapshot: invalid WebFlix viewing session", issues);
      }

      const s = session;
      const parsed = ContextSnapshotSchema.safeParse({
        contextId: s.sessionId,
        at: s.at,
        time: {
          localTime: s.localTime,
          timezone: s.timezone,
          dayPart: dayPartOf(s.localTime),
        },
        device: { class: WEBFLIX_DEVICE_CLASS[s.deviceKind] },
        network: { class: s.networkKind },
        activity: s.continuing === true ? ["continuing-viewing"] : [],
        ...(s.minutesAvailable !== undefined
          ? { attention: { availableMs: Math.round(s.minutesAvailable * 60_000) } }
          : {}),
        ...(s.recentInterruptions !== undefined
          ? { fatigue: { recentInterruptions: s.recentInterruptions } }
          : {}),
        session: { sessionId: s.sessionId },
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toContextSnapshot: constructed context snapshot failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toObjective(goal) {
      if (!isPlainObject(goal)) {
        return invalidAdapterInput("toObjective: input must be an object");
      }
      const issues: IssueList = [];
      checkEnum(goal["goal"], "goal", ["discover", "catch-up", "relax", "stay-informed"] as const, issues);
      checkStringArray(goal["tasteGenres"], "tasteGenres", 0, 16, 1, 64, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toObjective: invalid WebFlix viewing goal", issues);
      }
      const g = goal;
      const parsed = ObjectiveSchema.safeParse({
        objectiveId: `wf-goal-${g.goal}`,
        kind: WEBFLIX_GOAL_KIND[g.goal],
        params: { tasteGenres: [...g.tasteGenres] },
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toObjective: constructed objective failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toAttentionPolicy(style) {
      const issues: IssueList = [];
      const mapped = checkEnum(style, "style", ["mindful", "balanced", "lean-back"] as const, issues);
      if (issues.length > 0 || mapped === undefined) {
        return invalidAdapterInput("toAttentionPolicy: invalid WebFlix viewing style", issues);
      }
      const parsed = AttentionPolicySchema.safeParse({
        policyId: `wf-attention-${mapped}`,
        style: WEBFLIX_STYLE_POLICY[mapped],
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
        const taste = objective.params?.["tasteGenres"];
        if (!Array.isArray(taste) || taste.length === 0 || taste.some((t) => typeof t !== "string")) {
          return 0; // no declared taste evidence — never fabricated
        }
        const labels = labelsByItem.get(experience.itemId);
        if (labels === undefined) return 0;
        let hits = 0;
        for (const genre of taste) {
          if (labels.has(genre)) hits += 1;
        }
        return hits / taste.length;
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
      const kind = checkEnum(raw["kind"], "kind", ["play", "queue", "switch", "interrupt", "end"] as const, issues);
      if (kind === "play") {
        checkId(raw["experienceId"], "experienceId", issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid play action", issues);
        const play = raw as unknown as { kind: "play"; experienceId: string };
        const transition = hostStartTransition(currentState, play.experienceId);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "queue") {
        checkStringArray(raw["experienceIds"], "experienceIds", 1, 16, 1, 128, issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid queue action", issues);
        const enqueue = raw as unknown as { kind: "queue"; experienceIds: string[] };
        const transition = hostEnqueueTransition(currentState, enqueue.experienceIds);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "switch") {
        const numbersRaw = raw["numbers"];
        if (!isPlainObject(numbersRaw)) {
          return invalidAdapterInput("toSchedulerIntents: switch action requires a numbers object");
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
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid switch numbers", issues);
        const numbers = numbersRaw as unknown as WebFlixSwitchNumbers;
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
      if (kind === "interrupt") {
        checkId(raw["experienceId"], "experienceId", issues);
        checkOptional(raw["resumeToken"], "resumeToken", (v, p, list) => checkString(v, p, 1, 1024, list), issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid interrupt action", issues);
        const interrupt = raw as unknown as { kind: "interrupt"; experienceId: string; resumeToken?: string };
        return {
          ok: true,
          value: {
            interruptRequested: true,
            ...(interrupt.resumeToken !== undefined
              ? { resumeTokens: { [interrupt.experienceId]: interrupt.resumeToken } }
              : {}),
          },
        };
      }
      if (kind === "end") {
        return { ok: true, value: { endRequested: true } };
      }
      return invalidAdapterInput("toSchedulerIntents: action kind must be play, queue, switch, interrupt or end", issues);
    },

    toOutcomeEvent(report, options) {
      if (!isPlainObject(report)) {
        return invalidAdapterInput("toOutcomeEvent: report must be an object");
      }
      const issues: IssueList = [];
      checkId(report["playbackId"], "playbackId", issues);
      checkTimestamp(report["at"], "at", issues);
      checkId(report["mediaId"], "mediaId", issues);
      checkOptional(report["experienceId"], "experienceId", checkId, issues);
      checkOptional(report["decisionId"], "decisionId", checkId, issues);
      checkEnum(
        report["event"],
        "event",
        ["started", "completed", "abandoned", "skipped", "seeked", "resumed", "liked", "shared", "saved"] as const,
        issues,
      );
      checkOptional(report["positionSeconds"], "positionSeconds", checkNonNegativeNumber, issues);
      checkOptional(report["totalSeconds"], "totalSeconds", checkNonNegativeNumber, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid WebFlix playback report", issues);
      }

      // Observation-channel law: only observed evidence classes are
      // accepted on the player report path (defense in depth for
      // callers that bypass the narrowed input type).
      const evidenceClass = options.evidenceClass;
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass)) {
        return unsupportedEvidenceClass(
          `toOutcomeEvent: evidenceClass ${String(evidenceClass)} is not an observed class; the WebFlix player report channel maps observations only (${OBSERVED_EVIDENCE_CLASSES.join(", ")})`,
          [{ path: "options.evidenceClass", message: "must be an observed evidence class" }],
        );
      }
      const tenantIssues: IssueList = [];
      if (!TenantScopeSchema.safeParse(options.tenant).success) {
        tenantIssues.push({ path: "options.tenant", message: "must be a valid tenant scope" });
      }
      if (
        !isPlainObject(options.subject) ||
        typeof options.subject.kind !== "string" ||
        !["user", "audience", "account", "session"].includes(options.subject.kind) ||
        typeof options.subject.ref !== "string" ||
        options.subject.ref.length < 1
      ) {
        tenantIssues.push({ path: "options.subject", message: "must be a subject reference { kind, ref }" });
      }
      if (options.contextId !== undefined) {
        checkId(options.contextId, "options.contextId", tenantIssues);
      }
      if (tenantIssues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid outcome options", tenantIssues);
      }

      const r = report;
      const eventType = WEBFLIX_EVENT_TYPES[r.event];
      const metrics: Record<string, number> = {};
      if (r.positionSeconds !== undefined) metrics["positionSeconds"] = r.positionSeconds;
      if (r.totalSeconds !== undefined) metrics["totalSeconds"] = r.totalSeconds;
      if (r.positionSeconds !== undefined && r.totalSeconds !== undefined && r.totalSeconds > 0) {
        metrics["completionRatio"] = Math.round((r.positionSeconds / r.totalSeconds) * 10_000) / 10_000;
      }

      const eventId = deriveId("evt-", "webflix.outcome-event", {
        tenantId: options.tenant.tenantId,
        playbackId: r.playbackId,
        eventType,
        at: r.at,
      });
      const idempotencyKey = deriveId("evtkey-", "webflix.outcome-idempotency", {
        tenantId: options.tenant.tenantId,
        playbackId: r.playbackId,
        eventType,
      });

      const parsed = OutcomeEventSchema.safeParse({
        eventId,
        tenant: options.tenant,
        ...(r.decisionId !== undefined ? { decisionId: r.decisionId } : {}),
        ...(r.experienceId !== undefined ? { experienceId: r.experienceId } : {}),
        subject: options.subject,
        eventType,
        occurredAt: r.at,
        ...(options.contextId !== undefined ? { context: { contextId: options.contextId } } : {}),
        provenance: { system: "webflix-player", version: "1" },
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
      // completion → +0.25 (confidence +0.20); abandonment → −0.10
      // (+0.10); explicit-feedback → +0.50 (+0.60); skip → −0.05
      // (+0.05). Every other outcome type carries no affinity evidence
      // and maps to NO delta.
      let value: number | undefined;
      let confidenceDelta: number | undefined;
      switch (observed.eventType) {
        case "completion":
          value = 0.25;
          confidenceDelta = 0.2;
          break;
        case "abandonment":
          value = -0.1;
          confidenceDelta = 0.1;
          break;
        case "explicit-feedback":
          value = 0.5;
          confidenceDelta = 0.6;
          break;
        case "skip":
          value = -0.05;
          confidenceDelta = 0.05;
          break;
        default:
          value = undefined;
          confidenceDelta = undefined;
          break;
      }
      if (value === undefined || confidenceDelta === undefined) {
        return { ok: true, value: [] };
      }

      // Affinity applies to the item's mapped labels (kind + genres),
      // sorted and capped at 8 (deterministic).
      const labels = sortedUniqueLabels(itemParse.data.labels).slice(0, 8);
      const deltas: PreferenceDelta[] = [];
      for (const label of labels) {
        const dimension = `webflix.genre-affinity:${label}`;
        const parsed = PreferenceDeltaSchema.safeParse({
          deltaId: deriveId("pd-", "webflix.preference-delta", {
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
          provenance: { system: "webflix-adapter", version: "0.1.0" },
          decay: { halfLifeSeconds: 2_592_000 },
          model: { modelId: "webflix-affinity-v1", version: "1" },
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
export function webflixFixtureDigest(payload: unknown): string {
  return contentDigest(payload);
}
