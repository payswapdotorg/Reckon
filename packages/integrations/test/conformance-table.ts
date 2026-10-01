/**
 * W3-007/W3-008 — the shared cross-adapter conformance table.
 *
 * ONE table, FOUR reference adapters (WebFlix W3-005, generic media
 * W3-006, commerce W3-007, advertising W3-008): each binding maps a
 * DOMAIN-DIFFERENT, structurally parallel host fixture into the SAME
 * frozen normalized contracts and runs the SAME vertical stage
 * sequence through the real W2 kernels.
 *
 * Consumed by:
 * - packages/integrations/test/conformance.test.ts (the in-package
 *   conformance proof — schema identity, identical verticals,
 *   vocabulary isolation, host-boundary import law);
 * - tests/conformance/cross-adapter.test.ts (the top-level
 *   cross-adapter conformance suite).
 *
 * Fixture law: every fixture is caller-supplied-timestamps-only,
 * deterministic, and fixture evidence — nothing here proves a live
 * provider integration (every adapter declaration says fixture-only).
 */
import type {
  AttentionPolicy,
  CatalogItem,
  CandidateSet,
  ContextSnapshot,
  Objective,
  OutcomeEvent,
  PreferenceDelta,
  Realization,
  SubjectReference,
  TenantScope,
} from "@reckon/contracts";
import type { PlanState } from "../../scheduler/src/index.js";
import type { FormatKind, ObjectiveFitFn } from "../../experience/src/index.js";
import type { AdapterDeclaration, HostSchedulerIntents } from "../src/index.js";
import type { AdapterResult } from "../src/errors.js";
import {
  createWebFlixAdapter,
  createMediaAdapter,
  createCommerceAdapter,
  createAdvertisingAdapter,
  type AdCatalogImport,
  type AdHostAction,
  type AdServingReport,
  type CampaignAim,
  type CampaignMixFeed,
  type AdServingSession,
  type CommerceCatalogImport,
  type CommerceHostAction,
  type CommercePurchaseReport,
  type MerchandisingSlate,
  type ShoppingSession,
  type ShoppingPurpose,
  type ListeningSession,
  type MediaHostAction,
  type PlayoutReport,
  type ProgramGuideExport,
  type TopicFeed,
  type WebFlixCatalogImport,
  type WebFlixHostAction,
  type WebFlixPlaybackReport,
  type WebFlixRecommendationFeed,
  type WebFlixViewingSession,
} from "../src/index.js";
import type { Experience } from "@reckon/contracts";
import { idleState, runVertical, unwrapVertical, type VerticalOutput } from "./vertical.js";

// ---------------------------------------------------------------------------
// Shared conformance constants (deterministic, fixture-only)
// ---------------------------------------------------------------------------

export const CONFORMANCE_TENANT = { tenantId: "cf-tenant" };
export const CONFORMANCE_SUBJECT = { kind: "user" as const, ref: "cf-subject-1" };

export const T0 = 1_735_689_600_000; // fixture epoch
export const T1 = T0 + 3_600_000; // decision 1
export const T2 = T0 + 3_660_000; // decision 2 (switch)
export const T3 = T0 + 7_200_000; // observed outcomes

/** Caller-supplied switch numbers shared by every binding (SEPARATION
 *  LAW: identical numbers across adapters — net 0.65 > 0.5 ⇒ SWITCH). */
export const CONFORMANCE_SWITCH_NUMBERS = {
  expectedImprovement: 0.9,
  interruptionCost: 0.1,
  uncertaintyPenalty: 0.1,
  resumeLoss: 0.05,
  switchThreshold: 0.5,
  suggestThreshold: 0.2,
} as const;

/** Caller-supplied switch numbers shared by every binding that land in
 *  the SUGGEST band (net ≈ 0.25 ∈ (suggestThreshold 0.2, switchThreshold
 *  0.5) ⇒ SUGGEST — a suggestion is non-binding and never interrupts;
 *  the numbers avoid the exact band edges so floating-point arithmetic
 *  can never flip the verdict). Consumed by the W3-009 cross-domain E2E
 *  interleaved scenario. */
export const CONFORMANCE_SUGGEST_NUMBERS = {
  expectedImprovement: 0.5,
  interruptionCost: 0.1,
  uncertaintyPenalty: 0.1,
  resumeLoss: 0.05,
  switchThreshold: 0.5,
  suggestThreshold: 0.2,
} as const;

// ---------------------------------------------------------------------------
// The conformance binding (one per reference adapter)
// ---------------------------------------------------------------------------

/**
 * A completion-shaped observation the binding maps to an OutcomeEvent.
 *
 * W3-009 extension: `reportId`, `event`, `at`, `tenant`, `subject` and
 * the optionality of `experienceId`/`decisionId` let the cross-domain
 * E2E emit MULTIPLE distinct observations per adapter (distinct report
 * ids keep the adapter-derived idempotency keys distinct) including
 * honestly UNLINKED observations (no decisionId). Every default keeps
 * the historical conformance behavior byte-identical.
 */
