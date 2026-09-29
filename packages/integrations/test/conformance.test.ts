/**
 * W3-006 — cross-adapter conformance proof.
 *
 * Asserts that the WebFlix reference adapter (W3-005) and the generic
 * media reference adapter (W3-006) produce SCHEMA-IDENTICAL contract
 * records from DOMAIN-DIFFERENT fixtures: different host naming
 * (media items/genres/playback options vs programs/topics/renditions),
 * same frozen contracts.
 *
 * Concretely, for every contract kind produced on the media vertical —
 * CatalogItem, Realization, ContextSnapshot, CandidateSet, Objective,
 * AttentionPolicy, Experience, DecisionRequest, DecisionResult,
 * OutcomeEvent, PreferenceDelta — this suite proves:
 * 1. BOTH adapters' records parse against the SAME frozen zod schema.
 * 2. BOTH carry identical contract id + schemaVersion headers.
 * 3. BOTH are structurally identical (shape signature comparison over
 *    every non-opaque field — the contracts' own host-opaque record
 *    fields are excluded by design).
 * 4. BOTH complete the identical vertical stage sequence
 *    (QUEUE → host play → SWITCH → observed completion outcome →
 *    preference deltas) through the real W2 kernels.
 *
 * Additionally it proves the W3-006 vocabulary law (media.ts contains
 * no WebFlix vocabulary) and the host-boundary law (both adapter
 * modules' static imports are limited to the frozen contracts,
 * type-only kernel seams and local modules — never host persistence).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
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
  CONTRACT_IDS,
  CONTRACT_VERSIONS,
} from "@reckon/contracts";
import {
  createWebFlixAdapter,
  createMediaAdapter,
  WEBFLIX_ADAPTER_DECLARATION,
  GENERIC_MEDIA_ADAPTER_DECLARATION,
  type ListeningAttentionStyle,
  type ListeningGoal,
  type ListeningSession,
  type MediaHostAction,
  type PlayoutReport,
  type ProgramGuideExport,
  type TopicFeed,
  type WebFlixCatalogImport,
  type WebFlixHostAction,
  type WebFlixRecommendationFeed,
  type WebFlixViewingGoal,
  type WebFlixViewingSession,
  type WebFlixViewingStyle,
} from "../src/index.js";
import { expectShapeIdentical, expectValid } from "./helpers.js";
import { runVertical, unwrapVertical } from "./vertical.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const T0 = 1_735_689_600_000; // fixture epoch
const T1 = T0 + 3_600_000; // decision 1
const T2 = T0 + 3_660_000; // decision 2 (switch)
const T3 = T0 + 7_200_000; // outcomes

const webflix = createWebFlixAdapter();
const media = createMediaAdapter();

const TENANT = { tenantId: "cf-tenant" };
const SUBJECT = { kind: "user" as const, ref: "cf-subject-1" };

// ---------------------------------------------------------------------------
// Domain-different, structurally parallel fixtures
// ---------------------------------------------------------------------------

interface WebFlixConformanceFixture {
  catalog: WebFlixCatalogImport;
  feed: WebFlixRecommendationFeed;
  session: WebFlixViewingSession;
  goal: WebFlixViewingGoal;
  style: WebFlixViewingStyle;
}

const webflixFixture: WebFlixConformanceFixture = {
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
  },
  feed: {
    feedId: "cf-feed-1",
    source: "webflix-recommender",
    rows: [
      { mediaId: "cf-m-alpha", rank: 1 },
      { mediaId: "cf-m-beta", rank: 2 },
      { mediaId: "cf-m-gamma", rank: 3 },
      { mediaId: "cf-m-ghost", rank: 4 }, // honest absence on both sides
    ],
  },
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
  },
  goal: { goal: "relax" as const, tasteGenres: ["nature", "documentary", "drama"] },
  style: "balanced" as const,
};

interface MediaConformanceFixture {
  guide: ProgramGuideExport;
  feed: TopicFeed;
  session: ListeningSession;
  goal: ListeningGoal;
  style: ListeningAttentionStyle;
}

const mediaFixture: MediaConformanceFixture = {
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
  },
  feed: {
    feedId: "cf-feed-2",
    curator: "topic-curator",
    picks: [
      { programId: "cf-p-alpha", position: 1 },
      { programId: "cf-p-beta", position: 2 },
      { programId: "cf-p-gamma", position: 3 },
      { programId: "cf-p-ghost", position: 4 }, // honest absence on both sides
    ],
  },
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
  },
  goal: { aim: "unwind" as const, favoriteTopics: ["nature", "documentary", "drama"] },
  style: "steady" as const,
};

// ---------------------------------------------------------------------------
// Mapped contract records from both adapters
// ---------------------------------------------------------------------------

function mapWebFlix() {
  const catalog = webflix.importCatalog(webflixFixture.catalog);
  const context = webflix.toContextSnapshot(webflixFixture.session);
  const candidateSet = webflix.toCandidateSet(webflixFixture.feed);
  const objective = webflix.toObjective(webflixFixture.goal);
  const attentionPolicy = webflix.toAttentionPolicy(webflixFixture.style);
  if (!catalog.ok || !context.ok || !candidateSet.ok || !objective.ok || !attentionPolicy.ok) {
    throw new Error("webflix conformance mapping failed");
  }
  return {
    items: catalog.value.items,
    realizations: catalog.value.realizations,
    context: context.value,
    candidateSet: candidateSet.value,
    objective: objective.value,
    attentionPolicy: attentionPolicy.value,
    objectiveFit: webflix.toObjectiveFit(catalog.value.items),
  };
}

function mapMedia() {
  const guide = media.importProgramGuide(mediaFixture.guide);
  const context = media.toContextSnapshot(mediaFixture.session);
  const candidateSet = media.toCandidateSet(mediaFixture.feed);
  const objective = media.toObjective(mediaFixture.goal);
  const attentionPolicy = media.toAttentionPolicy(mediaFixture.style);
  if (!guide.ok || !context.ok || !candidateSet.ok || !objective.ok || !attentionPolicy.ok) {
    throw new Error("media conformance mapping failed");
  }
  return {
    items: guide.value.items,
    realizations: guide.value.realizations,
    context: context.value,
    candidateSet: candidateSet.value,
    objective: objective.value,
    attentionPolicy: attentionPolicy.value,
    topicFit: media.toTopicFit(guide.value.items),
  };
}

const wf = mapWebFlix();
const gm = mapMedia();

// ---------------------------------------------------------------------------
// 1. Schema-identity of mapped records
// ---------------------------------------------------------------------------

describe("W3-006 conformance: schema-identical contract records from domain-different fixtures", () => {
  it("produces CatalogItem records that parse the same frozen schema with identical contract headers and shape", () => {
    expect(wf.items).toHaveLength(3);
    expect(gm.items).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const wfItem = expectValid(CatalogItemSchema, wf.items[i]);
      const gmItem = expectValid(CatalogItemSchema, gm.items[i]);
      expect(wfItem.schema).toBe(CONTRACT_IDS.catalogItem);
      expect(gmItem.schema).toBe(CONTRACT_IDS.catalogItem);
      expect(wfItem.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.catalogItem]);
      expect(gmItem.schemaVersion).toBe(CONTRACT_VERSIONS[CONTRACT_IDS.catalogItem]);
      expect(wfItem.kind).toBe("media");
      expect(gmItem.kind).toBe("media");
      expectShapeIdentical(`catalogItem[${i}]`, wfItem, gmItem);
    }
  });

  it("produces Realization records that parse the same frozen schema with identical shape", () => {
    expect(wf.realizations).toHaveLength(3);
    expect(gm.realizations).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const wfRealization = expectValid(RealizationSchema, wf.realizations[i]);
      const gmRealization = expectValid(RealizationSchema, gm.realizations[i]);
      expect(wfRealization.schema).toBe(CONTRACT_IDS.realization);
      expect(gmRealization.schema).toBe(CONTRACT_IDS.realization);
      expectShapeIdentical(`realization[${i}]`, wfRealization, gmRealization);
    }
  });

  it("produces ContextSnapshot, CandidateSet, Objective and AttentionPolicy records with identical shape", () => {
    const wfContext = expectValid(ContextSnapshotSchema, wf.context);
    const gmContext = expectValid(ContextSnapshotSchema, gm.context);
    expect(wfContext.schema).toBe(CONTRACT_IDS.contextSnapshot);
    expect(gmContext.schema).toBe(CONTRACT_IDS.contextSnapshot);
    expectShapeIdentical("contextSnapshot", wfContext, gmContext);

    const wfSet = expectValid(CandidateSetSchema, wf.candidateSet);
    const gmSet = expectValid(CandidateSetSchema, gm.candidateSet);
    expectShapeIdentical("candidateSet", wfSet, gmSet);

    const wfObjective = expectValid(ObjectiveSchema, wf.objective);
    const gmObjective = expectValid(ObjectiveSchema, gm.objective);
    expect(wfObjective.kind).toBe(gmObjective.kind); // relax on both
    expectShapeIdentical("objective", wfObjective, gmObjective);

    const wfPolicy = expectValid(AttentionPolicySchema, wf.attentionPolicy);
    const gmPolicy = expectValid(AttentionPolicySchema, gm.attentionPolicy);
    expect(wfPolicy.style).toBe(gmPolicy.style); // balanced on both
    expectShapeIdentical("attentionPolicy", wfPolicy, gmPolicy);
  });
});

// ---------------------------------------------------------------------------
// 2. The identical vertical through the real kernels, both adapters
// ---------------------------------------------------------------------------

describe("W3-006 conformance: identical vertical stages through the real kernels", () => {
  function runBothVerticals() {
    const wfVertical1 = runVertical({
      tenant: TENANT,
      subject: SUBJECT,
      objective: wf.objective,
      attentionPolicy: wf.attentionPolicy,
      context: wf.context,
      candidateSet: wf.candidateSet,
      items: wf.items,
      realizations: wf.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "segment", "subtitled"],
      objectiveFit: wf.objectiveFit,
      policySelector: { policyId: "cf-policy", version: "1" },
      at: T1,
      requestId: "cf-req-1",
      idempotencyKey: "cf-idem-1",
    });
    const gmVertical1 = runVertical({
      tenant: TENANT,
      subject: SUBJECT,
      objective: gm.objective,
      attentionPolicy: gm.attentionPolicy,
      context: gm.context,
      candidateSet: gm.candidateSet,
      items: gm.items,
      realizations: gm.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "segment", "subtitled"],
      objectiveFit: gm.topicFit,
      policySelector: { policyId: "cf-policy", version: "1" },
      at: T1,
      requestId: "cf-req-1",
      idempotencyKey: "cf-idem-1",
    });
    return { wfRun1: unwrapVertical(wfVertical1), gmRun1: unwrapVertical(gmVertical1) };
  }

  it("completes the same stage sequence (QUEUE → host play → SWITCH → observed outcome → deltas) on both adapters", () => {
    const { wfRun1, gmRun1 } = runBothVerticals();

    // --- Stage: experiences (schema-valid, shape-identical).
    expect(wfRun1.expansion.experiences.length).toBe(4); // alpha full+clip, beta, gamma
    expect(gmRun1.expansion.experiences.length).toBe(4);
    for (let i = 0; i < 4; i++) {
      const wfExperience = expectValid(ExperienceSchema, wfRun1.expansion.experiences[i].experience);
      const gmExperience = expectValid(ExperienceSchema, gmRun1.expansion.experiences[i].experience);
      expect(wfExperience.schema).toBe(CONTRACT_IDS.experience);
      expect(gmExperience.schema).toBe(CONTRACT_IDS.experience);
      expectShapeIdentical(`experience[${i}]`, wfExperience, gmExperience);
    }
    // Honest absence on both sides.
    expect(wfRun1.expansion.exclusions.some((e) => e.kind === "candidate-unavailable")).toBe(true);
    expect(gmRun1.expansion.exclusions.some((e) => e.kind === "candidate-unavailable")).toBe(true);

    // --- Stage: decision request + result (QUEUE on both).
    const wfRequest = expectValid(DecisionRequestSchema, wfRun1.request);
    const gmRequest = expectValid(DecisionRequestSchema, gmRun1.request);
    expectShapeIdentical("decisionRequest#1", wfRequest, gmRequest);
    const wfResult = expectValid(DecisionResultSchema, wfRun1.result);
    const gmResult = expectValid(DecisionResultSchema, gmRun1.result);
    expect(wfResult.schema).toBe(CONTRACT_IDS.decisionResult);
    expect(gmResult.schema).toBe(CONTRACT_IDS.decisionResult);
    expect(wfResult.action).toBe("QUEUE");
    expect(gmResult.action).toBe("QUEUE");
    expectShapeIdentical("decisionResult#1", wfResult, gmResult);

    // --- Stage: host play (host-authoritative start on both).
    const wfPlaying = webflix.toSchedulerIntents(
      { kind: "play", experienceId: wfRun1.decision.selectedExperienceId ?? "" } as WebFlixHostAction,
      wfRun1.decision.nextState,
    );
    const gmPlaying = media.toSchedulerIntents(
      { kind: "tune", experienceId: gmRun1.decision.selectedExperienceId ?? "" } as MediaHostAction,
      gmRun1.decision.nextState,
    );
    expect(wfPlaying.ok && gmPlaying.ok).toBe(true);
    if (!wfPlaying.ok || !gmPlaying.ok) throw new Error("host play mapping failed");
    expect(wfPlaying.value.planState?.status).toBe("playing");
    expect(gmPlaying.value.planState?.status).toBe("playing");

    const wfCurrent = wfRun1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === wfRun1.decision.selectedExperienceId,
    )?.experience;
    const gmCurrent = gmRun1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === gmRun1.decision.selectedExperienceId,
    )?.experience;
    expect(wfCurrent).toBeDefined();
    expect(gmCurrent).toBeDefined();
    if (wfCurrent === undefined || gmCurrent === undefined) throw new Error("current experience missing");

    // --- Stage: host switch (caller-supplied numbers on both).
    const wfSwitchTarget = wfRun1.scored.find((entry) => entry.experience.itemId !== wfCurrent.itemId);
    const gmSwitchTarget = gmRun1.scored.find((entry) => entry.experience.itemId !== gmCurrent.itemId);
    expect(wfSwitchTarget).toBeDefined();
    expect(gmSwitchTarget).toBeDefined();
    if (wfSwitchTarget === undefined || gmSwitchTarget === undefined) throw new Error("switch target missing");

    const wfSwitch = webflix.toSchedulerIntents(
      {
        kind: "switch",
        numbers: {
          fromExperienceId: wfCurrent.experienceId,
          toExperienceId: wfSwitchTarget.experience.experienceId,
          expectedImprovement: 0.9,
          interruptionCost: 0.1,
          uncertaintyPenalty: 0.1,
          resumeLoss: 0.05,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      } as WebFlixHostAction,
      wfPlaying.value.planState ?? { status: "idle", queue: [], resumeCheckpoints: [] },
    );
    const gmSwitch = media.toSchedulerIntents(
      {
        kind: "flip",
        numbers: {
          fromExperienceId: gmCurrent.experienceId,
          toExperienceId: gmSwitchTarget.experience.experienceId,
          expectedImprovement: 0.9,
          interruptionCost: 0.1,
          uncertaintyPenalty: 0.1,
          resumeLoss: 0.05,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      } as MediaHostAction,
      gmPlaying.value.planState ?? { status: "idle", queue: [], resumeCheckpoints: [] },
    );
    expect(wfSwitch.ok && gmSwitch.ok).toBe(true);
    if (!wfSwitch.ok || !gmSwitch.ok) throw new Error("host switch mapping failed");
    expectShapeIdentical("switchInput", wfSwitch.value.switch, gmSwitch.value.switch);

    const wfVertical2 = runVertical({
      tenant: TENANT,
      subject: SUBJECT,
      objective: wf.objective,
      attentionPolicy: wf.attentionPolicy,
      context: wf.context,
      candidateSet: wf.candidateSet,
      items: wf.items,
      realizations: wf.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "segment", "subtitled"],
      objectiveFit: wf.objectiveFit,
      policySelector: { policyId: "cf-policy", version: "1" },
      at: T2,
      requestId: "cf-req-2",
      idempotencyKey: "cf-idem-2",
      startState: wfPlaying.value.planState,
      currentExperience: wfCurrent,
      intents: { switch: wfSwitch.value.switch, resumeTokens: { [wfCurrent.experienceId]: "cf-resume-1" } },
    });
    const gmVertical2 = runVertical({
      tenant: TENANT,
      subject: SUBJECT,
      objective: gm.objective,
      attentionPolicy: gm.attentionPolicy,
      context: gm.context,
      candidateSet: gm.candidateSet,
      items: gm.items,
      realizations: gm.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "segment", "subtitled"],
      objectiveFit: gm.topicFit,
      policySelector: { policyId: "cf-policy", version: "1" },
      at: T2,
      requestId: "cf-req-2",
      idempotencyKey: "cf-idem-2",
      startState: gmPlaying.value.planState,
      currentExperience: gmCurrent,
      intents: { switch: gmSwitch.value.switch, resumeTokens: { [gmCurrent.experienceId]: "cf-resume-2" } },
    });
    const wfRun2 = unwrapVertical(wfVertical2);
    const gmRun2 = unwrapVertical(gmVertical2);

    expect(wfRun2.decision.action).toBe("SWITCH");
    expect(gmRun2.decision.action).toBe("SWITCH");
    const wfResult2 = expectValid(DecisionResultSchema, wfRun2.result);
    const gmResult2 = expectValid(DecisionResultSchema, gmRun2.result);
    expectShapeIdentical("decisionRequest#2", expectValid(DecisionRequestSchema, wfRun2.request), expectValid(DecisionRequestSchema, gmRun2.request));
    expectShapeIdentical("decisionResult#2", wfResult2, gmResult2);

    // --- Stage: observed completion outcome for the switched-to item.
    const wfTargetItem = wf.items.find((item) => item.itemId === wfSwitchTarget.experience.itemId);
    const gmTargetItem = gm.items.find((item) => item.itemId === gmSwitchTarget.experience.itemId);
    expect(wfTargetItem).toBeDefined();
    expect(gmTargetItem).toBeDefined();
    if (wfTargetItem === undefined || gmTargetItem === undefined) throw new Error("target item missing");

    const wfOutcomeResult = webflix.toOutcomeEvent(
      {
        playbackId: "cf-pb-1",
        at: T3,
        mediaId: wfTargetItem.itemId,
        experienceId: wfRun2.decision.selectedExperienceId,
        decisionId: wfRun2.result.decisionId,
        event: "completed",
        positionSeconds: 1500,
        totalSeconds: 1500,
      },
      { tenant: TENANT, subject: SUBJECT, evidenceClass: "controlled-local", contextId: wf.context.contextId },
    );
    const gmOutcomeResult = media.toOutcomeEvent(
      {
        playoutId: "cf-pl-1",
        at: T3,
        programId: gmTargetItem.itemId,
        experienceId: gmRun2.decision.selectedExperienceId,
        decisionId: gmRun2.result.decisionId,
        event: "finished",
        positionSeconds: 1500,
        totalSeconds: 1500,
      } as PlayoutReport,
      { tenant: TENANT, subject: SUBJECT, evidenceClass: "controlled-local", contextId: gm.context.contextId },
    );
    expect(wfOutcomeResult.ok && gmOutcomeResult.ok).toBe(true);
    if (!wfOutcomeResult.ok || !gmOutcomeResult.ok) throw new Error("outcome mapping failed");
    const wfOutcome = expectValid(OutcomeEventSchema, wfOutcomeResult.value);
    const gmOutcome = expectValid(OutcomeEventSchema, gmOutcomeResult.value);
    expect(wfOutcome.schema).toBe(CONTRACT_IDS.outcomeEvent);
    expect(gmOutcome.schema).toBe(CONTRACT_IDS.outcomeEvent);
    expect(wfOutcome.eventType).toBe("completion");
    expect(gmOutcome.eventType).toBe("completion");
    expect(wfOutcome.evidenceClass).toBe("controlled-local"); // observed class, honestly labeled
    expect(gmOutcome.evidenceClass).toBe("controlled-local");
    expectShapeIdentical("outcomeEvent", wfOutcome, gmOutcome);

    // --- Stage: preference deltas from the observed outcome.
    const wfDeltasResult = webflix.toPreferenceDeltas(wfOutcome, wfTargetItem);
    const gmDeltasResult = media.toPreferenceDeltas(gmOutcome, gmTargetItem);
    expect(wfDeltasResult.ok && gmDeltasResult.ok).toBe(true);
    if (!wfDeltasResult.ok || !gmDeltasResult.ok) throw new Error("delta mapping failed");
    expect(wfDeltasResult.value.length).toBeGreaterThan(0);
    expect(gmDeltasResult.value.length).toBeGreaterThan(0);
    for (const delta of wfDeltasResult.value) expectValid(PreferenceDeltaSchema, delta);
    for (const delta of gmDeltasResult.value) expectValid(PreferenceDeltaSchema, delta);
    expect(wfDeltasResult.value.length).toBe(gmDeltasResult.value.length); // same label counts by construction
    for (let i = 0; i < wfDeltasResult.value.length; i++) {
      expectShapeIdentical(
        `preferenceDelta[${i}]`,
        expectValid(PreferenceDeltaSchema, wfDeltasResult.value[i]),
        expectValid(PreferenceDeltaSchema, gmDeltasResult.value[i]),
      );
    }
    // Deltas carry each adapter's OWN vocabulary in dimensions (host
    // vocabulary, opaque by design) — never the other domain's.
    for (const delta of gmDeltasResult.value) {
      expect(delta.dimension).toMatch(/^generic-media\.topic-affinity:/);
      expect(delta.dimension).not.toMatch(/webflix/i);
    }
    for (const delta of wfDeltasResult.value) {
      expect(delta.dimension).toMatch(/^webflix\.genre-affinity:/);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Vocabulary isolation (W3-006 law: no WebFlix vocabulary in media.ts)
// ---------------------------------------------------------------------------

describe("W3-006 vocabulary isolation", () => {
  it("generic media adapter code contains no WebFlix vocabulary", () => {
    const mediaSource = readFileSync(resolve(HERE, "../src/media.ts"), "utf8");
    // Strip comments first: doc headers may REFERENCE the W3-005/W3-006
    // work items (that is governance documentation, not domain
    // vocabulary); identifiers, strings and mapped values must not
    // contain WebFlix naming.
    const codeOnly = mediaSource
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*/gm, "");
    expect(codeOnly.toLowerCase()).not.toContain("webflix");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.adapterId).not.toBe(WEBFLIX_ADAPTER_DECLARATION.adapterId);
  });
});

