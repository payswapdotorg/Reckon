/**
 * W3-006 — generic media reference adapter proof.
 *
 * Same contract proof as W3-005 with ZERO WebFlix vocabulary: a
 * program-guide/topic-feed/listening-session host shape maps into the
 * SAME frozen contracts and runs the SAME full vertical through the
 * real W2 kernels. For coverage variety this vertical exercises the
 * MINDFUL attention path (the scheduler SUGGESTS and never
 * auto-starts; the host "tune" action is the host-authoritative
 * start), then a caller-supplied "flip" (switch) with a resume
 * checkpoint, a "finished" playout outcome (observed class), and
 * topic-affinity preference deltas.
 *
 * The vocabulary-isolation and cross-adapter conformance assertions
 * live in conformance.test.ts.
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
  type OutcomeEvent,
} from "@reckon/contracts";
import {
  createMediaAdapter,
  GENERIC_MEDIA_ADAPTER_DECLARATION,
  type MediaHostAction,
  type ObservedEvidenceClass,
  type PlayoutReport,
  type ProgramGuideExport,
} from "../src/index.js";
import { expectValid } from "./helpers.js";
import { idleState, runVertical, unwrapVertical } from "./vertical.js";

// ---------------------------------------------------------------------------
// Fixture (caller-supplied timestamps only — deterministic)
// ---------------------------------------------------------------------------

const T0 = 1_735_689_600_000; // fixture epoch
const T1 = T0 + 3_600_000; // session/decision 1
const T2 = T0 + 3_660_000; // decision 2 (flip)
const T3 = T0 + 7_200_000; // playout outcomes

const adapter = createMediaAdapter();

const guideExport: ProgramGuideExport = {
  guideId: "gm-guide-week-1",
  exportedAt: T0,
  entries: [
    {
      programId: "gm-prog-field-notes",
      name: "Field Notes from the Savanna",
      programKind: "episode",
      topics: ["nature", "documentary"],
      windowOpensAt: T0,
      windowClosesAt: T0 + 2_592_000_000,
      licenseScope: ["standard"],
      renditions: [
        {
          renditionId: "gm-rnd-notes-live",
          surface: "live-stream",
          primaryLanguage: "en",
          languages: ["en", "sw"],
          bitrateKbps: 128,
          durationSeconds: 1800,
          formatVariants: ["segment"],
          offlineCapable: false,
        },
      ],
    },
    {
      programId: "gm-prog-daily-byte",
      name: "The Daily Byte",
      programKind: "live",
      topics: ["tech", "news"],
      licenseScope: ["standard"],
      renditions: [
        {
          renditionId: "gm-rnd-byte-app",
          surface: "podcast-app",
          languages: ["en"],
          bitrateKbps: 96,
          durationSeconds: 1500,
          offlineCapable: true,
        },
      ],
    },
    {
      programId: "gm-prog-sleep-library",
      name: "Sleep Sound Library",
      programKind: "audiobook",
      topics: ["calm", "sleep"],
      licenseScope: ["premium"],
      renditions: [
        {
          renditionId: "gm-rnd-sleep-embed",
          surface: "web-embed",
          languages: ["en"],
          bitrateKbps: 64,
          durationSeconds: 2700,
          offlineCapable: false,
        },
      ],
    },
  ],
};

const listeningSession = {
  listenerId: "gm-listener-4",
  sessionId: "gm-ctx-night-1",
  at: T1,
  apparatus: "phone" as const,
  audioRoute: "headphones" as const,
  networkKind: "cellular" as const,
  localTime: "23:10",
  timezone: "Africa/Accra",
  minutesAvailable: 30,
  interruptionCount: 0,
  resuming: false,
};

const tenant = { tenantId: "gm-tenant" };
const subject = { kind: "user" as const, ref: "gm-listener-4" };

function standardFeed() {
  return adapter.toCandidateSet({
    feedId: "gm-feed-night-1",
    curator: "topic-feed-curator",
    picks: [
      { programId: "gm-prog-field-notes", position: 1 },
      { programId: "gm-prog-daily-byte", position: 2 },
      { programId: "gm-prog-sleep-library", position: 3 },
      { programId: "gm-prog-ghost", position: 4 }, // unknown program — honest absence
    ],
  });
}

// ---------------------------------------------------------------------------
// Declaration + catalog mapping
// ---------------------------------------------------------------------------

describe("W3-006 generic media adapter declaration and guide import", () => {
  it("declares fixture-only live verification and host-authoritative boundaries", () => {
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.adapterId).toBe("generic-media-reference-adapter");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.domain).toBe("media");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.contractVersion).toBe("0.1.0");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.liveVerification.status).toBe("fixture-only");
    expect(adapter.declaration).toBe(GENERIC_MEDIA_ADAPTER_DECLARATION);
    for (const unsupported of ["identity", "consent-management", "rights-verification", "content-delivery", "payment", "live-provider-calls"]) {
      expect(GENERIC_MEDIA_ADAPTER_DECLARATION.unsupportedCapabilities).toContain(unsupported);
    }
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.failureSemantics.partialImport).toBe("rejected");
    expect(GENERIC_MEDIA_ADAPTER_DECLARATION.failureSemantics.nonObservedEvidence).toBe("typed-error");
  });

  it("maps program guide entries into schema-valid CatalogItem/Realization records (no WebFlix vocabulary)", () => {
    const result = adapter.importProgramGuide(guideExport);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const { items, realizations } = result.value;
    expect(items).toHaveLength(3);
    expect(realizations).toHaveLength(3);

    const notes = items.find((item) => item.itemId === "gm-prog-field-notes");
    expect(notes).toBeDefined();
    if (notes === undefined) throw new Error("notes item missing");
    expectValid(CatalogItemSchema, notes);
    expect(notes.kind).toBe("media");
    expect(notes.labels).toEqual(["documentary", "episode", "nature"]); // kind + topics, sorted
    expect(notes.availableFrom).toBe(T0);
    expect(notes.availableUntil).toBe(T0 + 2_592_000_000);
    expect((notes.attributes as Record<string, unknown>).name).toBe("Field Notes from the Savanna");
    expect((notes.attributes as Record<string, unknown>).licenseScope).toEqual(["standard"]);

    const live = realizations.find((r) => r.realizationId === "gm-rnd-notes-live");
    expect(live).toBeDefined();
    if (live === undefined) throw new Error("live rendition missing");
    expectValid(RealizationSchema, live);
    expect(live.itemId).toBe("gm-prog-field-notes");
    expect(live.kind).toBe("live-stream");
    expect(live.locale).toBe("en"); // from primaryLanguage
    expect(live.constraints.formats).toEqual(["full", "segment"]);
    expect(live.constraints.deviceClasses).toEqual(["desktop", "phone"]);
    expect(live.constraints.requiresScreen).toBe(false); // audio-first delivery
    expect(live.constraints.requiresAudio).toBe(true);
    expect(live.constraints.minBandwidth).toBe("low");
    expect(live.constraints.durationSeconds).toBe(1800);

    const byteApp = realizations.find((r) => r.realizationId === "gm-rnd-byte-app");
    expect(byteApp?.constraints.formats).toEqual(["full"]);
    expect(byteApp?.locale).toBeUndefined(); // no primaryLanguage declared
    expect(byteApp?.constraints.deviceClasses).toEqual(["phone", "tablet"]);
  });

  it("rejects duplicate program ids and malformed entries with typed errors (all-or-nothing)", () => {
    const duplicate = adapter.importProgramGuide({
      ...guideExport,
      entries: [guideExport.entries[0], guideExport.entries[0]],
    });
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) throw new Error("expected failure");
    expect(duplicate.error.code).toBe("INVALID_INPUT");
    expect(duplicate.error.message).toContain("duplicate programId");

    const malformed = adapter.importProgramGuide({
      guideId: "gm-guide-x",
      exportedAt: T0,
      entries: [
        {
          ...guideExport.entries[0],
          programId: "bad id with spaces",
          topics: [],
          renditions: [],
        },
      ],
    });
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("expected failure");
    expect(malformed.error.issues?.map((issue) => issue.path)).toContain("entries[0].programId");
    expect(malformed.error.issues?.some((issue) => issue.path === "entries[0].topics")).toBe(true);
    expect(malformed.error.issues?.some((issue) => issue.path === "entries[0].renditions")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Retrieval, context, objective, attention, actions, outcomes, deltas
// ---------------------------------------------------------------------------

describe("W3-006 generic media retrieval/context/goal/attention/action/outcome/delta mappings", () => {
  it("maps topic feed picks into a schema-valid CandidateSet", () => {
    const result = standardFeed();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const set = expectValid(CandidateSetSchema, result.value);
    expect(set.setId).toBe("gm-feed-night-1");
    expect(set.candidates).toHaveLength(4);
    expect(set.candidates[0]).toEqual({
      itemId: "gm-prog-field-notes",
      realizationIds: [],
      source: "topic-feed-curator",
      rankHint: 1,
    });
    expect(set.provenance).toEqual({ system: "topic-feed-curator", correlationId: "gm-feed-night-1" });
  });

  it("maps a listening session into a schema-valid ContextSnapshot (apparatus, audio route, night day-part)", () => {
    const result = adapter.toContextSnapshot(listeningSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const context = expectValid(ContextSnapshotSchema, result.value);
    expect(context.contextId).toBe("gm-ctx-night-1");
    expect(context.device?.class).toBe("phone");
    expect(context.device?.audioRoute).toBe("headphones");
    expect(context.network?.class).toBe("cellular");
    expect(context.time?.dayPart).toBe("night"); // 23:10 → night
    expect(context.attention?.availableMs).toBe(30 * 60_000);
    expect(context.fatigue?.recentInterruptions).toBe(0);
    expect(context.activity).toEqual([]); // not resuming
    expect(context.location).toBeUndefined(); // ADR-003: only when permitted
  });

  it("maps listening goals/styles into schema-valid Objectives/AttentionPolicies", () => {
    const goal = adapter.toObjective({ aim: "unwind", favoriteTopics: ["nature", "documentary"] });
    expect(goal.ok).toBe(true);
    if (!goal.ok) throw new Error(goal.error.message);
    const objective = expectValid(ObjectiveSchema, goal.value);
    expect(objective.kind).toBe("relax"); // unwind → relax
    expect(objective.objectiveId).toBe("gm-goal-unwind");
    expect(objective.params.favoriteTopics).toEqual(["nature", "documentary"]);

    for (const [style, expected] of [
      ["quiet", "mindful"],
      ["steady", "balanced"],
      ["binge", "immersive"],
    ] as const) {
      const policy = adapter.toAttentionPolicy(style);
      expect(policy.ok).toBe(true);
      if (!policy.ok) throw new Error(policy.error.message);
      expect(expectValid(AttentionPolicySchema, policy.value).style).toBe(expected);
    }
  });

  it("maps tune/enqueue/flip/pause/stop host actions to scheduler action inputs", () => {
    const tune = adapter.toSchedulerIntents(
      { kind: "tune", experienceId: "exp-x" },
      idleState(),
    );
    expect(tune.ok).toBe(true);
    if (!tune.ok) throw new Error(tune.error.message);
    expect(tune.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "exp-x",
      queue: [],
      resumeCheckpoints: [],
    });

    const enqueue = adapter.toSchedulerIntents(
      { kind: "enqueue", experienceIds: ["exp-y"] },
      idleState(),
    );
    expect(enqueue.ok).toBe(true);
    if (!enqueue.ok) throw new Error(enqueue.error.message);
    expect(enqueue.value.planState?.status).toBe("queued");

    const flip = adapter.toSchedulerIntents(
      {
        kind: "flip",
        numbers: {
          fromExperienceId: "exp-x",
          toExperienceId: "exp-y",
          expectedImprovement: 0.7,
          interruptionCost: 0.05,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      { status: "playing", currentExperienceId: "exp-x", queue: [], resumeCheckpoints: [] },
    );
    expect(flip.ok).toBe(true);
    if (!flip.ok) throw new Error(flip.error.message);
    expect(flip.value.switch).toEqual({
      currentExperienceId: "exp-x",
      candidateExperienceId: "exp-y",
      expectedImprovement: 0.7,
      interruptionCost: 0.05,
      uncertaintyPenalty: 0.05,
      resumeLoss: 0,
      switchThreshold: 0.5,
      suggestThreshold: 0.2,
    });

    const pause = adapter.toSchedulerIntents(
      { kind: "pause", experienceId: "exp-x", resumeToken: "gm-resume-9" },
      { status: "playing", currentExperienceId: "exp-x", queue: [], resumeCheckpoints: [] },
    );
    expect(pause.ok).toBe(true);
    if (!pause.ok) throw new Error(pause.error.message);
    expect(pause.value.interruptRequested).toBe(true);
    expect(pause.value.resumeTokens).toEqual({ "exp-x": "gm-resume-9" });

    const stop = adapter.toSchedulerIntents({ kind: "stop" } as MediaHostAction, idleState());
    expect(stop.ok).toBe(true);
    if (!stop.ok) throw new Error(stop.error.message);
    expect(stop.value.endRequested).toBe(true);
  });

  it("maps playout reports to observed-class OutcomeEvents and rejects research classes", () => {
    const report: PlayoutReport = {
      playoutId: "gm-pl-501",
      at: T3,
      programId: "gm-prog-daily-byte",
      experienceId: "exp-byte",
      decisionId: "dec-gm-1",
      event: "finished",
      positionSeconds: 1500,
      totalSeconds: 1500,
    };
    const result = adapter.toOutcomeEvent(report, {
      tenant,
      subject,
      evidenceClass: "controlled-local",
      contextId: "gm-ctx-night-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const event = expectValid(OutcomeEventSchema, result.value);
    expect(event.eventType).toBe("completion");
    expect(event.evidenceClass).toBe("controlled-local");
    expect(event.metrics).toEqual({ positionSeconds: 1500, totalSeconds: 1500, completionRatio: 1 });
    expect(event.provenance?.system).toBe("generic-media-playout");

    const rejected = adapter.toOutcomeEvent(report, {
      tenant,
      subject,
      // Runtime guard proof (defense in depth for callers that cast):
      evidenceClass: "simulated" as unknown as ObservedEvidenceClass,
    });
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("expected failure");
    expect(rejected.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");

    // Event-kind table.
    const cases: [PlayoutReport["event"], OutcomeEvent["eventType"]][] = [
      ["tuned-in", "start"],
      ["finished", "completion"],
      ["left", "abandonment"],
      ["hopped", "skip"],
      ["scrolled", "seek"],
      ["returned", "resume"],
      ["thumbed-up", "explicit-feedback"],
      ["passed-along", "share"],
      ["bookmarked", "save"],
    ];
    for (const [eventKind, expectedType] of cases) {
      const mapped = adapter.toOutcomeEvent(
        { ...report, event: eventKind, playoutId: `gm-pl-${eventKind}` },
        { tenant, subject, evidenceClass: "staging" },
      );
      expect(mapped.ok).toBe(true);
      if (!mapped.ok) throw new Error(mapped.error.message);
      expect(mapped.value.eventType).toBe(expectedType);
    }
  });

  it("maps observed outcomes to deterministic topic-affinity PreferenceDeltas", () => {
    const byteItem: CatalogItem = expectValid(CatalogItemSchema, {
      itemId: "gm-prog-daily-byte",
      kind: "media",
      labels: ["live", "news", "tech"],
      attributes: {},
    });
    const outcome = expectValid(OutcomeEventSchema, {
      eventId: "evt-gm-1",
      tenant,
      subject,
      eventType: "completion",
      occurredAt: T3,
      metrics: { completionRatio: 1 },
      evidenceClass: "controlled-local",
      idempotencyKey: "evtkey-gm-1",
    });
    const result = adapter.toPreferenceDeltas(outcome, byteItem);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toHaveLength(3);
    for (const delta of result.value) {
      expectValid(PreferenceDeltaSchema, delta);
      expect(delta.dimension).toMatch(/^generic-media\.topic-affinity:/);
      expect(delta.model).toEqual({ modelId: "generic-media-affinity-v1", version: "1" });
      expect(delta.provenance).toEqual({ system: "generic-media-adapter", version: "0.1.0" });
    }
    expect(result.value.map((d) => d.dimension).sort()).toEqual([
      "generic-media.topic-affinity:live",
      "generic-media.topic-affinity:news",
      "generic-media.topic-affinity:tech",
    ]);

    const none = adapter.toPreferenceDeltas(
      expectValid(OutcomeEventSchema, {
        ...outcome,
        eventId: "evt-gm-2",
        eventType: "start",
        idempotencyKey: "evtkey-gm-2",
      }),
      byteItem,
    );
    expect(none.ok).toBe(true);
    if (!none.ok) throw new Error(none.error.message);
    expect(none.value).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE FULL VERTICAL (mindful path: SUGGEST → host tune → flip SWITCH → outcome → deltas)
// ---------------------------------------------------------------------------

describe("W3-006 generic media full vertical: context → candidates → experience → decision → schedule → outcome → preference delta", () => {
  it("runs end-to-end through the real kernels (mindful: suggest, never auto-start)", () => {
    const guide = adapter.importProgramGuide(guideExport);
    expect(guide.ok).toBe(true);
    if (!guide.ok) throw new Error(guide.error.message);
    const contextResult = adapter.toContextSnapshot(listeningSession);
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) throw new Error(contextResult.error.message);
    const goalResult = adapter.toObjective({ aim: "unwind", favoriteTopics: ["nature", "documentary"] });
    expect(goalResult.ok).toBe(true);
    if (!goalResult.ok) throw new Error(goalResult.error.message);
    const styleResult = adapter.toAttentionPolicy("quiet"); // → mindful
    expect(styleResult.ok).toBe(true);
    if (!styleResult.ok) throw new Error(styleResult.error.message);
    const feedResult = standardFeed();
    expect(feedResult.ok).toBe(true);
    if (!feedResult.ok) throw new Error(feedResult.error.message);

    const topicFit = adapter.toTopicFit(guide.value.items);

    // --- Decision 1: idle + MINDFUL policy ⇒ SUGGEST the best
    //     candidate (a suggestion is non-binding; the scheduler never
    //     auto-starts playback).
    const vertical1 = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: guide.value.items,
      realizations: guide.value.realizations,
      constraints: [],
      allowedFormats: ["full", "segment", "clip"],
      objectiveFit: topicFit,
      policySelector: { policyId: "gm-night-policy", version: "2" },
      at: T1,
      requestId: "gm-req-1",
      idempotencyKey: "gm-idem-1",
    });
    const run1 = unwrapVertical(vertical1);

    for (const item of guide.value.items) expectValid(CatalogItemSchema, item);
    for (const realization of guide.value.realizations) expectValid(RealizationSchema, realization);
    for (const entry of run1.expansion.experiences) expectValid(ExperienceSchema, entry.experience);
    expectValid(DecisionRequestSchema, run1.request);
    expectValid(DecisionResultSchema, run1.result);

    expect(run1.decision.action).toBe("SUGGEST"); // mindful, never auto-start
    expect(run1.decision.selectedExperience?.itemId).toBe("gm-prog-field-notes");
    expect(run1.decision.nextState.status).toBe("idle"); // suggestion leaves the plan idle
    expect(run1.rewardApplied).toBe(false);

    // Honest absence for the unknown program.
    const ghostExclusion = run1.expansion.exclusions.find(
      (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === "gm-prog-ghost",
    );
    expect(ghostExclusion).toBeDefined();
    expect(ghostExclusion?.detail).toContain("no-catalog-item");

    // --- Host tune action (host-authoritative start — the user tuned
    //     in to the suggested program).
    const suggestedId = run1.decision.selectedExperienceId;
    expect(suggestedId).toBeDefined();
    if (suggestedId === undefined) throw new Error("no suggested experience");
    const tuneIntents = adapter.toSchedulerIntents({ kind: "tune", experienceId: suggestedId }, run1.decision.nextState);
    expect(tuneIntents.ok).toBe(true);
    if (!tuneIntents.ok) throw new Error(tuneIntents.error.message);
    expect(tuneIntents.value.planState).toEqual({
      status: "playing",
      currentExperienceId: suggestedId,
      queue: [],
      resumeCheckpoints: [],
    });

    const currentExperience = run1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === suggestedId,
    )?.experience;
    expect(currentExperience).toBeDefined();
    if (currentExperience === undefined) throw new Error("current experience missing");

    // --- Host flip action with explicit caller-supplied numbers.
    const flipTarget = run1.scored.find((entry) => entry.experience.itemId !== currentExperience.itemId);
    expect(flipTarget).toBeDefined();
    if (flipTarget === undefined) throw new Error("no flip target");
    const flipAction = adapter.toSchedulerIntents(
      {
        kind: "flip",
        numbers: {
          fromExperienceId: suggestedId,
          toExperienceId: flipTarget.experience.experienceId,
          expectedImprovement: 0.7,
          interruptionCost: 0.05,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      tuneIntents.value.planState ?? idleState(),
    );
    expect(flipAction.ok).toBe(true);
    if (!flipAction.ok) throw new Error(flipAction.error.message);

    // --- Decision 2: playing + flip input ⇒ SWITCH with a resume
    //     checkpoint (caller-supplied token, RESUME LAW).
    const vertical2 = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: guide.value.items,
      realizations: guide.value.realizations,
      constraints: [],
      allowedFormats: ["full", "segment", "clip"],
      objectiveFit: topicFit,
      policySelector: { policyId: "gm-night-policy", version: "2" },
      at: T2,
      requestId: "gm-req-2",
      idempotencyKey: "gm-idem-2",
      startState: tuneIntents.value.planState,
      currentExperience,
      intents: {
        switch: flipAction.value.switch,
        resumeTokens: { [suggestedId]: "gm-resume-token-1" },
      },
    });
    const run2 = unwrapVertical(vertical2);
    expectValid(DecisionRequestSchema, run2.request);
    expectValid(DecisionResultSchema, run2.result);

    expect(run2.decision.action).toBe("SWITCH");
    expect(run2.decision.selectedExperienceId).toBe(flipTarget.experience.experienceId);
    expect(run2.decision.resumeCheckpointSlot).toEqual({
      experienceId: suggestedId,
      resumeToken: "gm-resume-token-1",
      source: "SWITCH",
    });

    // --- Playout outcome for the flipped-to program (observed class).
    const targetItem = guide.value.items.find((item) => item.itemId === flipTarget.experience.itemId);
    expect(targetItem).toBeDefined();
    if (targetItem === undefined) throw new Error("target item missing");
    const targetDuration = flipTarget.experience.duration;
    const outcomeResult = adapter.toOutcomeEvent(
      {
        playoutId: "gm-pl-501",
        at: T3,
        programId: targetItem.itemId,
        experienceId: run2.decision.selectedExperienceId,
        decisionId: run2.result.decisionId,
        event: "finished",
        ...(typeof targetDuration === "number" ? { positionSeconds: targetDuration, totalSeconds: targetDuration } : {}),
      },
      { tenant, subject, evidenceClass: "controlled-local", contextId: contextResult.value.contextId },
    );
    expect(outcomeResult.ok).toBe(true);
    if (!outcomeResult.ok) throw new Error(outcomeResult.error.message);
    const outcome = expectValid(OutcomeEventSchema, outcomeResult.value);
    expect(outcome.eventType).toBe("completion");
    expect(outcome.decisionId).toBe(run2.result.decisionId);

    // --- Outcome → preference deltas close the vertical loop.
    const deltas = adapter.toPreferenceDeltas(outcome, targetItem);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    expect(deltas.value.length).toBeGreaterThan(0);
    for (const delta of deltas.value) expectValid(PreferenceDeltaSchema, delta);

    // --- Determinism across a full re-run.
    const replay1 = runVertical({
      tenant,
      subject,
      objective: goalResult.value,
      attentionPolicy: styleResult.value,
      context: contextResult.value,
      candidateSet: feedResult.value,
      items: guide.value.items,
      realizations: guide.value.realizations,
      constraints: [],
      allowedFormats: ["full", "segment", "clip"],
      objectiveFit: topicFit,
      policySelector: { policyId: "gm-night-policy", version: "2" },
      at: T1,
      requestId: "gm-req-1",
      idempotencyKey: "gm-idem-1",
    });
    const replayRun1 = unwrapVertical(replay1);
    expect(canonicalJson(replayRun1)).toBe(canonicalJson(run1));
  });
});