export interface ConformanceObservation {
  /** The item the observation is about (adapter's own id vocabulary). */
  itemId: string;
  /** The experience the observation is about (absent for observations
   *  that did not come from a Reckon experience). */
  experienceId?: string;
  /** The decision the observation is evidence for (absent for
   *  observations that no decision caused — honest unlinkage). */
  decisionId?: string;
  /** Host observation/report id (default: the historical fixture id). */
  reportId?: string;
  /** Host observation kind in the ADAPTER's own vocabulary (default:
   *  the completion-shaped event of the binding). */
  event?: string;
  /** Caller-supplied occurrence time (default: T3). */
  at?: number;
  /** Tenant scope of the outcome (default: the conformance tenant). */
  tenant?: TenantScope;
  /** Subject of the outcome (default: the conformance subject). */
  subject?: SubjectReference;
}

/**
 * One adapter binding in the shared conformance table: the adapter's
 * mapped contract records plus the closures that exercise its
 * host-action and observation channels with the shared constants.
 */
export interface ConformanceBinding {
  /** Short label ("webflix" | "generic-media" | "commerce" | "advertising"). */
  label: string;
  /** Adapter domain (declaration.domain). */
  domain: string;
  /** The adapter's declaration (checked for fixture-only status). */
  declaration: AdapterDeclaration;
  /** Adapter source module path (relative to this package) for the
   *  vocabulary-isolation and import-law proofs. */
  sourceModule: string;
  /** Words from OTHER domains that must not appear in the adapter
   *  module's code (comments stripped). Each entry is a REGEX SOURCE
   *  matched case-insensitively at a word boundary (the Reckon
   *  governance term "production" is explicitly excluded from the
   *  commerce-vocabulary check via a negative lookahead). */
  forbiddenVocabulary: readonly string[];

  // --- Mapped contract records (structurally parallel fixtures).
  items: CatalogItem[];
  realizations: Realization[];
  context: ContextSnapshot;
  candidateSet: CandidateSet;
  objective: Objective;
  attentionPolicy: AttentionPolicy;
  objectiveFit: ObjectiveFitFn;
  /** Host format policy that admits every fixture realization format. */
  allowedFormats: FormatKind[];
  /** Expected expanded experience count on decision 1. */
  expectedExperienceCount: number;
  /** The retrieval row referencing an unknown item (honest absence). */
  ghostItemId: string;
  /** The best-fit item expected to be queued first (alpha). */
  alphaItemId: string;
  /** The item the switch lands on (beta — exactly two mapped labels). */
  betaItemId: string;

  // --- Host-action channels (typed closures over each adapter).
  /** Host-authoritative "start presenting" action. */
  hostStart: (experienceId: string, state: PlanState) => AdapterResult<HostSchedulerIntents>;
  /** Host "switch" action carrying the shared conformance numbers. */
  hostSwitch: (fromExperienceId: string, toExperienceId: string, state: PlanState) => AdapterResult<HostSchedulerIntents>;
  /**
   * Host "switch" action whose shared numbers land in the SUGGEST band
   *   (W3-009: net 0.2 ∈ [suggestThreshold, switchThreshold) ⇒ SUGGEST —
   *   non-binding, never interrupts).
   */
  hostSuggest: (fromExperienceId: string, toExperienceId: string, state: PlanState) => AdapterResult<HostSchedulerIntents>;
  /**
   * Host "interrupt" action (W3-009: pause/suspend/cut), optionally
   * carrying a caller-supplied resume token for the interrupted
   * experience (tokens are never invented).
   */
  hostInterrupt: (experienceId: string, state: PlanState, resumeToken?: string) => AdapterResult<HostSchedulerIntents>;
  /** Host "end" action (W3-009: stop/abandon/wrap — host-driven END). */
  hostEnd: (state: PlanState) => AdapterResult<HostSchedulerIntents>;
  /** Caller-supplied resume token for the switch checkpoint. */
  resumeToken: string;

  // --- Observation channel (completion-shaped, observed class).
  /** Map a completion-shaped observation to an OutcomeEvent. */
  toOutcomeEvent: (observation: ConformanceObservation) => AdapterResult<OutcomeEvent>;
  /** Observed outcome + item → the adapter's affinity PreferenceDeltas. */
  toPreferenceDeltas: (outcome: OutcomeEvent, item: CatalogItem) => AdapterResult<PreferenceDelta[]>;
  /** The adapter's own affinity dimension prefix. */
  deltaDimensionPrefix: string;
}

// ---------------------------------------------------------------------------
// Binding 1: WebFlix (W3-005) — media vocabulary
// ---------------------------------------------------------------------------

const webflix = createWebFlixAdapter();