// ---------------------------------------------------------------------------
// 4. Host-boundary law (no host-internal persistence imports)
// ---------------------------------------------------------------------------

describe("host-boundary law: adapter modules import only frozen contracts, kernel seams and local modules", () => {
  const ALLOWED_SPECIFIERS = new Set([
    "@reckon/contracts",
    "./errors.js",
    "./declaration.js",
    "./internal.js",
    "./webflix.js",
    "./media.js",
    "./index.js",
    "../../scheduler/src/index.js",
    "../../experience/src/index.js",
    "../../decision/src/index.js",
  ]);

  function importSpecifiersOf(source: string): string[] {
    const specifiers: string[] = [];
    const pattern = /from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      specifiers.push(match[1]);
    }
    return specifiers;
  }

  it("webflix.ts and media.ts declare only boundary-safe static imports", () => {
    for (const file of ["../src/webflix.ts", "../src/media.ts"]) {
      const source = readFileSync(resolve(HERE, file), "utf8");
      const specifiers = importSpecifiersOf(source);
      expect(specifiers.length).toBeGreaterThan(0);
      for (const specifier of specifiers) {
        expect(ALLOWED_SPECIFIERS.has(specifier)).toBe(true);
      }
      // No host-internal module can ever appear: every specifier is
      // allowlisted above, and none starts with a host package prefix.
      for (const specifier of specifiers) {
        expect(specifier.startsWith("@webflix/") || specifier.includes("persistence")).toBe(false);
      }
    }
  });
});
