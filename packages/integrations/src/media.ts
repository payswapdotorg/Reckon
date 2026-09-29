/**
 * W3-006 — the generic media reference adapter.
 *
 * Same contract proof as the WebFlix reference adapter (W3-005) with
 * ZERO WebFlix vocabulary: a different host naming scheme ("program
 * guide", "renditions", "topic feed", "listening session", "tune /
 * enqueue / flip / pause / stop", "playout reports") maps into the
 * SAME frozen normalized contracts:
 *
 *   program guide entries (names, topics, availability windows,
 *   renditions) → `CatalogItem` + `Realization`
 *   topic feed picks            → `CandidateSet`
 *   listening session           → `ContextSnapshot`
 *   listening goal / style      → `Objective` / `AttentionPolicy`
 *   host tune/enqueue/flip/pause/stop → scheduler action inputs
 *   playout reports             → `OutcomeEvent`s with an OBSERVED
 *   evidence class
 *   observed outcomes           → `PreferenceDelta`s (deterministic
 *   documented topic-affinity rule)
 *
 * LAWS enforced here (identical to W3-005, different vocabulary):
 * - HOST-BOUNDARY LAW: no host-internal persistence imports — all host
 *   data enters through interface types declared in THIS package.
 * - The kernel stays domain-neutral: this adapter proves that the
 *   frozen contracts carry a SECOND media domain without any core
 *   change. No WebFlix naming appears in host shapes, mapped records
 *   or provenance strings.
 * - NO CORE RANKING LOGIC: mapping only; decisions come from the W2
 *   kernels. The objective-fit function is a documented deterministic
 *   host topic-affinity policy.
 * - EVIDENCE LAW: playout reports are an OBSERVATION channel — only
 *   observed evidence classes are accepted.
 * - Determinism: derived ids from canonical content digests; no
 *   clocks, no randomness, no network. Fixture-only (see declaration).
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
// Host interface types (declared HERE — no WebFlix vocabulary)
// ---------------------------------------------------------------------------

/** One delivery rendition a media publisher declares for a program. */
export interface Rendition {
  renditionId: string;
  surface: "live-stream" | "podcast-app" | "web-embed";
  /** Primary delivery language (optional, BCP-47). */
  primaryLanguage?: string;
  /** All languages offered by this rendition. */
  languages: string[];
  /** Host-declared audio bitrate. */
  bitrateKbps?: number;
  /** Host-declared estimated duration (seconds). */
  durationSeconds?: number;
  /** Additional formats this rendition can deliver (base "full" is implicit). */
  formatVariants?: ("clip" | "segment" | "audio-only")[];
  offlineCapable: boolean;
}

/** A program guide entry (generic media host shape). */
export interface ProgramEntry {
  programId: string;
  name: string;
  programKind: "episode" | "live" | "audiobook" | "story";
  topics: string[];
  windowOpensAt?: number;
  windowClosesAt?: number;
  /** Host-declared license scope tags (pass-through, never verified). */
  licenseScope: string[];
  renditions: Rendition[];
}

/** One program guide export batch (all-or-nothing import). */
export interface ProgramGuideExport {
  guideId: string;
  exportedAt: number;
  entries: ProgramEntry[];
}

/** One curated pick in a topic feed. */
export interface TopicFeedPick {
  programId: string;
  /** 1-based position in the feed (host retrieval hint, never a decision). */
  position: number;
  rationale?: string;
}

/** A topic feed snapshot (host retrieval shape). */
export interface TopicFeed {
  feedId: string;
  curator: string;
  picks: TopicFeedPick[];
}

/** A listening session snapshot (host context shape). */
export interface ListeningSession {
  listenerId: string;
  sessionId: string;
  at: number;
  apparatus: "phone" | "tablet" | "desktop" | "tv" | "vehicle";
  audioRoute?: "none" | "speaker" | "headphones" | "vehicle" | "other" | "unknown";
  networkKind: "wifi" | "cellular" | "offline";
  /** 24h "HH:MM" local time at the host. */
  localTime: string;
  timezone: string;
  minutesAvailable?: number;
  interruptionCount?: number;
  resuming?: boolean;
}

/** A listening goal (host-declared objective). */
export interface ListeningGoal {
  aim: "learn" | "discover" | "unwind" | "catch-up";
  /** Declared favorite topics (host policy input for objective fit). */
  favoriteTopics: string[];
}