const webflixFixture = {
  catalog: {
    source: "webflix-catalog-export",
    exportedAt: T0,
    items: [
      {
        mediaId: "cf-m-alpha",
        title: "Alpha Horizon",
        mediaType: "documentary",
        genres: ["nature", "documentary"],
        availableFrom: T0,
        availableUntil: T0 + 2_592_000_000,
        rightsTags: ["basic"],
        playbacks: [
          {
            optionId: "cf-r-alpha-1",
            surface: "tv-app",
            locale: "en",
            maxResolution: "1080p",
            audioTracks: ["en"],
            durationSeconds: 2400,
            downloadable: false,
            offlineEligible: false,
            variants: ["clip"],
          },
        ],
      },
      {
        mediaId: "cf-m-beta",
        title: "Beta Streets",
        mediaType: "series",
        genres: ["drama"],
        rightsTags: ["basic"],
        playbacks: [
          {
            optionId: "cf-r-beta-1",
            surface: "web-player",
            maxResolution: "720p",
            audioTracks: ["en"],
            durationSeconds: 1500,
            downloadable: false,
            offlineEligible: false,
          },
        ],
      },
      {
        mediaId: "cf-m-gamma",
        title: "Gamma Pulse",
        mediaType: "short",
        genres: ["science"],
        rightsTags: ["free"],
        playbacks: [
          {
            optionId: "cf-r-gamma-1",
            surface: "mobile-app",
            maxResolution: "480p",
            audioTracks: ["en"],
            durationSeconds: 300,
            downloadable: false,
            offlineEligible: false,
          },
        ],
      },
    ],
  } as WebFlixCatalogImport,
  feed: {
    feedId: "cf-feed-1",
    source: "webflix-recommender",
    rows: [
      { mediaId: "cf-m-alpha", rank: 1 },
      { mediaId: "cf-m-beta", rank: 2 },
      { mediaId: "cf-m-gamma", rank: 3 },
      { mediaId: "cf-m-ghost", rank: 4 },
    ],
  } as WebFlixRecommendationFeed,
  session: {
    profileId: "cf-user-1",
    sessionId: "cf-ctx-1",
    at: T1,
    deviceKind: "living-room-tv" as const,
    networkKind: "wifi" as const,
    localTime: "20:15",
    timezone: "Europe/Berlin",
    minutesAvailable: 45,
    recentInterruptions: 1,
    continuing: true,
  } as WebFlixViewingSession,
  goal: { goal: "relax" as const, tasteGenres: ["nature", "documentary", "drama"] },
  style: "balanced" as const,
};

// ---------------------------------------------------------------------------
// Binding 2: generic media (W3-006) — different media vocabulary
// ---------------------------------------------------------------------------

const media = createMediaAdapter();

const mediaFixture = {
  guide: {
    guideId: "cf-guide-1",
    exportedAt: T0,
    entries: [
      {
        programId: "cf-p-alpha",
        name: "Alpha Wilderness Hour",
        programKind: "episode",
        topics: ["nature", "documentary"],
        windowOpensAt: T0,
        windowClosesAt: T0 + 2_592_000_000,
        licenseScope: ["standard"],
        renditions: [
          {
            renditionId: "cf-x-alpha-1",
            surface: "live-stream",
            primaryLanguage: "en",
            languages: ["en"],
            bitrateKbps: 128,
            durationSeconds: 2400,
            formatVariants: ["clip"],
            offlineCapable: false,
          },
        ],
      },
      {
        programId: "cf-p-beta",
        name: "Beta City Diaries",
        programKind: "live",
        topics: ["drama"],
        licenseScope: ["standard"],
        renditions: [
          {
            renditionId: "cf-x-beta-1",
            surface: "web-embed",
            languages: ["en"],
            bitrateKbps: 96,
            durationSeconds: 1500,
            offlineCapable: false,
          },
        ],
      },
      {
        programId: "cf-p-gamma",
        name: "Gamma Minutes",
        programKind: "story",
        topics: ["science"],
        licenseScope: ["standard"],
        renditions: [
          {
            renditionId: "cf-x-gamma-1",
            surface: "podcast-app",
            languages: ["en"],
            bitrateKbps: 64,
            durationSeconds: 300,
            offlineCapable: true,
          },
        ],
      },
    ],
  } as ProgramGuideExport,
  feed: {
    feedId: "cf-feed-2",
    curator: "topic-curator",
    picks: [
      { programId: "cf-p-alpha", position: 1 },
      { programId: "cf-p-beta", position: 2 },
      { programId: "cf-p-gamma", position: 3 },
      { programId: "cf-p-ghost", position: 4 },
    ],
  } as TopicFeed,
  session: {
    listenerId: "cf-listener-1",
    sessionId: "cf-ctx-2",
    at: T1,
    apparatus: "tv" as const,
    networkKind: "wifi" as const,
    localTime: "20:15",
    timezone: "Europe/Berlin",
    minutesAvailable: 45,
    interruptionCount: 1,
    resuming: true,
  } as ListeningSession,
  goal: { aim: "unwind" as const, favoriteTopics: ["nature", "documentary", "drama"] },
  style: "steady" as const,
};

// ---------------------------------------------------------------------------
// Binding 3: commerce (W3-007) — product/offer vocabulary
// ---------------------------------------------------------------------------

const commerce = createCommerceAdapter();

