/**
 * W3-005 — WebFlix reference adapter proof.
 *
 * Proves, from REAL commands run in this suite:
 * - the WebFlix-shaped catalog maps into schema-valid frozen contracts
 *   (CatalogItem/Realization with titles, genres and availability
 *   windows preserved);
 * - host play/queue/switch/interrupt/end actions map into scheduler
 *   action inputs (host-authoritative plan-state transitions and the
 *   caller-supplied switch evaluation);
 * - player playback reports map into `OutcomeEvent`s carrying an
 *   OBSERVED evidence class (non-observed classes are typed errors);
 * - the FULL VERTICAL — context → candidates → experience → decision
 *   → schedule → outcome → preference delta — runs end-to-end through
 *   the real W2 kernels (normalize → expand → policy → scheduler) for
 *   a media-neutral fixture, with honest absence for unknown items,
 *   constraint defense-in-depth, resume checkpoints on SWITCH, and
 *   byte-identical determinism across repeated runs;
 * - every record at every stage validates against the frozen schemas.
 *
 * Fixture evidence only — nothing here proves a live WebFlix
 * integration (WEBFLIX_ADAPTER_DECLARATION.liveVerification).
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
  createWebFlixAdapter,
  WEBFLIX_ADAPTER_DECLARATION,
  type ObservedEvidenceClass,
  type WebFlixCatalogImport,
  type WebFlixHostAction,
  type WebFlixPlaybackReport,
  type WebFlixViewingGoal,
} from "../src/index.js";
import { expectValid } from "./helpers.js";
import { idleState, runVertical, unwrapVertical } from "./vertical.js";

// ---------------------------------------------------------------------------
// Fixture (caller-supplied timestamps only — deterministic)
// ---------------------------------------------------------------------------

const T0 = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z (fixture epoch)
const T1 = T0 + 3_600_000; // session/decision 1
const T2 = T0 + 3_660_000; // decision 2 (switch)
const T3 = T0 + 7_200_000; // playback outcomes

const adapter = createWebFlixAdapter();

const catalogImport: WebFlixCatalogImport = {
  source: "webflix-catalog-export",
  exportedAt: T0,
  items: [
    {
      mediaId: "wf-m-coral-reef",
      title: "Coral Reef Nights",
      mediaType: "documentary",
      genres: ["documentary", "nature", "ocean"],
      availableFrom: T0,
      availableUntil: T0 + 2_592_000_000,
      rightsTags: ["wf-basic"],
      playbacks: [
        {
          optionId: "wf-pb-coral-tv4k",
          surface: "tv-app",
          locale: "en",
          maxResolution: "4k",
          audioTracks: ["en", "fr"],
          durationSeconds: 3120,
          downloadable: false,
          offlineEligible: false,
          variants: ["subtitled"],
        },
        {
          optionId: "wf-pb-coral-web1080",
          surface: "web-player",
          maxResolution: "1080p",
          audioTracks: ["en"],
          durationSeconds: 3120,
          downloadable: false,
          offlineEligible: false,
        },
      ],
    },
    {
      mediaId: "wf-m-midnight-diner",
      title: "Midnight Diner",
      mediaType: "series",
      genres: ["drama", "food"],
      rightsTags: ["wf-basic"],
      playbacks: [
        {
          optionId: "wf-pb-diner-mob",
          surface: "mobile-app",
          maxResolution: "720p",
          audioTracks: ["en"],
          durationSeconds: 1440,
          downloadable: true,
          offlineEligible: true,
          variants: ["clip"],
        },
      ],
    },
    {
      mediaId: "wf-m-quantum-quickies",
      title: "Quantum Quickies",
      mediaType: "short",
      genres: ["science", "short-form"],
      rightsTags: ["wf-free"],
      playbacks: [
        {
          optionId: "wf-pb-quickies-mob",
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
};

const viewingSession = {
  profileId: "wf-profile-7",
  sessionId: "wf-ctx-evening-1",
  at: T1,
  deviceKind: "living-room-tv" as const,
  networkKind: "wifi" as const,
  localTime: "20:30",
  timezone: "Europe/Berlin",
  minutesAvailable: 45,
  recentInterruptions: 1,
  continuing: true,
};

const tenant = { tenantId: "wf-tenant" };
const subject = { kind: "user" as const, ref: "wf-profile-7" };

/** The standard retrieval feed (includes an unknown item for honest absence). */
function standardFeed() {
  return adapter.toCandidateSet({
    feedId: "wf-feed-evening-1",
    source: "webflix-recommender-v3",
    rows: [
      { mediaId: "wf-m-coral-reef", rank: 1 },
      { mediaId: "wf-m-midnight-diner", rank: 2 },
      { mediaId: "wf-m-quantum-quickies", rank: 3 },
      { mediaId: "wf-m-ghost", rank: 4 }, // unknown item — honest absence
    ],
  });
}