/** A listening attention style (host-declared attention policy). */
export type ListeningAttentionStyle = "quiet" | "steady" | "binge";

/** Caller-supplied flip numbers (SEPARATION LAW: every number is host-supplied). */
export interface FlipNumbers {
  fromExperienceId: string;
  toExperienceId: string;
  expectedImprovement: number;
  interruptionCost: number;
  uncertaintyPenalty: number;
  resumeLoss: number;
  switchThreshold: number;
  suggestThreshold: number;
}

/** A generic-media host action (player/queue/UI intent). */
export type MediaHostAction =
  | { kind: "tune"; experienceId: string }
  | { kind: "enqueue"; experienceIds: string[] }
  | { kind: "flip"; numbers: FlipNumbers }
  | { kind: "pause"; experienceId: string; resumeToken?: string }
  | { kind: "stop" };

/** A playout report (host OBSERVATION channel). */
export interface PlayoutReport {
  playoutId: string;
  at: number;
  programId: string;
  /** Present when the playout came from a Reckon decision. */
  experienceId?: string;
  decisionId?: string;
  event:
    | "tuned-in"
    | "finished"
    | "left"
    | "hopped"
    | "scrolled"
    | "returned"
    | "thumbed-up"
    | "passed-along"
    | "bookmarked";
  positionSeconds?: number;
  totalSeconds?: number;
}

/** Options for mapping a playout report to an outcome event. */
export interface PlayoutOutcomeOptions {
  tenant: TenantScope;
  subject: SubjectReference;
  /**
   * Host-declared class of the observation channel. Playout reports
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

export const GENERIC_MEDIA_ADAPTER_DECLARATION: AdapterDeclaration = {
  adapterId: "generic-media-reference-adapter",
  domain: "media",
  contractVersion: "0.1.0",
  supportedCapabilities: [
    "program-guide-import", // guide export → CatalogItem + Realization
    "retrieval-mapping", // topic feed → CandidateSet
    "context-mapping", // listening session → ContextSnapshot
    "objective-mapping", // listening goal → Objective
    "attention-policy-mapping", // listening style → AttentionPolicy
    "objective-fit-host-policy", // deterministic topic-affinity fit function
    "scheduler-intent-mapping", // tune/enqueue/flip/pause/stop → scheduler inputs
    "playout-outcome-mapping", // playout reports → OutcomeEvent (observed class only)
    "preference-delta-mapping", // observed outcomes → PreferenceDelta
  ],
  unsupportedCapabilities: [
    "identity", // host-authoritative
    "consent-management", // host-authoritative
    "rights-verification", // license scope tags are pass-through only; the host verifies rights
    "catalog-authoring", // the adapter maps host guide truth; it never authors it
    "content-delivery", // the host player delivers; the adapter never does
    "payment", // host-authoritative
    "live-provider-calls", // fixture-only: the adapter performs no network calls
  ],
  authorizationRequirements: [
    {
      resource: "media-program-guide",
      requirement: "Host-issued service credential with guide read scope; the adapter receives already-authorized export batches",
      enforcedBy: "host",
    },
    {
      resource: "media-playout-telemetry",
      requirement: "Host player telemetry consent for the reporting subject (host consent system)",
      enforcedBy: "host",
    },
    {
      resource: "media-rights",
      requirement: "Host rights/entitlement gates pass before any delivery; the adapter only passes licenseScope through",
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
    note: "No live media provider has been contacted. All mapping evidence is fixture evidence; a live path additionally requires real authorization, observed output, measured latency and failure behavior (AGENTS.md production truth).",
  },
  provenance: {
    dataOwnership: "host",
    catalogSource: "Host program guide export batches (adapter input; never host persistence)",
    rightsSource: "Host rights service — host-declared licenseScope tags pass through unverified",
    deliverySource: "Host media player (host delivery authority)",
    identitySource: "Host identity system (host listener ids)",
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

/** Audio-first delivery: renditions deliver sound; a screen is not required. */
const MEDIA_SURFACE_DEVICES: Record<Rendition["surface"], string[]> = {
  "live-stream": ["desktop", "phone"],
  "podcast-app": ["phone", "tablet"],
  "web-embed": ["desktop"],
};

const MEDIA_APPARATUS_CLASS: Record<ListeningSession["apparatus"], "phone" | "tablet" | "desktop" | "tv" | "vehicle"> = {
  phone: "phone",
  tablet: "tablet",
  desktop: "desktop",
  tv: "tv",
  vehicle: "vehicle",
};

const PLAYOUT_EVENT_TYPES: Record<PlayoutReport["event"], OutcomeEvent["eventType"]> = {
  "tuned-in": "start",
  finished: "completion",
  left: "abandonment",
  hopped: "skip",
  scrolled: "seek",
  returned: "resume",
  "thumbed-up": "explicit-feedback",
  "passed-along": "share",
  bookmarked: "save",
};

const LISTENING_GOAL_KIND: Record<ListeningGoal["aim"], Objective["kind"]> = {
  learn: "learn",
  discover: "discover",
  unwind: "relax",
  "catch-up": "catch-up",
};

const LISTENING_STYLE_POLICY: Record<ListeningAttentionStyle, AttentionPolicy["style"]> = {
  quiet: "mindful",
  steady: "balanced",
  binge: "immersive",
};

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/** The generic media reference adapter (pure deterministic mapper). */
export interface MediaAdapter {
  readonly declaration: AdapterDeclaration;