const commerceFixture = {
  catalog: {
    merchant: "cf-merchant-export",
    exportedAt: T0,
    products: [
      {
        productId: "cf-pr-alpha",
        name: "Alpha Trail Kit",
        productKind: "physical",
        categories: ["outdoor", "gear"],
        saleStartsAt: T0,
        saleEndsAt: T0 + 2_592_000_000,
        commercePolicyTags: ["standard-listing"],
        offers: [
          {
            offerId: "cf-off-alpha-1",
            surface: "checkout",
            locale: "en",
            currency: "USD",
            priceAmount: 129,
            fulfillment: "shipping",
            inStock: true,
            presentSeconds: 90,
            presentations: ["card"],
          },
        ],
      },
      {
        productId: "cf-pr-beta",
        name: "Beta Rain Shell",
        productKind: "physical",
        categories: ["apparel"],
        commercePolicyTags: ["standard-listing"],
        offers: [
          {
            offerId: "cf-off-beta-1",
            surface: "product-page",
            currency: "USD",
            priceAmount: 89,
            fulfillment: "shipping",
            inStock: true,
            presentSeconds: 75,
          },
        ],
      },
      {
        productId: "cf-pr-gamma",
        name: "Gamma Notes",
        productKind: "subscription",
        categories: ["software"],
        commercePolicyTags: ["premium-listing"],
        offers: [
          {
            offerId: "cf-off-gamma-1",
            surface: "shop-app",
            currency: "USD",
            priceAmount: 39,
            fulfillment: "digital-delivery",
            inStock: true,
            presentSeconds: 45,
          },
        ],
      },
    ],
  } as CommerceCatalogImport,
  slate: {
    slateId: "cf-slate-1",
    merchant: "cf-merchandiser",
    rows: [
      { productId: "cf-pr-alpha", rank: 1 },
      { productId: "cf-pr-beta", rank: 2 },
      { productId: "cf-pr-gamma", rank: 3 },
      { productId: "cf-pr-ghost", rank: 4 },
    ],
  } as MerchandisingSlate,
  session: {
    shopperId: "cf-shopper-1",
    sessionId: "cf-ctx-3",
    at: T1,
    device: "desktop" as const,
    networkKind: "wifi" as const,
    localTime: "20:15",
    timezone: "Europe/Berlin",
    minutesAvailable: 45,
    recentPrompts: 1,
    midVisit: true,
  } as ShoppingSession,
  purpose: { purpose: "replenish" as const, interestCategories: ["outdoor", "gear", "apparel"] },
  mode: "casual" as const,
};

// ---------------------------------------------------------------------------
// Binding 4: advertising (W3-008) — creative/placement vocabulary
// ---------------------------------------------------------------------------

const advertising = createAdvertisingAdapter();

const advertisingFixture = {
  catalog: {
    adServer: "cf-ad-server-export",
    exportedAt: T0,
    creatives: [
      {
        creativeId: "cf-cr-alpha",
        name: "Alpha Ridge 15s",
        creativeKind: "video-spot",
        topics: ["outdoor", "trail"],
        flightStartsAt: T0,
        flightEndsAt: T0 + 2_592_000_000,
        policyTags: ["brand-safe"],
        placements: [
          {
            placementId: "cf-pl-alpha-1",
            surface: "in-stream",
            locale: "en",
            maxDurationSeconds: 15,
            skippable: true,
            alternateCuts: ["clip"],
          },
        ],
      },
      {
        creativeId: "cf-cr-beta",
        name: "Beta Cloud Banner",
        creativeKind: "display-banner",
        topics: ["software"],
        policyTags: ["brand-safe"],
        placements: [
          {
            placementId: "cf-pl-beta-1",
            surface: "banner-slot",
            maxDurationSeconds: 5,
            skippable: true,
          },
        ],
      },
      {
        creativeId: "cf-cr-gamma",
        name: "Gamma Cereal Card",
        creativeKind: "sponsored-listing",
        topics: ["grocery"],
        policyTags: ["reviewed"],
        placements: [
          {
            placementId: "cf-pl-gamma-1",
            surface: "feed-slot",
            maxDurationSeconds: 10,
            skippable: false,
          },
        ],
      },
    ],
  } as AdCatalogImport,
  mix: {
    feedId: "cf-mix-1",
    mixer: "cf-campaign-mixer",
    rows: [
      { creativeId: "cf-cr-alpha", rank: 1 },
      { creativeId: "cf-cr-beta", rank: 2 },
      { creativeId: "cf-cr-gamma", rank: 3 },
      { creativeId: "cf-cr-ghost", rank: 4 },
    ],
  } as CampaignMixFeed,
  session: {
    viewerId: "cf-viewer-1",
    sessionId: "cf-ctx-4",
    at: T1,
    device: "connected-tv" as const,
    networkKind: "wifi" as const,
    localTime: "20:15",
    timezone: "Europe/Berlin",
    minutesAvailable: 45,
    recentAdBreaks: 1,
    midBreak: true,
  } as AdServingSession,
  aim: { aim: "awareness" as const, targetingTopics: ["outdoor", "trail", "software"] },
  mode: "standard" as const,
};