// ---------------------------------------------------------------------------
// Declaration (typed constant — fixture-only, host-authoritative)
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix adapter declaration", () => {
  it("declares fixture-only live verification and host-authoritative boundaries", () => {
    expect(WEBFLIX_ADAPTER_DECLARATION.adapterId).toBe("webflix-reference-adapter");
    expect(WEBFLIX_ADAPTER_DECLARATION.liveVerification.status).toBe("fixture-only");
    expect(WEBFLIX_ADAPTER_DECLARATION.liveVerification.evidenceClass).toBe("fixture");
    expect(adapter.declaration).toBe(WEBFLIX_ADAPTER_DECLARATION);

    for (const unsupported of [
      "identity",
      "consent-management",
      "rights-verification",
      "content-delivery",
      "payment",
      "live-provider-calls",
    ]) {
      expect(WEBFLIX_ADAPTER_DECLARATION.unsupportedCapabilities).toContain(unsupported);
    }
    for (const supported of [
      "catalog-import",
      "retrieval-mapping",
      "context-mapping",
      "scheduler-intent-mapping",
      "playback-outcome-mapping",
      "preference-delta-mapping",
    ]) {
      expect(WEBFLIX_ADAPTER_DECLARATION.supportedCapabilities).toContain(supported);
    }
    // Host stays authoritative for its own gates.
    for (const requirement of WEBFLIX_ADAPTER_DECLARATION.authorizationRequirements) {
      expect(["host", "reckon-api"]).toContain(requirement.enforcedBy);
    }
    // Rights are pass-through only — provenance says so.
    expect(WEBFLIX_ADAPTER_DECLARATION.provenance.dataOwnership).toBe("host");
    expect(WEBFLIX_ADAPTER_DECLARATION.provenance.rightsSource).toContain("unverified");
    // Failure semantics are fail-closed.
    expect(WEBFLIX_ADAPTER_DECLARATION.failureSemantics).toEqual({
      invalidInput: "typed-error",
      unknownVocabulary: "typed-error",
      unavailableData: "honest-absence",
      partialImport: "rejected",
      liveProviderCalls: "none",
      nonObservedEvidence: "typed-error",
    });
    expect(WEBFLIX_ADAPTER_DECLARATION.limits.maxItemsPerImport).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Catalog mapping
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix catalog import", () => {
  it("maps titles, genres and availability windows into schema-valid CatalogItem/Realization records", () => {
    const result = adapter.importCatalog(catalogImport);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const { items, realizations } = result.value;

    expect(items).toHaveLength(3);
    expect(realizations).toHaveLength(4);

    const coral = items.find((item) => item.itemId === "wf-m-coral-reef");
    expect(coral).toBeDefined();
    if (coral === undefined) throw new Error("coral item missing");
    expectValid(CatalogItemSchema, coral);
    expect(coral.kind).toBe("media");
    // Labels are the sorted, de-duplicated kind + genres.
    expect(coral.labels).toEqual(["documentary", "nature", "ocean"]);
    // Availability window preserved.
    expect(coral.availableFrom).toBe(T0);
    expect(coral.availableUntil).toBe(T0 + 2_592_000_000);
    // Host rights tags pass through unverified (host authority).
    expect((coral.attributes as Record<string, unknown>).rightsTags).toEqual(["wf-basic"]);
    expect((coral.attributes as Record<string, unknown>).title).toBe("Coral Reef Nights");

    const diner = items.find((item) => item.itemId === "wf-m-midnight-diner");
    expect(diner?.labels).toEqual(["drama", "food", "series"]);

    const tv4k = realizations.find((r) => r.realizationId === "wf-pb-coral-tv4k");
    expect(tv4k).toBeDefined();
    if (tv4k === undefined) throw new Error("tv4k realization missing");
    expectValid(RealizationSchema, tv4k);
    expect(tv4k.itemId).toBe("wf-m-coral-reef");
    expect(tv4k.kind).toBe("tv-app");
    expect(tv4k.locale).toBe("en");
    expect(tv4k.constraints.formats).toEqual(["full", "subtitled"]);
    expect(tv4k.constraints.deviceClasses).toEqual(["tv"]);
    expect(tv4k.constraints.requiresScreen).toBe(true);
    expect(tv4k.constraints.requiresAudio).toBe(true);
    expect(tv4k.constraints.minBandwidth).toBe("high"); // 4k
    expect(tv4k.constraints.durationSeconds).toBe(3120);

    const web = realizations.find((r) => r.realizationId === "wf-pb-coral-web1080");
    expect(web?.constraints.minBandwidth).toBe("medium"); // 1080p
    expect(web?.constraints.formats).toEqual(["full"]);
    expect(web?.locale).toBeUndefined();

    const dinerMob = realizations.find((r) => r.realizationId === "wf-pb-diner-mob");
    expect(dinerMob?.constraints.formats).toEqual(["clip", "full"]);
    expect(dinerMob?.constraints.minBandwidth).toBe("low"); // 720p
  });

  it("rejects duplicate media ids and duplicate playback option ids (all-or-nothing)", () => {
    const duplicateMedia = adapter.importCatalog({
      ...catalogImport,
      items: [catalogImport.items[0], catalogImport.items[0]],
    });
    expect(duplicateMedia.ok).toBe(false);
    if (duplicateMedia.ok) throw new Error("expected failure");
    expect(duplicateMedia.error.code).toBe("INVALID_INPUT");
    expect(duplicateMedia.error.message).toContain("duplicate mediaId");

    const duplicateOption = adapter.importCatalog({
      ...catalogImport,
      items: [
        catalogImport.items[0],
        { ...catalogImport.items[1], playbacks: [catalogImport.items[0].playbacks[0]] },
      ],
    });
    expect(duplicateOption.ok).toBe(false);
    if (duplicateOption.ok) throw new Error("expected failure");
    expect(duplicateOption.error.message).toContain("duplicate playback optionId");
  });

  it("returns typed issues for malformed host shapes (fail-closed)", () => {
    const bad = adapter.importCatalog({
      source: "webflix-catalog-export",
      exportedAt: T0,
      items: [
        {
          ...catalogImport.items[0],
          mediaId: "not a valid id!", // spaces are not url-safe ids
          genres: [], // genres must be non-empty
          playbacks: [], // playbacks must be non-empty
        },
      ],
    });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error("expected failure");
    expect(bad.error.code).toBe("INVALID_INPUT");
    expect(bad.error.issues?.map((issue) => issue.path)).toContain("items[0].mediaId");
    expect(bad.error.issues?.some((issue) => issue.path === "items[0].genres")).toBe(true);
    expect(bad.error.issues?.some((issue) => issue.path === "items[0].playbacks")).toBe(true);

    const badWindow = adapter.importCatalog({
      source: "webflix-catalog-export",
      exportedAt: T0,
      items: [{ ...catalogImport.items[2], availableFrom: T0, availableUntil: T0 }],
    });
    expect(badWindow.ok).toBe(false);
    if (badWindow.ok) throw new Error("expected failure");
    expect(badWindow.error.issues?.some((issue) => issue.path === "items[0].availableUntil")).toBe(true);
  });

  it("enforces the declared import limits with typed LIMIT_EXCEEDED errors", () => {
    const limit = WEBFLIX_ADAPTER_DECLARATION.limits.maxItemsPerImport;
    const tooMany = adapter.importCatalog({
      source: "webflix-catalog-export",
      exportedAt: T0,
      items: Array.from({ length: limit + 1 }, (_, index) => ({
        ...catalogImport.items[2],
        mediaId: `wf-m-bulk-${index}`,
        playbacks: [{ ...catalogImport.items[2].playbacks[0], optionId: `wf-pb-bulk-${index}` }],
      })),
    });
    expect(tooMany.ok).toBe(false);
    if (tooMany.ok) throw new Error("expected failure");
    expect(tooMany.error.code).toBe("LIMIT_EXCEEDED");

    const tooManyPlaybacks = adapter.importCatalog({
      source: "webflix-catalog-export",
      exportedAt: T0,
      items: [
        {
          ...catalogImport.items[0],
          playbacks: Array.from({ length: 9 }, (_, index) => ({
            ...catalogImport.items[0].playbacks[1],
            optionId: `wf-pb-coral-x${index}`,
          })),
        },
      ],
    });
    expect(tooManyPlaybacks.ok).toBe(false);
    if (tooManyPlaybacks.ok) throw new Error("expected failure");
    expect(tooManyPlaybacks.error.issues?.some((issue) => issue.path === "items[0].playbacks")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retrieval, context, objective, attention mappings
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix retrieval/context/objective/attention mappings", () => {
  it("maps recommender feed rows into a schema-valid CandidateSet with rank hints and provenance", () => {
    const result = adapter.toCandidateSet({
      feedId: "wf-feed-evening-1",
      source: "webflix-recommender-v3",
      rows: [
        { mediaId: "wf-m-coral-reef", rank: 1, reason: "matches evening documentary taste" },
        { mediaId: "wf-m-midnight-diner", rank: 2 },
        { mediaId: "wf-m-quantum-quickies", rank: 3 },
        { mediaId: "wf-m-ghost", rank: 4 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const set = expectValid(CandidateSetSchema, result.value);
    expect(set.setId).toBe("wf-feed-evening-1");
    expect(set.candidates).toHaveLength(4);
    expect(set.candidates[0]).toEqual({
      itemId: "wf-m-coral-reef",
      realizationIds: [],
      source: "webflix-recommender-v3",
      rankHint: 1,
    });
    expect(set.provenance).toEqual({
      system: "webflix-recommender-v3",
      correlationId: "wf-feed-evening-1",
    });
  });

  it("maps a viewing session into a schema-valid ContextSnapshot (device, day-part, attention, fatigue)", () => {
    const result = adapter.toContextSnapshot(viewingSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const context = expectValid(ContextSnapshotSchema, result.value);
    expect(context.contextId).toBe("wf-ctx-evening-1");
    expect(context.at).toBe(T1);
    expect(context.device?.class).toBe("tv");
    expect(context.network?.class).toBe("wifi");
    expect(context.time?.localTime).toBe("20:30");
    expect(context.time?.dayPart).toBe("evening"); // 20:30 → evening
    expect(context.attention?.availableMs).toBe(45 * 60_000);
    expect(context.fatigue?.recentInterruptions).toBe(1);
    expect(context.activity).toEqual(["continuing-viewing"]);
    expect(context.session?.sessionId).toBe("wf-ctx-evening-1");
    // Location is omitted unless explicitly permitted (ADR-003).
    expect(context.location).toBeUndefined();
  });

  it("rejects malformed local times and empty feeds with typed errors", () => {
    const badTime = adapter.toContextSnapshot({ ...viewingSession, localTime: "25:99" });
    expect(badTime.ok).toBe(false);
    if (badTime.ok) throw new Error("expected failure");
    expect(badTime.error.issues?.some((issue) => issue.path === "localTime")).toBe(true);

    const emptyFeed = adapter.toCandidateSet({ feedId: "wf-feed-x", source: "webflix-recommender-v3", rows: [] });
    expect(emptyFeed.ok).toBe(false);
    if (emptyFeed.ok) throw new Error("expected failure");
    expect(emptyFeed.error.issues?.some((issue) => issue.path === "rows")).toBe(true);
  });

  it("maps viewing goals and styles into schema-valid Objectives and AttentionPolicies", () => {
    const goal = adapter.toObjective({ goal: "relax", tasteGenres: ["documentary", "nature"] });
    expect(goal.ok).toBe(true);
    if (!goal.ok) throw new Error(goal.error.message);
    const objective = expectValid(ObjectiveSchema, goal.value);
    expect(objective.kind).toBe("relax");
    expect(objective.objectiveId).toBe("wf-goal-relax");
    expect(objective.params.tasteGenres).toEqual(["documentary", "nature"]);

    const leanBack = adapter.toAttentionPolicy("lean-back");
    expect(leanBack.ok).toBe(true);
    if (!leanBack.ok) throw new Error(leanBack.error.message);
    const policy = expectValid(AttentionPolicySchema, leanBack.value);
    expect(policy.style).toBe("immersive");
    expect(policy.policyId).toBe("wf-attention-lean-back");

    const badGoal = adapter.toObjective({
      goal: "binge-watch",
      tasteGenres: [],
    } as unknown as WebFlixViewingGoal);
    expect(badGoal.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Host actions → scheduler action inputs
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix host actions → scheduler action inputs", () => {
  it("maps play to a host-authoritative plan-state transition (queue entry consumed)", () => {
    const result = adapter.toSchedulerIntents(
      { kind: "play", experienceId: "exp-a" },
      { status: "queued", queue: ["exp-a", "exp-b"], resumeCheckpoints: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "exp-a",
      queue: ["exp-b"],
      resumeCheckpoints: [],
    });
    expect(result.value.switch).toBeUndefined();
    expect(result.value.endRequested).toBeUndefined();
  });

  it("maps queue without interrupting an active experience, and never duplicates entries", () => {
    const result = adapter.toSchedulerIntents(
      { kind: "queue", experienceIds: ["exp-b", "exp-b", "exp-c"] },
      {
        status: "playing",
        currentExperienceId: "exp-a",
        queue: ["exp-b"],
        resumeCheckpoints: [],
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "exp-a",
      queue: ["exp-b", "exp-c"],
      resumeCheckpoints: [],
    });
  });

  it("maps queue from idle to the queued status", () => {
    const result = adapter.toSchedulerIntents({ kind: "queue", experienceIds: ["exp-a"] }, idleState());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState?.status).toBe("queued");
    expect(result.value.planState?.queue).toEqual(["exp-a"]);
  });

  it("maps switch numbers to the caller-supplied SwitchEvaluationInput (SEPARATION LAW passthrough)", () => {
    const action: WebFlixHostAction = {
      kind: "switch",
      numbers: {
        fromExperienceId: "exp-a",
        toExperienceId: "exp-b",
        expectedImprovement: 0.8,
        interruptionCost: 0.1,
        uncertaintyPenalty: 0.1,
        resumeLoss: 0.05,
        switchThreshold: 0.5,
        suggestThreshold: 0.2,
      },
    };
    const result = adapter.toSchedulerIntents(action, {
      status: "playing",
      currentExperienceId: "exp-a",
      queue: [],
      resumeCheckpoints: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.switch).toEqual({
      currentExperienceId: "exp-a",
      candidateExperienceId: "exp-b",
      expectedImprovement: 0.8,
      interruptionCost: 0.1,
      uncertaintyPenalty: 0.1,
      resumeLoss: 0.05,
      switchThreshold: 0.5,
      suggestThreshold: 0.2,
    });
    expect(result.value.planState).toBeUndefined();
  });

  it("maps interrupt (with host resume token) and end actions to scheduler flags", () => {
    const interrupt = adapter.toSchedulerIntents(
      { kind: "interrupt", experienceId: "exp-a", resumeToken: "wf-resume-1" },
      { status: "playing", currentExperienceId: "exp-a", queue: [], resumeCheckpoints: [] },
    );
    expect(interrupt.ok).toBe(true);
    if (!interrupt.ok) throw new Error(interrupt.error.message);
    expect(interrupt.value.interruptRequested).toBe(true);
    expect(interrupt.value.resumeTokens).toEqual({ "exp-a": "wf-resume-1" });

    const end = adapter.toSchedulerIntents({ kind: "end" }, idleState());
    expect(end.ok).toBe(true);
    if (!end.ok) throw new Error(end.error.message);
    expect(end.value.endRequested).toBe(true);
  });

  it("rejects host actions against a terminal plan and malformed action shapes", () => {
    const ended = adapter.toSchedulerIntents(
      { kind: "play", experienceId: "exp-a" },
      { status: "ended", queue: [], resumeCheckpoints: [] },
    );
    expect(ended.ok).toBe(false);
    if (ended.ok) throw new Error("expected failure");
    expect(ended.error.message).toContain("ended");

    const badShape = adapter.toSchedulerIntents({ kind: "play" } as unknown as WebFlixHostAction, idleState());
    expect(badShape.ok).toBe(false);
    if (badShape.ok) throw new Error("expected failure");
    expect(badShape.error.code).toBe("INVALID_INPUT");
  });
});

// ---------------------------------------------------------------------------
// Playback outcomes → OutcomeEvents with OBSERVED evidence class
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix playback outcomes", () => {
  const report = {
    playbackId: "wf-pb-901",
    at: T3,
    mediaId: "wf-m-midnight-diner",
    experienceId: "exp-diner",
    decisionId: "dec-1",
    event: "completed" as const,
    positionSeconds: 1440,
    totalSeconds: 1440,
  };

  it("maps playback reports to schema-valid OutcomeEvents with observed evidence classes", () => {
    for (const evidenceClass of ["production-observed", "staging", "controlled-local"] as const) {
      const result = adapter.toOutcomeEvent(report, {
        tenant,
        subject,
        evidenceClass,
        contextId: "wf-ctx-evening-1",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const event = expectValid(OutcomeEventSchema, result.value);
      expect(event.eventType).toBe("completion");
      expect(event.evidenceClass).toBe(evidenceClass);
      expect(event.experienceId).toBe("exp-diner");
      expect(event.decisionId).toBe("dec-1");
      expect(event.occurredAt).toBe(T3);
      expect(event.metrics).toEqual({ positionSeconds: 1440, totalSeconds: 1440, completionRatio: 1 });
      expect(event.provenance?.system).toBe("webflix-player");
      expect(event.subject).toEqual(subject);
      expect(event.context).toEqual({ contextId: "wf-ctx-evening-1" });
    }
  });

  it("rejects non-observed evidence classes on the observation channel (typed error)", () => {
    for (const researchClass of ["simulated", "counterfactual", "fixture"] as const) {
      // Bypass the narrowed input type deliberately: this test proves
      // the RUNTIME guard (defense in depth for callers that cast).
      const result = adapter.toOutcomeEvent(report, {
        tenant,
        subject,
        evidenceClass: researchClass as unknown as ObservedEvidenceClass,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected failure");
      expect(result.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");
      expect(result.error.message).toContain("observed");
    }
  });

  it("derives deterministic event ids and idempotency keys (same report ⇒ same event)", () => {
    const first = adapter.toOutcomeEvent(report, { tenant, subject, evidenceClass: "controlled-local" });
    const second = adapter.toOutcomeEvent(report, { tenant, subject, evidenceClass: "controlled-local" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected success");
    expect(canonicalJson(first.value)).toBe(canonicalJson(second.value));
  });

  it("maps every playback event kind to its contract outcome type", () => {
    const cases: [WebFlixPlaybackReport["event"], OutcomeEvent["eventType"]][] = [
      ["started", "start"],
      ["completed", "completion"],
      ["abandoned", "abandonment"],
      ["skipped", "skip"],
      ["seeked", "seek"],
      ["resumed", "resume"],
      ["liked", "explicit-feedback"],
      ["shared", "share"],
      ["saved", "save"],
    ];
    for (const [eventKind, expectedType] of cases) {
      const result = adapter.toOutcomeEvent(
        { ...report, event: eventKind, playbackId: `wf-pb-${eventKind}` },
        { tenant, subject, evidenceClass: "controlled-local" },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      expect(result.value.eventType).toBe(expectedType);
    }
  });
});

// ---------------------------------------------------------------------------
// Outcomes → preference deltas
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix preference deltas", () => {
  const dinerItem: CatalogItem = expectValid(CatalogItemSchema, {
    itemId: "wf-m-midnight-diner",
    kind: "media",
    labels: ["drama", "food", "series"],
    attributes: {},
  });

  function makeOutcome(
    eventType: OutcomeEvent["eventType"],
    evidenceClass: OutcomeEvent["evidenceClass"] = "controlled-local",
  ): OutcomeEvent {
    return expectValid(OutcomeEventSchema, {
      eventId: "evt-test-1",
      tenant,
      subject,
      eventType,
      occurredAt: T3,
      context: { contextId: "wf-ctx-evening-1" },
      metrics: { completionRatio: 1 },
      evidenceClass,
      idempotencyKey: "evtkey-test-1",
    });
  }

  it("maps an observed completion to deterministic genre-affinity PreferenceDeltas", () => {
    const result = adapter.toPreferenceDeltas(makeOutcome("completion"), dinerItem);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(3); // one per label
    for (const delta of result.value) {
      expectValid(PreferenceDeltaSchema, delta);
      expect(delta.op).toBe("add");
      expect(delta.value).toBe(0.25);
      expect(delta.confidenceDelta).toBe(0.2);
      expect(delta.dimension).toMatch(/^webflix\.genre-affinity:/);
      expect(delta.tenant).toEqual(tenant);
      expect(delta.subject).toEqual(subject);
      expect(delta.scope).toEqual({ contextId: "wf-ctx-evening-1" });
      expect(delta.decay).toEqual({ halfLifeSeconds: 2_592_000 });
      expect(delta.model).toEqual({ modelId: "webflix-affinity-v1", version: "1" });
      expect(delta.timestamp).toBe(T3);
    }
    expect(result.value.map((d) => d.dimension).sort()).toEqual([
      "webflix.genre-affinity:drama",
      "webflix.genre-affinity:food",
      "webflix.genre-affinity:series",
    ]);
  });

  it("maps skip/abandonment/feedback with the documented signed values and no affinity for other types", () => {
    const skip = adapter.toPreferenceDeltas(makeOutcome("skip"), dinerItem);
    expect(skip.ok).toBe(true);
    if (!skip.ok) throw new Error(skip.error.message);
    expect(skip.value.every((d) => d.value === -0.05)).toBe(true);

    const abandon = adapter.toPreferenceDeltas(makeOutcome("abandonment"), dinerItem);
    expect(abandon.ok).toBe(true);
    if (!abandon.ok) throw new Error(abandon.error.message);
    expect(abandon.value.every((d) => d.value === -0.1)).toBe(true);

    const feedback = adapter.toPreferenceDeltas(makeOutcome("explicit-feedback"), dinerItem);
    expect(feedback.ok).toBe(true);
    if (!feedback.ok) throw new Error(feedback.error.message);
    expect(feedback.value.every((d) => d.value === 0.5)).toBe(true);

    for (const eventType of ["start", "impression", "share", "save", "resume"] as const) {
      const none = adapter.toPreferenceDeltas(makeOutcome(eventType), dinerItem);
      expect(none.ok).toBe(true);
      if (!none.ok) throw new Error(none.error.message);
      expect(none.value).toEqual([]); // no affinity evidence — never fabricated
    }
  });

  it("rejects research-class outcomes on the runtime learning path (ADR-004)", () => {
    const result = adapter.toPreferenceDeltas(makeOutcome("completion", "simulated"), dinerItem);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");
  });
});

// ---------------------------------------------------------------------------
// THE FULL VERTICAL (media-neutral fixture through the real W2 kernels)
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix full vertical: context → candidates → experience → decision → schedule → outcome → preference delta", () => {
  it("runs end-to-end through the real kernels with schema-valid records at every stage", () => {
    // --- Adapter mappings (host shapes → frozen contracts).
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const contextResult = adapter.toContextSnapshot(viewingSession);
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) throw new Error(contextResult.error.message);
    const goalResult = adapter.toObjective({ goal: "relax", tasteGenres: ["documentary", "nature"] });
    expect(goalResult.ok).toBe(true);
    if (!goalResult.ok) throw new Error(goalResult.error.message);
    const styleResult = adapter.toAttentionPolicy("balanced");
    expect(styleResult.ok).toBe(true);
    if (!styleResult.ok) throw new Error(styleResult.error.message);
    const feedResult = standardFeed();
    expect(feedResult.ok).toBe(true);
    if (!feedResult.ok) throw new Error(feedResult.error.message);

    const objectiveFit = adapter.toObjectiveFit(catalog.value.items);

    // --- Decision 1: idle start, balanced policy → the scheduler QUEUES
    //     the best scored candidate (the scheduler never auto-starts).
    const vertical1 = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "subtitled"],
      objectiveFit,
      policySelector: { policyId: "wf-evening-policy", version: "3" },
      at: T1,
      requestId: "wf-req-1",
      idempotencyKey: "wf-idem-1",
    });
    const run1 = unwrapVertical(vertical1);

    // Every stage record is a schema-valid frozen contract.
    for (const item of catalog.value.items) expectValid(CatalogItemSchema, item);
    for (const realization of catalog.value.realizations) expectValid(RealizationSchema, realization);
    expectValid(ContextSnapshotSchema, contextResult.value);
    expectValid(CandidateSetSchema, feedResult.value);
    for (const entry of run1.expansion.experiences) expectValid(ExperienceSchema, entry.experience);
    expectValid(DecisionRequestSchema, run1.request);
    expectValid(DecisionResultSchema, run1.result);

    // Balanced (not mindful) from idle ⇒ QUEUE the best candidate.
    expect(run1.decision.action).toBe("QUEUE");
    expect(run1.decision.selectedExperienceId).toBeDefined();
    // No reward spec declared ⇒ objective-fit evidence only (lock #22).
    expect(run1.rewardApplied).toBe(false);
    // The best fit is the documentary (taste: documentary + nature).
    expect(run1.decision.selectedExperience?.itemId).toBe("wf-m-coral-reef");

    // Honest absence: the unknown retrieval row is an exclusion, never
    // an invented experience.
    const ghostExclusion = run1.expansion.exclusions.find(
      (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === "wf-m-ghost",
    );
    expect(ghostExclusion).toBeDefined();
    expect(ghostExclusion?.detail).toContain("no-catalog-item");

    // --- Host play action → host-authoritative plan state.
    const playingId = run1.decision.selectedExperienceId;
    expect(playingId).toBeDefined();
    if (playingId === undefined) throw new Error("no selected experience");
    const playIntents = adapter.toSchedulerIntents(
      { kind: "play", experienceId: playingId },
      run1.decision.nextState,
    );
    expect(playIntents.ok).toBe(true);
    if (!playIntents.ok) throw new Error(playIntents.error.message);
    expect(playIntents.value.planState?.status).toBe("playing");
    expect(playIntents.value.planState?.currentExperienceId).toBe(playingId);

    const currentExperience = run1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === playingId,
    )?.experience;
    expect(currentExperience).toBeDefined();
    if (currentExperience === undefined) throw new Error("current experience missing");

    // --- Host switch action with explicit caller-supplied numbers.
    const switchTarget = run1.scored.find(
      (entry) => entry.experience.itemId !== currentExperience.itemId,
    );
    expect(switchTarget).toBeDefined();
    if (switchTarget === undefined) throw new Error("no switch target");
    const switchAction = adapter.toSchedulerIntents(
      {
        kind: "switch",
        numbers: {
          fromExperienceId: playingId,
          toExperienceId: switchTarget.experience.experienceId,
          expectedImprovement: 0.8,
          interruptionCost: 0.1,
          uncertaintyPenalty: 0.1,
          resumeLoss: 0.05,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      playIntents.value.planState ?? idleState(),
    );
    expect(switchAction.ok).toBe(true);
    if (!switchAction.ok) throw new Error(switchAction.error.message);

    // --- Decision 2: playing + switch input ⇒ SWITCH (net 0.55 > 0.5),
    //     with a resume checkpoint (RESUME LAW: token caller-supplied).
    const vertical2 = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "subtitled"],
      objectiveFit,
      policySelector: { policyId: "wf-evening-policy", version: "3" },
      at: T2,
      requestId: "wf-req-2",
      idempotencyKey: "wf-idem-2",
      startState: playIntents.value.planState,
      currentExperience,
      intents: {
        switch: switchAction.value.switch,
        resumeTokens: { [playingId]: "wf-resume-token-1" },
      },
    });
    const run2 = unwrapVertical(vertical2);
    expectValid(DecisionRequestSchema, run2.request);
    expectValid(DecisionResultSchema, run2.result);

    expect(run2.decision.action).toBe("SWITCH");
    expect(run2.decision.selectedExperienceId).toBe(switchTarget.experience.experienceId);
    expect(run2.decision.nextState.status).toBe("playing");
    expect(run2.decision.resumeCheckpointSlot).toEqual({
      experienceId: playingId,
      resumeToken: "wf-resume-token-1",
      source: "SWITCH",
    });
    expect(run2.decision.scheduleDelta.resumeCheckpoint).toEqual({
      experienceId: playingId,
      resumeToken: "wf-resume-token-1",
    });

    // --- Playback outcome for the switched-to experience (observed class).
    const targetItem = catalog.value.items.find((item) => item.itemId === switchTarget.experience.itemId);
    expect(targetItem).toBeDefined();
    if (targetItem === undefined) throw new Error("target item missing");
    const targetDuration = switchTarget.experience.duration;
    const outcomeResult = adapter.toOutcomeEvent(
      {
        playbackId: "wf-pb-901",
        at: T3,
        mediaId: targetItem.itemId,
        experienceId: run2.decision.selectedExperienceId,
        decisionId: run2.result.decisionId,
        event: "completed",
        ...(typeof targetDuration === "number" ? { positionSeconds: targetDuration, totalSeconds: targetDuration } : {}),
      },
      { tenant, subject, evidenceClass: "controlled-local", contextId: contextResult.value.contextId },
    );
    expect(outcomeResult.ok).toBe(true);
    if (!outcomeResult.ok) throw new Error(outcomeResult.error.message);
    const outcome = expectValid(OutcomeEventSchema, outcomeResult.value);
    expect(outcome.eventType).toBe("completion");
    expect(outcome.decisionId).toBe(run2.result.decisionId);
    expect(outcome.experienceId).toBe(run2.decision.selectedExperienceId);

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
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: ["full", "clip", "subtitled"],
      objectiveFit,
      policySelector: { policyId: "wf-evening-policy", version: "3" },
      at: T1,
      requestId: "wf-req-1",
      idempotencyKey: "wf-idem-1",
    });
    const replayRun1 = unwrapVertical(replay1);
    expect(canonicalJson(replayRun1)).toBe(canonicalJson(run1));
  });
});

// ---------------------------------------------------------------------------
// Constraint defense-in-depth on the vertical
// ---------------------------------------------------------------------------

describe("W3-005 WebFlix vertical constraint defense-in-depth", () => {
  it("excludes over-duration experiences at expansion (never scored, never selected)", () => {
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const contextResult = adapter.toContextSnapshot(viewingSession);
    const goalResult = adapter.toObjective({ goal: "relax", tasteGenres: ["documentary", "nature"] });
    const styleResult = adapter.toAttentionPolicy("balanced");
    const feedResult = adapter.toCandidateSet({
      feedId: "wf-feed-evening-1",
      source: "webflix-recommender-v3",
      rows: [
        { mediaId: "wf-m-coral-reef", rank: 1 },
        { mediaId: "wf-m-midnight-diner", rank: 2 },
        { mediaId: "wf-m-quantum-quickies", rank: 3 },
      ],
    });
    expect(contextResult.ok && goalResult.ok && styleResult.ok && feedResult.ok).toBe(true);
    if (!contextResult.ok || !goalResult.ok || !styleResult.ok || !feedResult.ok) {
      throw new Error("mapping failed");
    }

    const constraints: HardConstraint[] = [{ kind: "max-duration", seconds: 2000 }];
    const vertical = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints,
      allowedFormats: ["full", "clip", "subtitled"],
      objectiveFit: adapter.toObjectiveFit(catalog.value.items),
      policySelector: { policyId: "wf-evening-policy", version: "3" },
      at: T1,
      requestId: "wf-req-c",
      idempotencyKey: "wf-idem-c",
    });
    const run = unwrapVertical(vertical);

    // All coral experiences (3120s) are excluded by the max-duration
    // gate: tv4k full + tv4k subtitled + web full = 3 exclusions.
    const coralExclusions = run.expansion.exclusions.filter(
      (exclusion) => exclusion.kind === "experience-excluded" && exclusion.itemId === "wf-m-coral-reef",
    );
    expect(coralExclusions).toHaveLength(3);
    for (const exclusion of coralExclusions) {
      expect(exclusion.kind === "experience-excluded" && exclusion.reasons).toContain("max-duration");
    }
    // Excluded experiences are never scored.
    expect(run.scored.every((entry) => entry.experience.itemId !== "wf-m-coral-reef")).toBe(true);
    // The selected experience respects the constraint.
    expect(run.decision.selectedExperience?.duration as number).toBeLessThanOrEqual(2000);
  });
});