  /** Program guide export → Reckon CatalogItem + Realization records. */
  importProgramGuide(input: ProgramGuideExport): AdapterResult<{ items: CatalogItem[]; realizations: Realization[] }>;

  /** Topic feed → Reckon CandidateSet. */
  toCandidateSet(feed: TopicFeed): AdapterResult<CandidateSet>;

  /** Listening session → Reckon ContextSnapshot. */
  toContextSnapshot(session: ListeningSession): AdapterResult<ContextSnapshot>;

  /** Listening goal → Reckon Objective. */
  toObjective(goal: ListeningGoal): AdapterResult<Objective>;

  /** Listening attention style → Reckon AttentionPolicy. */
  toAttentionPolicy(style: ListeningAttentionStyle): AdapterResult<AttentionPolicy>;

  /**
   * Deterministic host objective-fit policy: overlap between the
   * program's mapped labels and the goal's declared favorite topics,
   * divided by the number of declared favorites (0 when none declared —
   * never fabricated). Pure port implementation for the expander.
   */
  toTopicFit(items: CatalogItem[]): ObjectiveFitFn;

  /** Host tune/enqueue/flip/pause/stop → scheduler action inputs. */
  toSchedulerIntents(action: MediaHostAction, currentState: PlanState): AdapterResult<HostSchedulerIntents>;

  /** Playout report → OutcomeEvent with an OBSERVED evidence class. */
  toOutcomeEvent(report: PlayoutReport, options: PlayoutOutcomeOptions): AdapterResult<OutcomeEvent>;

  /**
   * Observed outcome + catalog item → deterministic topic-affinity
   * PreferenceDeltas (empty for outcome types that carry no affinity
   * evidence — documented rule, never fabricated).
   */
  toPreferenceDeltas(outcome: OutcomeEvent, item: CatalogItem): AdapterResult<PreferenceDelta[]>;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validateRendition(raw: unknown, path: string, issues: IssueList): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a rendition object" });
    return;
  }
  checkId(raw["renditionId"], `${path}.renditionId`, issues);
  checkEnum(raw["surface"], `${path}.surface`, ["live-stream", "podcast-app", "web-embed"] as const, issues);
  checkOptionalLocale(raw["primaryLanguage"], `${path}.primaryLanguage`, issues);
  checkStringArray(raw["languages"], `${path}.languages`, 1, 8, 2, 8, issues);
  checkOptional(raw["bitrateKbps"], `${path}.bitrateKbps`, checkNonNegativeNumber, issues);
  checkOptional(raw["durationSeconds"], `${path}.durationSeconds`, checkNonNegativeNumber, issues);
  checkEnumArray(raw["formatVariants"], `${path}.formatVariants`, ["clip", "segment", "audio-only"] as const, issues);
  checkOptionalBoolean(raw["offlineCapable"], `${path}.offlineCapable`, issues);
  const variants = raw["formatVariants"];
  if (Array.isArray(variants) && variants.length > 4) {
    issues.push({ path: `${path}.formatVariants`, message: "must contain at most 4 variants" });
  }
}