// ---------------------------------------------------------------------------
// Table construction (fail-fast: a broken mapping fails every consumer)
// ---------------------------------------------------------------------------

function mustMap<T>(label: string, result: AdapterResult<T>): T {
  if (!result.ok) {
    throw new Error(`conformance table: ${label} mapping failed: ${result.error.message}`);
  }
  return result.value;
}

function buildWebFlixBinding(): ConformanceBinding {
  const catalog = mustMap("webflix catalog", webflix.importCatalog(webflixFixture.catalog));
  const context = mustMap("webflix context", webflix.toContextSnapshot(webflixFixture.session));
  const candidateSet = mustMap("webflix candidates", webflix.toCandidateSet(webflixFixture.feed));
  const objective = mustMap("webflix objective", webflix.toObjective(webflixFixture.goal));
  const attentionPolicy = mustMap("webflix attention", webflix.toAttentionPolicy(webflixFixture.style));
  return {
    label: "webflix",
    domain: webflix.declaration.domain,
    declaration: webflix.declaration,
    sourceModule: "../src/webflix.ts",
    forbiddenVocabulary: [],
    items: catalog.items,
    realizations: catalog.realizations,
    context,
    candidateSet,
    objective,
    attentionPolicy,
    objectiveFit: webflix.toObjectiveFit(catalog.items),
    allowedFormats: ["full", "clip", "segment", "subtitled"],
    expectedExperienceCount: 4,
    ghostItemId: "cf-m-ghost",
    alphaItemId: "cf-m-alpha",
    betaItemId: "cf-m-beta",
    hostStart: (experienceId, state) =>
      webflix.toSchedulerIntents({ kind: "play", experienceId } as WebFlixHostAction, state),
    hostSwitch: (fromExperienceId, toExperienceId, state) =>
      webflix.toSchedulerIntents(
        { kind: "switch", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SWITCH_NUMBERS } } as WebFlixHostAction,
        state,
      ),
    hostSuggest: (fromExperienceId, toExperienceId, state) =>
      webflix.toSchedulerIntents(
        { kind: "switch", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SUGGEST_NUMBERS } } as WebFlixHostAction,
        state,
      ),
    hostInterrupt: (experienceId, state, resumeToken) =>
      webflix.toSchedulerIntents(
        { kind: "interrupt", experienceId, ...(resumeToken !== undefined ? { resumeToken } : {}) } as WebFlixHostAction,
        state,
      ),
    hostEnd: (state) => webflix.toSchedulerIntents({ kind: "end" } as WebFlixHostAction, state),
    resumeToken: "cf-resume-wf-1",
    toOutcomeEvent: (observation) =>
      webflix.toOutcomeEvent(
        {
          playbackId: observation.reportId ?? "cf-pb-1",
          at: observation.at ?? T3,
          mediaId: observation.itemId,
          ...(observation.experienceId !== undefined ? { experienceId: observation.experienceId } : {}),
          ...(observation.decisionId !== undefined ? { decisionId: observation.decisionId } : {}),
          event: (observation.event ?? "completed") as WebFlixPlaybackReport["event"],
          positionSeconds: 1500,
          totalSeconds: 1500,
        } as WebFlixPlaybackReport,
        {
          tenant: observation.tenant ?? CONFORMANCE_TENANT,
          subject: observation.subject ?? CONFORMANCE_SUBJECT,
          evidenceClass: "controlled-local",
          contextId: context.contextId,
        },
      ),
    toPreferenceDeltas: (outcome, item) => webflix.toPreferenceDeltas(outcome, item),
    deltaDimensionPrefix: "webflix.genre-affinity",
  };
}

function buildMediaBinding(): ConformanceBinding {
  const guide = mustMap("media guide", media.importProgramGuide(mediaFixture.guide));
  const context = mustMap("media context", media.toContextSnapshot(mediaFixture.session));
  const candidateSet = mustMap("media candidates", media.toCandidateSet(mediaFixture.feed));
  const objective = mustMap("media objective", media.toObjective(mediaFixture.goal));
  const attentionPolicy = mustMap("media attention", media.toAttentionPolicy(mediaFixture.style));
  return {
    label: "generic-media",
    domain: media.declaration.domain,
    declaration: media.declaration,
    sourceModule: "../src/media.ts",
    forbiddenVocabulary: ["webflix"],
    items: guide.items,
    realizations: guide.realizations,
    context,
    candidateSet,
    objective,
    attentionPolicy,
    objectiveFit: media.toTopicFit(guide.items),
    allowedFormats: ["full", "clip", "segment", "subtitled"],
    expectedExperienceCount: 4,
    ghostItemId: "cf-p-ghost",
    alphaItemId: "cf-p-alpha",
    betaItemId: "cf-p-beta",
    hostStart: (experienceId, state) =>
      media.toSchedulerIntents({ kind: "tune", experienceId } as MediaHostAction, state),
    hostSwitch: (fromExperienceId, toExperienceId, state) =>
      media.toSchedulerIntents(
        { kind: "flip", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SWITCH_NUMBERS } } as MediaHostAction,
        state,
      ),
    hostSuggest: (fromExperienceId, toExperienceId, state) =>
      media.toSchedulerIntents(
        { kind: "flip", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SUGGEST_NUMBERS } } as MediaHostAction,
        state,
      ),
    hostInterrupt: (experienceId, state, resumeToken) =>
      media.toSchedulerIntents(
        { kind: "pause", experienceId, ...(resumeToken !== undefined ? { resumeToken } : {}) } as MediaHostAction,
        state,
      ),
    hostEnd: (state) => media.toSchedulerIntents({ kind: "stop" } as MediaHostAction, state),
    resumeToken: "cf-resume-gm-1",
    toOutcomeEvent: (observation) =>
      media.toOutcomeEvent(
        {
          playoutId: observation.reportId ?? "cf-pl-1",
          at: observation.at ?? T3,
          programId: observation.itemId,
          ...(observation.experienceId !== undefined ? { experienceId: observation.experienceId } : {}),
          ...(observation.decisionId !== undefined ? { decisionId: observation.decisionId } : {}),
          event: (observation.event ?? "finished") as PlayoutReport["event"],
          positionSeconds: 1500,
          totalSeconds: 1500,
        } as PlayoutReport,
        {
          tenant: observation.tenant ?? CONFORMANCE_TENANT,
          subject: observation.subject ?? CONFORMANCE_SUBJECT,
          evidenceClass: "controlled-local",
          contextId: context.contextId,
        },
      ),
    toPreferenceDeltas: (outcome, item) => media.toPreferenceDeltas(outcome, item),
    deltaDimensionPrefix: "generic-media.topic-affinity",
  };
}

function buildCommerceBinding(): ConformanceBinding {
  const catalog = mustMap("commerce catalog", commerce.importCatalog(commerceFixture.catalog));
  const context = mustMap("commerce context", commerce.toContextSnapshot(commerceFixture.session));
  const candidateSet = mustMap("commerce candidates", commerce.toCandidateSet(commerceFixture.slate));
  const objective = mustMap("commerce objective", commerce.toObjective(commerceFixture.purpose));
  const attentionPolicy = mustMap("commerce attention", commerce.toAttentionPolicy(commerceFixture.mode));
  return {
    label: "commerce",
    domain: commerce.declaration.domain,
    declaration: commerce.declaration,
    sourceModule: "../src/commerce.ts",
    forbiddenVocabulary: [
      "webflix",
      "media",
      "advertis",
      "creative",
      "placement",
      "impression",
      "campaign",
      "banner",
      "spot",
      "rendition",
      "program",
      "genre",
      "playback",
      "viewing",
      "listening",
    ],
    items: catalog.items,
    realizations: catalog.realizations,
    context,
    candidateSet,
    objective,
    attentionPolicy,
    objectiveFit: commerce.toObjectiveFit(catalog.items),
    allowedFormats: ["full", "card"],
    expectedExperienceCount: 4,
    ghostItemId: "cf-pr-ghost",
    alphaItemId: "cf-pr-alpha",
    betaItemId: "cf-pr-beta",
    hostStart: (experienceId, state) =>
      commerce.toSchedulerIntents({ kind: "present", experienceId } as CommerceHostAction, state),
    hostSwitch: (fromExperienceId, toExperienceId, state) =>
      commerce.toSchedulerIntents(
        { kind: "swap", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SWITCH_NUMBERS } } as CommerceHostAction,
        state,
      ),
    hostSuggest: (fromExperienceId, toExperienceId, state) =>
      commerce.toSchedulerIntents(
        { kind: "swap", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SUGGEST_NUMBERS } } as CommerceHostAction,
        state,
      ),
    hostInterrupt: (experienceId, state, resumeToken) =>
      commerce.toSchedulerIntents(
        { kind: "suspend", experienceId, ...(resumeToken !== undefined ? { resumeToken } : {}) } as CommerceHostAction,
        state,
      ),
    hostEnd: (state) => commerce.toSchedulerIntents({ kind: "abandon" } as CommerceHostAction, state),
    resumeToken: "cf-resume-co-1",
    toOutcomeEvent: (observation) =>
      commerce.toOutcomeEvent(
        {
          purchaseId: observation.reportId ?? "cf-purchase-1",
          at: observation.at ?? T3,
          productId: observation.itemId,
          ...(observation.experienceId !== undefined ? { experienceId: observation.experienceId } : {}),
          ...(observation.decisionId !== undefined ? { decisionId: observation.decisionId } : {}),
          event: (observation.event ?? "order-completed") as CommercePurchaseReport["event"],
          cartValue: 104,
          orderValue: 89,
          quantity: 1,
        } as CommercePurchaseReport,
        {
          tenant: observation.tenant ?? CONFORMANCE_TENANT,
          subject: observation.subject ?? CONFORMANCE_SUBJECT,
          evidenceClass: "controlled-local",
          contextId: context.contextId,
        },
      ),
    toPreferenceDeltas: (outcome, item) => commerce.toPreferenceDeltas(outcome, item),
    deltaDimensionPrefix: "commerce.category-affinity",
  };
}