function validateProgramEntry(
  raw: unknown,
  path: string,
  limits: AdapterDeclaration["limits"],
  issues: IssueList,
): void {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: "must be a program entry object" });
    return;
  }
  checkId(raw["programId"], `${path}.programId`, issues);
  checkString(raw["name"], `${path}.name`, 1, 512, issues);
  checkEnum(raw["programKind"], `${path}.programKind`, ["episode", "live", "audiobook", "story"] as const, issues);
  checkStringArray(raw["topics"], `${path}.topics`, 1, 16, 1, 64, issues);
  checkOptional(raw["windowOpensAt"], `${path}.windowOpensAt`, checkTimestamp, issues);
  checkOptional(raw["windowClosesAt"], `${path}.windowClosesAt`, checkTimestamp, issues);
  checkStringArray(raw["licenseScope"], `${path}.licenseScope`, 0, 16, 1, 64, issues);
  const renditions = raw["renditions"];
  if (!Array.isArray(renditions) || renditions.length === 0) {
    issues.push({ path: `${path}.renditions`, message: "must be a non-empty array of renditions" });
  } else {
    if (renditions.length > limits.maxRealizationsPerItem) {
      issues.push({
        path: `${path}.renditions`,
        message: `program declares ${renditions.length} renditions; limit is ${limits.maxRealizationsPerItem}`,
      });
    }
    renditions.forEach((rendition, index) => {
      validateRendition(rendition, `${path}.renditions[${index}]`, issues);
    });
  }
  const opens = raw["windowOpensAt"];
  const closes = raw["windowClosesAt"];
  if (
    typeof opens === "number" && typeof closes === "number" &&
    Number.isInteger(opens) && Number.isInteger(closes) && closes <= opens
  ) {
    issues.push({ path: `${path}.windowClosesAt`, message: "must be greater than windowOpensAt" });
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/** Create the generic media reference adapter (stateless, pure). */
export function createMediaAdapter(): MediaAdapter {
  const declaration = GENERIC_MEDIA_ADAPTER_DECLARATION;

  return {
    declaration,

    importProgramGuide(input) {
      if (!isPlainObject(input)) {
        return invalidAdapterInput("importProgramGuide: input must be an object");
      }
      const issues: IssueList = [];
      checkId(input["guideId"], "guideId", issues);
      checkTimestamp(input["exportedAt"], "exportedAt", issues);
      const rawEntries = input["entries"];
      if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
        issues.push({ path: "entries", message: "must be a non-empty array of program entries" });
      } else if (rawEntries.length > declaration.limits.maxItemsPerImport) {
        return limitExceeded(
          `importProgramGuide: ${rawEntries.length} entries exceed the import limit of ${declaration.limits.maxItemsPerImport}`,
        );
      } else {
        rawEntries.forEach((entry, index) => {
          validateProgramEntry(entry, `entries[${index}]`, declaration.limits, issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("importProgramGuide: invalid program guide export", issues);
      }

      const entries = rawEntries as ProgramEntry[];
      // All-or-nothing duplicate detection (deterministic).
      const seenPrograms = new Set<string>();
      const seenRenditions = new Set<string>();
      for (const entry of entries) {
        if (seenPrograms.has(entry.programId)) {
          return invalidAdapterInput(`importProgramGuide: duplicate programId ${entry.programId} (all-or-nothing import)`);
        }
        seenPrograms.add(entry.programId);
        for (const rendition of entry.renditions) {
          if (seenRenditions.has(rendition.renditionId)) {
            return invalidAdapterInput(
              `importProgramGuide: duplicate renditionId ${rendition.renditionId} (realization ids must be unique per import)`,
            );
          }
          seenRenditions.add(rendition.renditionId);
        }
      }

      const items: CatalogItem[] = [];
      const realizations: Realization[] = [];
      for (const entry of entries) {
        const parsedItem = CatalogItemSchema.safeParse({
          itemId: entry.programId,
          kind: "media",
          labels: sortedUniqueLabels([entry.programKind, ...entry.topics]),
          attributes: {
            name: entry.name,
            programKind: entry.programKind,
            licenseScope: [...entry.licenseScope],
          },
          ...(entry.windowOpensAt !== undefined ? { availableFrom: entry.windowOpensAt } : {}),
          ...(entry.windowClosesAt !== undefined ? { availableUntil: entry.windowClosesAt } : {}),
        });
        if (!parsedItem.success) {
          return invalidAdapterInput(
            `importProgramGuide: constructed catalog item for ${entry.programId} failed schema validation`,
            parsedItem.error.issues.map((i) => ({ path: `items.${entry.programId}.${i.path.join(".")}`, message: i.message })),
          );
        }
        items.push(parsedItem.data);

        for (const rendition of entry.renditions) {
          const formats = sortedUniqueLabels(["full", ...(rendition.formatVariants ?? [])]);
          const parsedRealization = RealizationSchema.safeParse({
            realizationId: rendition.renditionId,
            itemId: entry.programId,
            kind: rendition.surface,
            ...(rendition.primaryLanguage !== undefined ? { locale: rendition.primaryLanguage } : {}),
            constraints: {
              formats,
              ...(rendition.durationSeconds !== undefined ? { durationSeconds: rendition.durationSeconds } : {}),
              deviceClasses: [...MEDIA_SURFACE_DEVICES[rendition.surface]],
              requiresScreen: false,
              requiresAudio: true,
              minBandwidth: "low",
              ...(rendition.bitrateKbps !== undefined ? { bitrateKbps: rendition.bitrateKbps } : {}),
              languages: [...rendition.languages],
              offlineCapable: rendition.offlineCapable,
            },
          });
          if (!parsedRealization.success) {
            return invalidAdapterInput(
              `importProgramGuide: constructed realization for ${rendition.renditionId} failed schema validation`,
              parsedRealization.error.issues.map((i) => ({ path: `realizations.${rendition.renditionId}.${i.path.join(".")}`, message: i.message })),
            );
          }
          realizations.push(parsedRealization.data);
        }
      }

      return { ok: true, value: { items, realizations } };
    },

    toCandidateSet(feed) {
      if (!isPlainObject(feed)) {
        return invalidAdapterInput("toCandidateSet: input must be an object");
      }
      const issues: IssueList = [];
      checkId(feed["feedId"], "feedId", issues);
      checkString(feed["curator"], "curator", 1, 64, issues);
      const picks = feed["picks"];
      if (!Array.isArray(picks) || picks.length === 0) {
        issues.push({ path: "picks", message: "must be a non-empty array of feed picks" });
      } else if (picks.length > declaration.limits.maxCandidatesPerSet) {
        return limitExceeded(
          `toCandidateSet: ${picks.length} picks exceed the candidate-set limit of ${declaration.limits.maxCandidatesPerSet}`,
        );
      } else {
        picks.forEach((pick, index) => {
          if (!isPlainObject(pick)) {
            issues.push({ path: `picks[${index}]`, message: "must be an object" });
            return;
          }
          checkId(pick["programId"], `picks[${index}].programId`, issues);
          const position = pick["position"];
          if (typeof position !== "number" || !Number.isInteger(position) || position < 1) {
            issues.push({ path: `picks[${index}].position`, message: "must be a positive integer 1-based position" });
          }
          checkOptional(pick["rationale"], `picks[${index}].rationale`, (v, p, list) => checkString(v, p, 1, 256, list), issues);
        });
      }
      if (issues.length > 0) {
        return invalidAdapterInput("toCandidateSet: invalid topic feed", issues);
      }

      const parsed = CandidateSetSchema.safeParse({
        setId: feed.feedId,
        candidates: feed.picks.map((pick) => ({
          itemId: pick.programId,
          realizationIds: [],
          source: feed.curator,
          rankHint: pick.position,
        })),
        provenance: {
          system: feed.curator,
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
      checkString(session["listenerId"], "listenerId", 1, 512, issues);
      checkId(session["sessionId"], "sessionId", issues);
      checkTimestamp(session["at"], "at", issues);
      checkEnum(session["apparatus"], "apparatus", ["phone", "tablet", "desktop", "tv", "vehicle"] as const, issues);
      checkOptional(
        session["audioRoute"],
        "audioRoute",
        (v, p, list) => checkEnum(v, p, ["none", "speaker", "headphones", "vehicle", "other", "unknown"] as const, list),
        issues,
      );
      checkEnum(session["networkKind"], "networkKind", ["wifi", "cellular", "offline"] as const, issues);
      checkLocalTime(session["localTime"], "localTime", issues);
      checkString(session["timezone"], "timezone", 1, 64, issues);
      checkOptional(session["minutesAvailable"], "minutesAvailable", checkNonNegativeNumber, issues);
      checkOptional(session["interruptionCount"], "interruptionCount", (v, p, list) => {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
          list.push({ path: p, message: "must be a non-negative integer" });
        }
      }, issues);
      checkOptionalBoolean(session["resuming"], "resuming", issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toContextSnapshot: invalid listening session", issues);
      }

      const parsed = ContextSnapshotSchema.safeParse({
        contextId: session.sessionId,
        at: session.at,
        time: {
          localTime: session.localTime,
          timezone: session.timezone,
          dayPart: dayPartOf(session.localTime),
        },
        device: {
          class: MEDIA_APPARATUS_CLASS[session.apparatus],
          ...(session.audioRoute !== undefined ? { audioRoute: session.audioRoute } : {}),
        },
        network: { class: session.networkKind },
        activity: session.resuming === true ? ["resuming-listening"] : [],
        ...(session.minutesAvailable !== undefined
          ? { attention: { availableMs: Math.round(session.minutesAvailable * 60_000) } }
          : {}),
        ...(session.interruptionCount !== undefined
          ? { fatigue: { recentInterruptions: session.interruptionCount } }
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

    toObjective(goal) {
      if (!isPlainObject(goal)) {
        return invalidAdapterInput("toObjective: input must be an object");
      }
      const issues: IssueList = [];
      checkEnum(goal["aim"], "aim", ["learn", "discover", "unwind", "catch-up"] as const, issues);
      checkStringArray(goal["favoriteTopics"], "favoriteTopics", 0, 16, 1, 64, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toObjective: invalid listening goal", issues);
      }
      const parsed = ObjectiveSchema.safeParse({
        objectiveId: `gm-goal-${goal.aim}`,
        kind: LISTENING_GOAL_KIND[goal.aim],
        params: { favoriteTopics: [...goal.favoriteTopics] },
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
      const mapped = checkEnum(style, "style", ["quiet", "steady", "binge"] as const, issues);
      if (issues.length > 0 || mapped === undefined) {
        return invalidAdapterInput("toAttentionPolicy: invalid listening attention style", issues);
      }
      const parsed = AttentionPolicySchema.safeParse({
        policyId: `gm-attention-${mapped}`,
        style: LISTENING_STYLE_POLICY[mapped],
      });
      if (!parsed.success) {
        return invalidAdapterInput(
          "toAttentionPolicy: constructed attention policy failed schema validation",
          parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      return { ok: true, value: parsed.data };
    },

    toTopicFit(items) {
      // First occurrence wins (deterministic regardless of input order).
      const labelsByItem = new Map<string, Set<string>>();
      for (const item of Array.isArray(items) ? items : []) {
        if (!labelsByItem.has(item.itemId)) {
          labelsByItem.set(item.itemId, new Set(item.labels));
        }
      }
      return (experience, objective) => {
        const favorites = objective.params?.["favoriteTopics"];
        if (!Array.isArray(favorites) || favorites.length === 0 || favorites.some((t) => typeof t !== "string")) {
          return 0; // no declared topic evidence — never fabricated
        }
        const labels = labelsByItem.get(experience.itemId);
        if (labels === undefined) return 0;
        let hits = 0;
        for (const topic of favorites) {
          if (labels.has(topic)) hits += 1;
        }
        return hits / favorites.length;
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
      const kind = checkEnum(raw["kind"], "kind", ["tune", "enqueue", "flip", "pause", "stop"] as const, issues);
      if (kind === "tune") {
        checkId(raw["experienceId"], "experienceId", issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid tune action", issues);
        const tune = raw as unknown as { kind: "tune"; experienceId: string };
        const transition = hostStartTransition(currentState, tune.experienceId);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "enqueue") {
        checkStringArray(raw["experienceIds"], "experienceIds", 1, 16, 1, 128, issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid enqueue action", issues);
        const enqueue = raw as unknown as { kind: "enqueue"; experienceIds: string[] };
        const transition = hostEnqueueTransition(currentState, enqueue.experienceIds);
        if (!transition.ok) return transition;
        return { ok: true, value: { planState: transition.value } };
      }
      if (kind === "flip") {
        const numbersRaw = raw["numbers"];
        if (!isPlainObject(numbersRaw)) {
          return invalidAdapterInput("toSchedulerIntents: flip action requires a numbers object");
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
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid flip numbers", issues);
        const numbers = numbersRaw as unknown as FlipNumbers;
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
      if (kind === "pause") {
        checkId(raw["experienceId"], "experienceId", issues);
        checkOptional(raw["resumeToken"], "resumeToken", (v, p, list) => checkString(v, p, 1, 1024, list), issues);
        if (issues.length > 0) return invalidAdapterInput("toSchedulerIntents: invalid pause action", issues);
        const pause = raw as unknown as { kind: "pause"; experienceId: string; resumeToken?: string };
        return {
          ok: true,
          value: {
            interruptRequested: true,
            ...(pause.resumeToken !== undefined
              ? { resumeTokens: { [pause.experienceId]: pause.resumeToken } }
              : {}),
          },
        };
      }
      if (kind === "stop") {
        return { ok: true, value: { endRequested: true } };
      }
      return invalidAdapterInput("toSchedulerIntents: action kind must be tune, enqueue, flip, pause or stop", issues);
    },

    toOutcomeEvent(report, options) {
      if (!isPlainObject(report)) {
        return invalidAdapterInput("toOutcomeEvent: report must be an object");
      }
      const issues: IssueList = [];
      checkId(report["playoutId"], "playoutId", issues);
      checkTimestamp(report["at"], "at", issues);
      checkId(report["programId"], "programId", issues);
      checkOptional(report["experienceId"], "experienceId", checkId, issues);
      checkOptional(report["decisionId"], "decisionId", checkId, issues);
      checkEnum(
        report["event"],
        "event",
        ["tuned-in", "finished", "left", "hopped", "scrolled", "returned", "thumbed-up", "passed-along", "bookmarked"] as const,
        issues,
      );
      checkOptional(report["positionSeconds"], "positionSeconds", checkNonNegativeNumber, issues);
      checkOptional(report["totalSeconds"], "totalSeconds", checkNonNegativeNumber, issues);
      if (issues.length > 0) {
        return invalidAdapterInput("toOutcomeEvent: invalid playout report", issues);
      }

      // Observation-channel law: only observed evidence classes are
      // accepted on the playout report path (defense in depth for
      // callers that bypass the narrowed input type).
      const evidenceClass = options.evidenceClass;
      if (!(OBSERVED_EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass)) {
        return unsupportedEvidenceClass(
          `toOutcomeEvent: evidenceClass ${String(evidenceClass)} is not an observed class; the playout report channel maps observations only (${OBSERVED_EVIDENCE_CLASSES.join(", ")})`,
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

      const eventType = PLAYOUT_EVENT_TYPES[report.event];
      const metrics: Record<string, number> = {};
      if (report.positionSeconds !== undefined) metrics["positionSeconds"] = report.positionSeconds;
      if (report.totalSeconds !== undefined) metrics["totalSeconds"] = report.totalSeconds;
      if (report.positionSeconds !== undefined && report.totalSeconds !== undefined && report.totalSeconds > 0) {
        metrics["completionRatio"] = Math.round((report.positionSeconds / report.totalSeconds) * 10_000) / 10_000;
      }

      const eventId = deriveId("evt-", "generic-media.outcome-event", {
        tenantId: options.tenant.tenantId,
        playoutId: report.playoutId,
        eventType,
        at: report.at,
      });
      const idempotencyKey = deriveId("evtkey-", "generic-media.outcome-idempotency", {
        tenantId: options.tenant.tenantId,
        playoutId: report.playoutId,
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
        provenance: { system: "generic-media-playout", version: "1" },
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

      // Affinity applies to the program's mapped labels (kind + topics),
      // sorted and capped at 8 (deterministic).
      const labels = sortedUniqueLabels(itemParse.data.labels).slice(0, 8);
      const deltas: PreferenceDelta[] = [];
      for (const label of labels) {
        const dimension = `generic-media.topic-affinity:${label}`;
        const parsed = PreferenceDeltaSchema.safeParse({
          deltaId: deriveId("pd-", "generic-media.preference-delta", {
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
          provenance: { system: "generic-media-adapter", version: "0.1.0" },
          decay: { halfLifeSeconds: 2_592_000 },
          model: { modelId: "generic-media-affinity-v1", version: "1" },
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