function buildAdvertisingBinding(): ConformanceBinding {
  const catalog = mustMap("advertising catalog", advertising.importCatalog(advertisingFixture.catalog));
  const context = mustMap("advertising context", advertising.toContextSnapshot(advertisingFixture.session));
  const candidateSet = mustMap("advertising candidates", advertising.toCandidateSet(advertisingFixture.mix));
  const objective = mustMap("advertising objective", advertising.toObjective(advertisingFixture.aim));
  const attentionPolicy = mustMap("advertising attention", advertising.toAttentionPolicy(advertisingFixture.mode));
  return {
    label: "advertising",
    domain: advertising.declaration.domain,
    declaration: advertising.declaration,
    sourceModule: "../src/advertising.ts",
    forbiddenVocabulary: [
      "webflix",
      "media",
      "commerce",
      "product(?!-?ion)",
      "offer",
      "cart",
      "checkout",
      "purchase",
      "merchandis",
      "shopper",
      "storefront",
      "shop",
      "genre",
      "playback",
      "viewing",
      "listening",
    ],
    items: catalog.items,
    realizations: catalog.realizations,
    context,
    candidateSet,
    objective,
    attentionPolicy,
    objectiveFit: advertising.toObjectiveFit(catalog.items),
    allowedFormats: ["full", "clip", "banner", "in-feed", "interstitial"],
    expectedExperienceCount: 4,
    ghostItemId: "cf-cr-ghost",
    alphaItemId: "cf-cr-alpha",
    betaItemId: "cf-cr-beta",
    hostStart: (experienceId, state) =>
      advertising.toSchedulerIntents({ kind: "show", experienceId } as AdHostAction, state),
    hostSwitch: (fromExperienceId, toExperienceId, state) =>
      advertising.toSchedulerIntents(
        { kind: "rotate", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SWITCH_NUMBERS } } as AdHostAction,
        state,
      ),
    hostSuggest: (fromExperienceId, toExperienceId, state) =>
      advertising.toSchedulerIntents(
        { kind: "rotate", numbers: { fromExperienceId, toExperienceId, ...CONFORMANCE_SUGGEST_NUMBERS } } as AdHostAction,
        state,
      ),
    hostInterrupt: (experienceId, state, resumeToken) =>
      advertising.toSchedulerIntents(
        { kind: "cut", experienceId, ...(resumeToken !== undefined ? { resumeToken } : {}) } as AdHostAction,
        state,
      ),
    hostEnd: (state) => advertising.toSchedulerIntents({ kind: "wrap" } as AdHostAction, state),
    resumeToken: "cf-resume-ad-1",
    toOutcomeEvent: (observation) =>
      advertising.toOutcomeEvent(
        {
          impressionId: observation.reportId ?? "cf-imp-1",
          at: observation.at ?? T3,
          creativeId: observation.itemId,
          ...(observation.experienceId !== undefined ? { experienceId: observation.experienceId } : {}),
          ...(observation.decisionId !== undefined ? { decisionId: observation.decisionId } : {}),
          event: (observation.event ?? "viewed-through") as AdServingReport["event"],
          viewSeconds: 5,
          totalSeconds: 5,
        } as AdServingReport,
        {
          tenant: observation.tenant ?? CONFORMANCE_TENANT,
          subject: observation.subject ?? CONFORMANCE_SUBJECT,
          evidenceClass: "controlled-local",
          contextId: context.contextId,
        },
      ),
    toPreferenceDeltas: (outcome, item) => advertising.toPreferenceDeltas(outcome, item),
    deltaDimensionPrefix: "advertising.topic-affinity",
  };
}

/** The shared four-adapter conformance table (W3-005 + W3-006 + W3-007 + W3-008). */
export function buildConformanceTable(): ConformanceBinding[] {
  return [
    buildWebFlixBinding(),
    buildMediaBinding(),
    buildCommerceBinding(),
    buildAdvertisingBinding(),
  ];
}

// ---------------------------------------------------------------------------
// The shared vertical stage sequence (identical for every binding)
// ---------------------------------------------------------------------------

/** Every artifact of one conformance vertical run. */
export interface ConformanceVerticalArtifacts {
  /** Decision 1 (idle, balanced policy): QUEUE the best candidate. */
  run1: VerticalOutput;
  /** The host-authoritative start (play/tune/present/show). */
  startIntents: HostSchedulerIntents;
  /** The experience that started (the best-fit alpha experience). */
  currentExperience: Experience;
  /** Decision 2 (playing + shared switch numbers): SWITCH to beta. */
  run2: VerticalOutput;
  /** The item the switch landed on (beta). */
  targetItem: CatalogItem;
  /** The completion-shaped observed outcome for the switched-to item. */
  outcome: OutcomeEvent;
  /** The adapter's own affinity deltas derived from the outcome. */
  deltas: PreferenceDelta[];
}

/**
 * Run the IDENTICAL vertical stage sequence for one binding through
 * the real W2 kernels:
 *
 *   QUEUE (decision 1, idle + balanced) → host start (host-
 *   authoritative) → SWITCH (decision 2, shared caller-supplied
 *   numbers + resume token) → observed completion outcome →
 *   preference deltas.
 *
 * Throws with a typed message when any stage fails (the conformance
 * suites assert the invariants on the returned artifacts).
 */
export function runConformanceVertical(binding: ConformanceBinding): ConformanceVerticalArtifacts {
  // Decision 1: idle + balanced attention policy ⇒ QUEUE.
  const vertical1 = runVertical({
    tenant: CONFORMANCE_TENANT,
    subject: CONFORMANCE_SUBJECT,
    objective: binding.objective,
    attentionPolicy: binding.attentionPolicy,
    context: binding.context,
    candidateSet: binding.candidateSet,
    items: binding.items,
    realizations: binding.realizations,
    constraints: [],
    allowedFormats: binding.allowedFormats,
    objectiveFit: binding.objectiveFit,
    policySelector: { policyId: "cf-policy", version: "1" },
    at: T1,
    requestId: "cf-req-1",
    idempotencyKey: "cf-idem-1",
  });
  const run1 = unwrapVertical(vertical1);
  const selectedId = run1.decision.selectedExperienceId;
  if (selectedId === undefined) {
    throw new Error(`conformance vertical (${binding.label}): decision 1 selected nothing`);
  }

  // Host-authoritative start.
  const start = binding.hostStart(selectedId, run1.decision.nextState);
  if (!start.ok) {
    throw new Error(`conformance vertical (${binding.label}): host start failed: ${start.error.message}`);
  }
  const currentExperience = run1.expansion.experiences.find(
    (entry) => entry.experience.experienceId === selectedId,
  )?.experience;
  if (currentExperience === undefined) {
    throw new Error(`conformance vertical (${binding.label}): current experience missing`);
  }

  // Host switch action carrying the shared caller-supplied numbers.
  const switchTarget = run1.scored.find(
    (entry) => entry.experience.itemId !== currentExperience.itemId,
  );
  if (switchTarget === undefined) {
    throw new Error(`conformance vertical (${binding.label}): no switch target`);
  }
  const switchResult = binding.hostSwitch(
    selectedId,
    switchTarget.experience.experienceId,
    start.value.planState ?? idleState(),
  );
  if (!switchResult.ok) {
    throw new Error(`conformance vertical (${binding.label}): host switch failed: ${switchResult.error.message}`);
  }

  // Decision 2: playing + switch input + resume token ⇒ SWITCH.
  const vertical2 = runVertical({
    tenant: CONFORMANCE_TENANT,
    subject: CONFORMANCE_SUBJECT,
    objective: binding.objective,
    attentionPolicy: binding.attentionPolicy,
    context: binding.context,
    candidateSet: binding.candidateSet,
    items: binding.items,
    realizations: binding.realizations,
    constraints: [],
    allowedFormats: binding.allowedFormats,
    objectiveFit: binding.objectiveFit,
    policySelector: { policyId: "cf-policy", version: "1" },
    at: T2,
    requestId: "cf-req-2",
    idempotencyKey: "cf-idem-2",
    startState: start.value.planState,
    currentExperience,
    intents: {
      switch: switchResult.value.switch,
      resumeTokens: { [selectedId]: binding.resumeToken },
    },
  });
  const run2 = unwrapVertical(vertical2);
  if (run2.decision.selectedExperienceId === undefined) {
    throw new Error(`conformance vertical (${binding.label}): decision 2 selected nothing`);
  }

  // Observed completion outcome for the switched-to item.
  const targetItem = binding.items.find((item) => item.itemId === switchTarget.experience.itemId);
  if (targetItem === undefined) {
    throw new Error(`conformance vertical (${binding.label}): target item missing`);
  }
  const outcomeResult = binding.toOutcomeEvent({
    itemId: targetItem.itemId,
    experienceId: run2.decision.selectedExperienceId,
    decisionId: run2.result.decisionId,
  });
  if (!outcomeResult.ok) {
    throw new Error(`conformance vertical (${binding.label}): outcome mapping failed: ${outcomeResult.error.message}`);
  }

  // Preference deltas from the observed outcome (adapter vocabulary).
  const deltasResult = binding.toPreferenceDeltas(outcomeResult.value, targetItem);
  if (!deltasResult.ok) {
    throw new Error(`conformance vertical (${binding.label}): delta mapping failed: ${deltasResult.error.message}`);
  }

  return {
    run1,
    startIntents: start.value,
    currentExperience,
    run2,
    targetItem,
    outcome: outcomeResult.value,
    deltas: deltasResult.value,
  };
}

/** The full conformance artifacts for every binding (run once per suite). */
export function runConformanceVerticals(
  table: ConformanceBinding[],
): Map<string, ConformanceVerticalArtifacts> {
  const artifacts = new Map<string, ConformanceVerticalArtifacts>();
  for (const binding of table) {
    artifacts.set(binding.label, runConformanceVertical(binding));
  }
  return artifacts;
}
