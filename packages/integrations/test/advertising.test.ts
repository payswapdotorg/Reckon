/**
 * W3-008 — advertising reference adapter proof.
 *
 * Proves, from REAL commands run in this suite:
 * - the ad-shaped catalog maps into schema-valid frozen contracts
 *   (CatalogItem kind "advertising"/Realization with creative names,
 *   topics, flight windows and policy tags preserved as pass-through;
 *   each placement surface maps to its base contract FORMAT —
 *   in-stream "full", banner-slot "banner", feed-slot "in-feed",
 *   interstitial-gate "interstitial");
 * - host show/reserve/rotate/cut/wrap actions map into scheduler
 *   action inputs (host-authoritative plan-state transitions and the
 *   caller-supplied switch evaluation);
 * - ad server serving reports map into `OutcomeEvent`s carrying an
 *   OBSERVED evidence class (non-observed classes are typed errors);
 * - the FULL ADVERTISING VERTICAL — creative → placement/format →
 *   experience → show/defer/interrupt → outcome — runs end-to-end
 *   through the real W2 kernels (normalize → expand → policy →
 *   scheduler) with NO parallel scheduling path:
 *     SHOW    → QUEUE from the scheduler + host-authoritative "show"
 *               start (plan-state truth);
 *     DEFER   → a weak rotation (caller-supplied numbers below the
 *               suggest threshold) yields CONTINUE — the current spot
 *               is kept, ranking alone never interrupts (SEPARATION
 *               LAW);
 *     INTERRUPT → a strong rotation yields SWITCH (with a resume
 *               checkpoint) and a host "cut" yields INTERRUPT (with a
 *               resume checkpoint); the following decision RESUMEs
 *               the interrupted spot through the scheduler;
 *     OUTCOME → a viewed-through serving report becomes an
 *               observed-class OutcomeEvent, and impressions carry NO
 *               affinity evidence (delivery is not audience interest);
 * - every record at every stage validates against the frozen schemas;
 * - byte-identical determinism across repeated runs.
 *
 * Fixture evidence only — nothing here proves a live advertising
 * integration (ADVERTISING_ADAPTER_DECLARATION.liveVerification).
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
  createAdvertisingAdapter,
  ADVERTISING_ADAPTER_DECLARATION,
  type AdCatalogImport,
  type AdHostAction,
  type AdServingReport,
  type CampaignAim,
  type ObservedEvidenceClass,
} from "../src/index.js";
import { expectValid } from "./helpers.js";
import { idleState, runVertical, unwrapVertical } from "./vertical.js";

// ---------------------------------------------------------------------------
// Fixture (caller-supplied timestamps only — deterministic)
// ---------------------------------------------------------------------------

const T0 = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z (fixture epoch)
const T1 = T0 + 3_600_000; // session/decision 1 (slot opens)
const T2 = T0 + 3_615_000; // decision 2 (weak rotation — DEFER)
const T3 = T0 + 3_630_000; // decision 3 (strong rotation — SWITCH)
const T4 = T0 + 3_645_000; // decision 4 (host cut — INTERRUPT)
const T5 = T0 + 3_660_000; // decision 5 (RESUME)
const T6 = T0 + 7_200_000; // serving outcomes

const adapter = createAdvertisingAdapter();

const catalogImport: AdCatalogImport = {
  adServer: "ad-server-export",
  exportedAt: T0,
  creatives: [
    {
      creativeId: "ad-cr-alpine-video",
      name: "Alpine Outfitters 15s Spot",
      creativeKind: "video-spot",
      topics: ["outdoor", "hiking", "apparel"],
      flightStartsAt: T0,
      flightEndsAt: T0 + 2_592_000_000,
      policyTags: ["brand-safe"],
      placements: [
        {
          placementId: "ad-pl-alpine-instream",
          surface: "in-stream",
          locale: "en",
          maxDurationSeconds: 15,
          skippable: true,
          alternateCuts: ["clip"],
        },
      ],
    },
    {
      creativeId: "ad-cr-nimbus-banner",
      name: "Nimbus Cloud Banner",
      creativeKind: "display-banner",
      topics: ["software", "productivity"],
      policyTags: ["brand-safe"],
      placements: [
        {
          placementId: "ad-pl-nimbus-banner",
          surface: "banner-slot",
          maxDurationSeconds: 5,
          skippable: true,
        },
      ],
    },
    {
      creativeId: "ad-cr-harvest-feed",
      name: "Harvest Cereal Feed Card",
      creativeKind: "sponsored-listing",
      topics: ["grocery", "breakfast"],
      policyTags: ["reviewed"],
      placements: [
        {
          placementId: "ad-pl-harvest-feed",
          surface: "feed-slot",
          maxDurationSeconds: 10,
          skippable: false,
        },
      ],
    },
  ],
};

const servingSession = {
  viewerId: "ad-viewer-21",
  sessionId: "ad-ctx-evening-1",
  at: T1,
  device: "connected-tv" as const,
  networkKind: "wifi" as const,
  localTime: "20:45",
  timezone: "Europe/Berlin",
  minutesAvailable: 30,
  recentAdBreaks: 2,
  midBreak: true,
};

const tenant = { tenantId: "ad-tenant" };
const subject = { kind: "user" as const, ref: "ad-viewer-21" };

function standardMix() {
  return adapter.toCandidateSet({
    feedId: "ad-mix-evening-1",
    mixer: "campaign-mixer-v1",
    rows: [
      { creativeId: "ad-cr-alpine-video", rank: 1 },
      { creativeId: "ad-cr-nimbus-banner", rank: 2 },
      { creativeId: "ad-cr-harvest-feed", rank: 3 },
      { creativeId: "ad-cr-ghost", rank: 4 }, // unknown creative — honest absence
    ],
  });
}

// ---------------------------------------------------------------------------
// Declaration + catalog mapping
// ---------------------------------------------------------------------------

describe("W3-008 advertising adapter declaration", () => {
  it("declares fixture-only live verification and host-authoritative boundaries", () => {
    expect(ADVERTISING_ADAPTER_DECLARATION.adapterId).toBe("advertising-reference-adapter");
    expect(ADVERTISING_ADAPTER_DECLARATION.domain).toBe("advertising");
    expect(ADVERTISING_ADAPTER_DECLARATION.liveVerification).toEqual({
      status: "fixture-only",
      evidenceClass: "fixture",
      note: expect.any(String) as unknown as string,
    });
    // Host stays authoritative for the advertising gates (worker-3.md),
    // including campaign policy.
    for (const capability of [
      "identity",
      "consent-management",
      "rights-verification",
      "catalog-authoring",
      "provider-access",
      "creative-delivery",
      "campaign-policy",
      "payment",
      "live-provider-calls",
    ]) {
      expect(ADVERTISING_ADAPTER_DECLARATION.unsupportedCapabilities).toContain(capability);
    }
    for (const requirement of ADVERTISING_ADAPTER_DECLARATION.authorizationRequirements) {
      expect(["host", "reckon-api"]).toContain(requirement.enforcedBy);
    }
    expect(ADVERTISING_ADAPTER_DECLARATION.provenance.dataOwnership).toBe("host");
    expect(adapter.declaration).toBe(ADVERTISING_ADAPTER_DECLARATION);
  });
});

describe("W3-008 advertising catalog import", () => {
  it("maps creatives and placements into schema-valid CatalogItem/Realization records (kind advertising, surface formats)", () => {
    const result = adapter.importCatalog(catalogImport);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.items).toHaveLength(3);
    expect(result.value.realizations).toHaveLength(3);

    for (const item of result.value.items) {
      const parsed = expectValid(CatalogItemSchema, item);
      expect(parsed.kind).toBe("advertising");
    }
    const alpine = result.value.items[0] as CatalogItem;
    expect(alpine.itemId).toBe("ad-cr-alpine-video");
    expect(alpine.labels).toEqual(["apparel", "hiking", "outdoor", "video-spot"]);
    expect(alpine.attributes).toMatchObject({
      name: "Alpine Outfitters 15s Spot",
      creativeKind: "video-spot",
      policyTags: ["brand-safe"],
    });
    expect(alpine.availableFrom).toBe(T0);
    expect(alpine.availableUntil).toBe(T0 + 2_592_000_000);

    for (const realization of result.value.realizations) {
      expectValid(RealizationSchema, realization);
    }
    // Each placement surface maps to its base contract FORMAT plus the
    // declared cut-downs (entry 0 is the base format for the expander).
    const inStream = result.value.realizations.find((r) => r.realizationId === "ad-pl-alpine-instream");
    expect(inStream?.kind).toBe("in-stream");
    expect(inStream?.locale).toBe("en");
    expect(inStream?.constraints).toMatchObject({
      formats: ["full", "clip"],
      durationSeconds: 15,
      deviceClasses: ["tv", "desktop", "phone"],
      requiresScreen: true,
      requiresAudio: true,
      minBandwidth: "medium",
      skippable: true,
    });
    const banner = result.value.realizations.find((r) => r.realizationId === "ad-pl-nimbus-banner");
    expect(banner?.constraints).toMatchObject({
      formats: ["banner"],
      minBandwidth: "low",
      requiresAudio: false,
    });
    const feed = result.value.realizations.find((r) => r.realizationId === "ad-pl-harvest-feed");
    expect(feed?.constraints).toMatchObject({ formats: ["in-feed"], skippable: false });
  });

  it("rejects duplicate creative ids and duplicate placement ids (all-or-nothing)", () => {
    const duplicateCreative = adapter.importCatalog({
      adServer: "ad-server-export",
      exportedAt: T0,
      creatives: [
        catalogImport.creatives[0],
        { ...catalogImport.creatives[1], creativeId: "ad-cr-alpine-video" },
      ],
    });
    expect(duplicateCreative.ok).toBe(false);
    if (duplicateCreative.ok) throw new Error("expected failure");
    expect(duplicateCreative.error.code).toBe("INVALID_INPUT");
    expect(duplicateCreative.error.message).toContain("duplicate creativeId");

    const duplicatePlacement = adapter.importCatalog({
      adServer: "ad-server-export",
      exportedAt: T0,
      creatives: [
        catalogImport.creatives[0],
        { ...catalogImport.creatives[1], placements: [catalogImport.creatives[0].placements[0]] },
      ],
    });
    expect(duplicatePlacement.ok).toBe(false);
    if (duplicatePlacement.ok) throw new Error("expected failure");
    expect(duplicatePlacement.error.code).toBe("INVALID_INPUT");
    expect(duplicatePlacement.error.message).toContain("duplicate placementId");
  });

  it("returns typed issues for malformed host shapes and inverted flight windows (fail-closed)", () => {
    const malformed = adapter.importCatalog({
      adServer: "ad-server-export",
      exportedAt: T0,
      creatives: [
        {
          creativeId: "bad",
          name: "",
          creativeKind: "video-spot",
          topics: [],
          policyTags: ["x"],
          placements: [],
        },
      ],
    } as unknown as AdCatalogImport);
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("expected failure");
    expect(malformed.error.code).toBe("INVALID_INPUT");
    expect(malformed.error.issues?.length).toBeGreaterThan(0);

    const inverted = adapter.importCatalog({
      adServer: "ad-server-export",
      exportedAt: T0,
      creatives: [
        {
          creativeId: "ad-cr-x",
          name: "X",
          creativeKind: "video-spot",
          topics: ["t"],
          flightStartsAt: T0 + 1000,
          flightEndsAt: T0,
          policyTags: [],
          placements: [
            { placementId: "ad-pl-x", surface: "banner-slot", skippable: true },
          ],
        },
      ],
    });
    expect(inverted.ok).toBe(false);
    if (inverted.ok) throw new Error("expected failure");
    expect(inverted.error.issues?.some((i) => i.path === "creatives[0].flightEndsAt")).toBe(true);
  });

  it("enforces the declared import limits with typed LIMIT_EXCEEDED errors", () => {
    const limit = ADVERTISING_ADAPTER_DECLARATION.limits.maxItemsPerImport;
    const creatives = Array.from({ length: limit + 1 }, (_, index) => ({
      creativeId: `ad-cr-bulk-${index}`,
      name: `Bulk ${index}`,
      creativeKind: "video-spot" as const,
      topics: ["bulk"],
      policyTags: [],
      placements: [
        { placementId: `ad-pl-bulk-${index}`, surface: "banner-slot" as const, skippable: true },
      ],
    }));
    const result = adapter.importCatalog({ adServer: "ad-server-export", exportedAt: T0, creatives });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("LIMIT_EXCEEDED");
    expect(result.error.message).toContain(`${limit + 1}`);
  });
});

// ---------------------------------------------------------------------------
// Retrieval / context / objective / attention mappings
// ---------------------------------------------------------------------------

describe("W3-008 advertising retrieval/context/objective/attention mappings", () => {
  it("maps campaign mix rows into a schema-valid CandidateSet with rank hints and provenance", () => {
    const result = standardMix();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(CandidateSetSchema, result.value);
    expect(parsed.setId).toBe("ad-mix-evening-1");
    expect(parsed.candidates).toHaveLength(4);
    expect(parsed.candidates[0]).toMatchObject({
      itemId: "ad-cr-alpine-video",
      realizationIds: [],
      source: "campaign-mixer-v1",
      rankHint: 1,
    });
    expect(parsed.provenance).toEqual({ system: "campaign-mixer-v1", correlationId: "ad-mix-evening-1" });
  });

  it("maps a serving session into a schema-valid ContextSnapshot (device, day-part, attention, fatigue)", () => {
    const result = adapter.toContextSnapshot(servingSession);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(ContextSnapshotSchema, result.value);
    expect(parsed.contextId).toBe("ad-ctx-evening-1");
    expect(parsed.device).toEqual({ class: "tv" });
    expect(parsed.network).toEqual({ class: "wifi" });
    expect(parsed.time).toEqual({ localTime: "20:45", timezone: "Europe/Berlin", dayPart: "evening" });
    expect(parsed.attention).toEqual({ availableMs: 1_800_000 });
    expect(parsed.fatigue).toEqual({ recentInterruptions: 2 });
    expect(parsed.activity).toEqual(["mid-break"]);
  });

  it("rejects malformed local times and empty mix feeds with typed errors", () => {
    const badTime = adapter.toContextSnapshot({ ...servingSession, localTime: "7:00" });
    expect(badTime.ok).toBe(false);
    if (badTime.ok) throw new Error("expected failure");
    expect(badTime.error.issues?.some((i) => i.path === "localTime")).toBe(true);

    const emptyMix = adapter.toCandidateSet({ feedId: "ad-mix-empty", mixer: "m", rows: [] });
    expect(emptyMix.ok).toBe(false);
    if (emptyMix.ok) throw new Error("expected failure");
    expect(emptyMix.error.issues?.some((i) => i.path === "rows")).toBe(true);
  });

  it("maps campaign aims and delivery modes into schema-valid Objectives and AttentionPolicies", () => {
    const cases: [CampaignAim["aim"], string][] = [
      ["awareness", "discover"],
      ["consideration", "compare"],
      ["conversion", "complete-task"],
      ["re-engage", "catch-up"],
    ];
    for (const [aim, kind] of cases) {
      const result = adapter.toObjective({ aim, targetingTopics: ["outdoor"] });
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const parsed = expectValid(ObjectiveSchema, result.value);
      expect(parsed.kind).toBe(kind);
      expect(parsed.objectiveId).toBe(`ad-goal-${aim}`);
      expect(parsed.params).toEqual({ targetingTopics: ["outdoor"] });
    }
    for (const [mode, style] of [
      ["light", "mindful"],
      ["standard", "balanced"],
      ["blitz", "immersive"],
    ] as const) {
      const result = adapter.toAttentionPolicy(mode);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const parsed = expectValid(AttentionPolicySchema, result.value);
      expect(parsed.style).toBe(style);
      expect(parsed.policyId).toBe(`ad-attention-${mode}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Host actions → scheduler action inputs
// ---------------------------------------------------------------------------

describe("W3-008 advertising host actions → scheduler action inputs", () => {
  it("maps show to a host-authoritative plan-state transition (queue entry consumed)", () => {
    const queued = idleState();
    queued.status = "queued";
    queued.queue = ["ad-exp-1", "ad-exp-2"];
    const result = adapter.toSchedulerIntents({ kind: "show", experienceId: "ad-exp-2" }, queued);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "ad-exp-2",
      queue: ["ad-exp-1"],
      resumeCheckpoints: [],
    });
  });

  it("maps reserve without interrupting an active spot, and never duplicates entries", () => {
    const playing = {
      status: "playing" as const,
      currentExperienceId: "ad-exp-1",
      queue: [],
      resumeCheckpoints: [],
    };
    const result = adapter.toSchedulerIntents({ kind: "reserve", experienceIds: ["ad-exp-2", "ad-exp-2", "ad-exp-3"] }, playing);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState).toEqual({
      status: "playing",
      currentExperienceId: "ad-exp-1",
      queue: ["ad-exp-2", "ad-exp-3"],
      resumeCheckpoints: [],
    });
  });

  it("maps reserve from idle to the queued status", () => {
    const result = adapter.toSchedulerIntents({ kind: "reserve", experienceIds: ["ad-exp-9"] }, idleState());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.planState?.status).toBe("queued");
  });

  it("maps rotate numbers to the caller-supplied SwitchEvaluationInput (SEPARATION LAW passthrough)", () => {
    const result = adapter.toSchedulerIntents(
      {
        kind: "rotate",
        numbers: {
          fromExperienceId: "ad-exp-1",
          toExperienceId: "ad-exp-2",
          expectedImprovement: 0.7,
          interruptionCost: 0.05,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      { status: "playing", currentExperienceId: "ad-exp-1", queue: [], resumeCheckpoints: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.switch).toEqual({
      currentExperienceId: "ad-exp-1",
      candidateExperienceId: "ad-exp-2",
      expectedImprovement: 0.7,
      interruptionCost: 0.05,
      uncertaintyPenalty: 0.05,
      resumeLoss: 0,
      switchThreshold: 0.5,
      suggestThreshold: 0.2,
    });
  });

  it("maps cut (with host resume token) and wrap actions to scheduler flags", () => {
    const cut = adapter.toSchedulerIntents(
      { kind: "cut", experienceId: "ad-exp-1", resumeToken: "ad-spot-offset-12s" },
      { status: "playing", currentExperienceId: "ad-exp-1", queue: [], resumeCheckpoints: [] },
    );
    expect(cut.ok).toBe(true);
    if (!cut.ok) throw new Error(cut.error.message);
    expect(cut.value.interruptRequested).toBe(true);
    expect(cut.value.resumeTokens).toEqual({ "ad-exp-1": "ad-spot-offset-12s" });

    const wrap = adapter.toSchedulerIntents({ kind: "wrap" }, idleState());
    expect(wrap.ok).toBe(true);
    if (!wrap.ok) throw new Error(wrap.error.message);
    expect(wrap.value.endRequested).toBe(true);
  });

  it("rejects host actions against a terminal plan and malformed action shapes", () => {
    const ended = { status: "ended" as const, queue: [], resumeCheckpoints: [] };
    const show = adapter.toSchedulerIntents({ kind: "show", experienceId: "ad-exp-1" }, ended);
    expect(show.ok).toBe(false);
    if (show.ok) throw new Error("expected failure");
    expect(show.error.code).toBe("INVALID_INPUT");
    expect(show.error.message).toContain("ended");

    const malformed = adapter.toSchedulerIntents({ kind: "rotate", numbers: { fromExperienceId: "" } } as unknown as AdHostAction, idleState());
    expect(malformed.ok).toBe(false);
    if (malformed.ok) throw new Error("expected failure");
    expect(malformed.error.issues?.length).toBeGreaterThan(0);

    const unknown = adapter.toSchedulerIntents({ kind: "boost" } as unknown as AdHostAction, idleState());
    expect(unknown.ok).toBe(false);
    if (unknown.ok) throw new Error("expected failure");
    expect(unknown.error.message).toContain("show, reserve, rotate, cut or wrap");
  });
});

// ---------------------------------------------------------------------------
// Serving outcomes
// ---------------------------------------------------------------------------

describe("W3-008 advertising serving outcomes", () => {
  const baseReport: AdServingReport = {
    impressionId: "ad-imp-401",
    at: T6,
    creativeId: "ad-cr-alpine-video",
    event: "viewed-through",
    viewSeconds: 15,
    totalSeconds: 15,
  };

  it("maps serving reports to schema-valid OutcomeEvents with observed evidence classes", () => {
    const result = adapter.toOutcomeEvent(baseReport, {
      tenant,
      subject,
      evidenceClass: "controlled-local",
      contextId: "ad-ctx-evening-1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    const parsed = expectValid(OutcomeEventSchema, result.value);
    expect(parsed.eventType).toBe("completion");
    expect(parsed.evidenceClass).toBe("controlled-local");
    expect(parsed.subject).toEqual(subject);
    expect(parsed.metrics).toMatchObject({ viewSeconds: 15, totalSeconds: 15, viewThroughRatio: 1 });
    expect(parsed.provenance).toEqual({ system: "ad-serving", version: "1" });
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
    const rendered = adapter.toOutcomeEvent({ ...baseReport, event: "rendered" }, { tenant, subject, evidenceClass: "staging" });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw new Error(rendered.error.message);
    expect(rendered.value.idempotencyKey).not.toBe(first.value.idempotencyKey);
  });

  it("maps every serving event kind to its contract outcome type", () => {
    const expected: [AdServingReport["event"], OutcomeEvent["eventType"]][] = [
      ["rendered", "impression"],
      ["spot-started", "start"],
      ["viewed-through", "completion"],
      ["left", "abandonment"],
      ["skipped", "skip"],
      ["clicked", "conversion"],
      ["dismissed", "interruption-reject"],
      ["saved", "save"],
      ["shared", "share"],
      ["praised", "explicit-feedback"],
    ];
    for (const [event, eventType] of expected) {
      const result = adapter.toOutcomeEvent(
        { impressionId: `ad-imp-${event}`, at: T6, creativeId: "ad-cr-alpine-video", event },
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

describe("W3-008 advertising preference deltas", () => {
  function observedOutcome(eventType: OutcomeEvent["eventType"]): OutcomeEvent {
    const result = adapter.toOutcomeEvent(
      { impressionId: `ad-imp-${eventType}`, at: T6, creativeId: "ad-cr-alpine-video", event: "viewed-through" },
      { tenant, subject, evidenceClass: "controlled-local", contextId: "ad-ctx-evening-1" },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    return { ...result.value, eventType };
  }

  it("maps an observed view-through to deterministic topic-affinity PreferenceDeltas", () => {
    const outcome = observedOutcome("completion");
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const alpine = catalog.value.items[0] as CatalogItem;

    const deltas = adapter.toPreferenceDeltas(outcome, alpine);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    // alpine labels: apparel, hiking, outdoor, video-spot (sorted, capped 8)
    expect(deltas.value).toHaveLength(4);
    for (const delta of deltas.value) {
      const parsed = expectValid(PreferenceDeltaSchema, delta);
      expect(parsed.dimension).toMatch(/^advertising\.topic-affinity:/);
      expect(parsed.op).toBe("add");
      expect(parsed.value).toBe(0.25);
      expect(parsed.confidenceDelta).toBe(0.2);
      expect(parsed.model).toEqual({ modelId: "advertising-affinity-v1", version: "1" });
      expect(parsed.scope).toEqual({ contextId: "ad-ctx-evening-1" });
    }
  });

  it("maps an observed IMPRESSION to NO delta (delivery is not audience interest — never fabricated)", () => {
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const alpine = catalog.value.items[0] as CatalogItem;
    const deltas = adapter.toPreferenceDeltas(observedOutcome("impression"), alpine);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    expect(deltas.value).toEqual([]);
  });

  it("maps conversion/feedback/skip/abandonment with the documented signed values", () => {
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const alpine = catalog.value.items[0] as CatalogItem;
    const expected: [OutcomeEvent["eventType"], number, number][] = [
      ["conversion", 0.5, 0.6],
      ["explicit-feedback", 0.5, 0.6],
      ["skip", -0.05, 0.05],
      ["abandonment", -0.1, 0.1],
    ];
    for (const [eventType, value, confidenceDelta] of expected) {
      const deltas = adapter.toPreferenceDeltas(observedOutcome(eventType), alpine);
      expect(deltas.ok).toBe(true);
      if (!deltas.ok) throw new Error(deltas.error.message);
      expect(deltas.value.length).toBeGreaterThan(0);
      for (const delta of deltas.value) {
        expect(delta.value).toBe(value);
        expect(delta.confidenceDelta).toBe(confidenceDelta);
      }
    }
  });

  it("rejects research-class outcomes on the runtime learning path (ADR-004)", () => {
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const alpine = catalog.value.items[0] as CatalogItem;
    const simulatedOutcome = { ...observedOutcome("completion"), evidenceClass: "simulated" as const };
    const result = adapter.toPreferenceDeltas(simulatedOutcome, alpine);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error.code).toBe("UNSUPPORTED_EVIDENCE_CLASS");
  });
});

// ---------------------------------------------------------------------------
// THE FULL ADVERTISING VERTICAL (creative → placement/format →
// experience → show/defer/interrupt → outcome) through the EXISTING
// scheduler actions only: QUEUE → show (host) → CONTINUE (defer) →
// SWITCH → INTERRUPT (host cut) → RESUME → outcome → deltas.
// ---------------------------------------------------------------------------

describe("W3-008 advertising full vertical: creative → placement/format → experience → show/defer/interrupt → outcome", () => {
  it("runs end-to-end through the real kernels with NO parallel scheduling path", () => {
    // --- Adapter mappings (host shapes → frozen contracts).
    const catalog = adapter.importCatalog(catalogImport);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error(catalog.error.message);
    const contextResult = adapter.toContextSnapshot(servingSession);
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) throw new Error(contextResult.error.message);
    const aimResult = adapter.toObjective({ aim: "awareness", targetingTopics: ["outdoor", "hiking", "apparel"] });
    expect(aimResult.ok).toBe(true);
    if (!aimResult.ok) throw new Error(aimResult.error.message);
    const modeResult = adapter.toAttentionPolicy("standard"); // → balanced
    expect(modeResult.ok).toBe(true);
    if (!modeResult.ok) throw new Error(modeResult.error.message);
    const mixResult = standardMix();
    expect(mixResult.ok).toBe(true);
    if (!mixResult.ok) throw new Error(mixResult.error.message);

    const objectiveFit = adapter.toObjectiveFit(catalog.value.items);
    const allowedFormats = ["full", "clip", "banner", "in-feed", "interstitial"] as const;

    // --- Decision 1: the ad slot opens (idle) + balanced policy ⇒ the
    //     scheduler QUEUES the best creative. The scheduler never
    //     auto-starts; SHOWING is host-authoritative.
    const vertical1 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T1,
      requestId: "ad-req-1",
      idempotencyKey: "ad-idem-1",
    });
    const run1 = unwrapVertical(vertical1);

    // Every stage record is a schema-valid frozen contract.
    for (const item of catalog.value.items) expectValid(CatalogItemSchema, item);
    for (const realization of catalog.value.realizations) expectValid(RealizationSchema, realization);
    for (const entry of run1.expansion.experiences) expectValid(ExperienceSchema, entry.experience);
    expectValid(DecisionRequestSchema, run1.request);
    expectValid(DecisionResultSchema, run1.result);

    expect(run1.decision.action).toBe("QUEUE");
    expect(run1.rewardApplied).toBe(false);
    // The best fit is the Alpine spot (targeting: outdoor + hiking +
    // apparel = 3/3); the in-stream placement expands full + clip.
    expect(run1.decision.selectedExperience?.itemId).toBe("ad-cr-alpine-video");
    expect(run1.expansion.experiences.filter((e) => e.experience.itemId === "ad-cr-alpine-video")).toHaveLength(2);

    // Honest absence: the unknown mix row is an exclusion, never an
    // invented experience.
    const ghostExclusion = run1.expansion.exclusions.find(
      (exclusion) => exclusion.kind === "candidate-unavailable" && exclusion.itemId === "ad-cr-ghost",
    );
    expect(ghostExclusion).toBeDefined();
    expect(ghostExclusion?.detail).toContain("no-catalog-item");

    // --- SHOW: host show action → host-authoritative plan state (the
    //     ad server starts serving the queued creative).
    const showingId = run1.decision.selectedExperienceId;
    expect(showingId).toBeDefined();
    if (showingId === undefined) throw new Error("no selected experience");
    const showIntents = adapter.toSchedulerIntents({ kind: "show", experienceId: showingId }, run1.decision.nextState);
    expect(showIntents.ok).toBe(true);
    if (!showIntents.ok) throw new Error(showIntents.error.message);
    expect(showIntents.value.planState?.status).toBe("playing");
    expect(showIntents.value.planState?.currentExperienceId).toBe(showingId);

    const currentExperience = run1.expansion.experiences.find(
      (entry) => entry.experience.experienceId === showingId,
    )?.experience;
    expect(currentExperience).toBeDefined();
    if (currentExperience === undefined) throw new Error("current experience missing");

    const rotateTarget = run1.scored.find((entry) => entry.experience.itemId !== currentExperience.itemId);
    expect(rotateTarget).toBeDefined();
    if (rotateTarget === undefined) throw new Error("no rotate target");

    // --- DEFER: weak rotation numbers (net 0 < suggestThreshold 0.2)
    //     ⇒ the scheduler CONTINUEs the current spot. Ranking alone
    //     never interrupts (SEPARATION LAW); a weak moment to rotate
    //     is DEFERRED, not forced.
    const deferRotate = adapter.toSchedulerIntents(
      {
        kind: "rotate",
        numbers: {
          fromExperienceId: showingId,
          toExperienceId: rotateTarget.experience.experienceId,
          expectedImprovement: 0.1,
          interruptionCost: 0.05,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      showIntents.value.planState ?? idleState(),
    );
    expect(deferRotate.ok).toBe(true);
    if (!deferRotate.ok) throw new Error(deferRotate.error.message);

    const vertical2 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T2,
      requestId: "ad-req-2",
      idempotencyKey: "ad-idem-2",
      startState: showIntents.value.planState,
      currentExperience,
      intents: { switch: deferRotate.value.switch },
    });
    const run2 = unwrapVertical(vertical2);
    expect(run2.decision.action).toBe("CONTINUE");
    expect(run2.decision.selectedExperienceId).toBe(showingId);
    expect(run2.decision.reasons.some((r) => r.code === "switch-below-threshold")).toBe(true);

    // --- INTERRUPT (rotation form): strong rotation numbers
    //     (net 0.7 > switchThreshold 0.5) ⇒ SWITCH to the better
    //     creative with a resume checkpoint for the interrupted spot.
    const strongRotate = adapter.toSchedulerIntents(
      {
        kind: "rotate",
        numbers: {
          fromExperienceId: showingId,
          toExperienceId: rotateTarget.experience.experienceId,
          expectedImprovement: 0.9,
          interruptionCost: 0.1,
          uncertaintyPenalty: 0.05,
          resumeLoss: 0.05,
          switchThreshold: 0.5,
          suggestThreshold: 0.2,
        },
      },
      run2.decision.nextState,
    );
    expect(strongRotate.ok).toBe(true);
    if (!strongRotate.ok) throw new Error(strongRotate.error.message);

    const vertical3 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T3,
      requestId: "ad-req-3",
      idempotencyKey: "ad-idem-3",
      startState: run2.decision.nextState,
      currentExperience,
      intents: {
        switch: strongRotate.value.switch,
        resumeTokens: { [showingId]: "ad-spot-offset-6s" },
      },
    });
    const run3 = unwrapVertical(vertical3);
    expect(run3.decision.action).toBe("SWITCH");
    expect(run3.decision.selectedExperienceId).toBe(rotateTarget.experience.experienceId);
    expect(run3.decision.resumeCheckpointSlot).toEqual({
      experienceId: showingId,
      resumeToken: "ad-spot-offset-6s",
      source: "SWITCH",
    });

    const rotatedExperience = rotateTarget.experience;

    // --- INTERRUPT (host cut form): the host cuts the rotated spot
    //     short; the scheduler emits INTERRUPT with a resume
    //     checkpoint (RESUME LAW: token caller-supplied).
    const cutIntents = adapter.toSchedulerIntents(
      { kind: "cut", experienceId: rotatedExperience.experienceId, resumeToken: "ad-spot-offset-9s" },
      run3.decision.nextState,
    );
    expect(cutIntents.ok).toBe(true);
    if (!cutIntents.ok) throw new Error(cutIntents.error.message);
    expect(cutIntents.value.interruptRequested).toBe(true);
    expect(cutIntents.value.resumeTokens).toEqual({ [rotatedExperience.experienceId]: "ad-spot-offset-9s" });

    const vertical4 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T4,
      requestId: "ad-req-4",
      idempotencyKey: "ad-idem-4",
      startState: run3.decision.nextState,
      currentExperience: rotatedExperience,
      intents: {
        interruptRequested: cutIntents.value.interruptRequested,
        resumeTokens: cutIntents.value.resumeTokens,
      },
    });
    const run4 = unwrapVertical(vertical4);
    expect(run4.decision.action).toBe("INTERRUPT");
    expect(run4.decision.nextState.status).toBe("interrupted");
    expect(run4.decision.nextState.interruptedExperienceId).toBe(rotatedExperience.experienceId);
    expect(run4.decision.resumeCheckpointSlot).toEqual({
      experienceId: rotatedExperience.experienceId,
      resumeToken: "ad-spot-offset-9s",
      source: "INTERRUPT",
    });
    expect(run4.decision.scheduleDelta.resumeCheckpoint).toEqual({
      experienceId: rotatedExperience.experienceId,
      resumeToken: "ad-spot-offset-9s",
    });

    // --- RESUME: from interrupted with a resumable checkpoint, the
    //     scheduler RESUMEs the interrupted spot (the viewer returns
    //     to their own interrupted state — no new attention action).
    const vertical5 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T5,
      requestId: "ad-req-5",
      idempotencyKey: "ad-idem-5",
      startState: run4.decision.nextState,
    });
    const run5 = unwrapVertical(vertical5);
    expect(run5.decision.action).toBe("RESUME");
    expect(run5.decision.selectedExperienceId).toBe(rotatedExperience.experienceId);
    expect(run5.decision.resume).toEqual({
      experienceId: rotatedExperience.experienceId,
      resumeToken: "ad-spot-offset-9s",
      position: {},
    });
    expect(run5.decision.nextState.status).toBe("playing");
    expect(run5.decision.nextState.currentExperienceId).toBe(rotatedExperience.experienceId);

    // Every scheduler action in this vertical is one of the EXISTING
    // frozen actions (architecture-lock #11) — no parallel path.
    for (const run of [run1, run2, run3, run4, run5]) {
      expect(["HOLD", "CONTINUE", "QUEUE", "SUGGEST", "SWITCH", "INTERRUPT", "RESUME", "END"]).toContain(
        run.decision.action,
      );
    }

    // --- OUTCOME: viewed-through serving report for the resumed spot
    //     (observed class), linked to the RESUME decision.
    const targetItem = catalog.value.items.find((item) => item.itemId === rotatedExperience.itemId);
    expect(targetItem).toBeDefined();
    if (targetItem === undefined) throw new Error("target item missing");
    const outcomeResult = adapter.toOutcomeEvent(
      {
        impressionId: "ad-imp-901",
        at: T6,
        creativeId: targetItem.itemId,
        experienceId: run5.decision.selectedExperienceId,
        decisionId: run5.result.decisionId,
        event: "viewed-through",
        viewSeconds: 10,
        totalSeconds: 10,
      },
      { tenant, subject, evidenceClass: "controlled-local", contextId: contextResult.value.contextId },
    );
    expect(outcomeResult.ok).toBe(true);
    if (!outcomeResult.ok) throw new Error(outcomeResult.error.message);
    const outcome = expectValid(OutcomeEventSchema, outcomeResult.value);
    expect(outcome.eventType).toBe("completion");
    expect(outcome.decisionId).toBe(run5.result.decisionId);
    expect(outcome.experienceId).toBe(run5.decision.selectedExperienceId);
    expect(outcome.evidenceClass).toBe("controlled-local");

    // --- Outcome → preference deltas close the vertical loop.
    const deltas = adapter.toPreferenceDeltas(outcome, targetItem);
    expect(deltas.ok).toBe(true);
    if (!deltas.ok) throw new Error(deltas.error.message);
    expect(deltas.value.length).toBeGreaterThan(0);
    for (const delta of deltas.value) expectValid(PreferenceDeltaSchema, delta);

    // --- Determinism: the first decision is byte-identical when
    //     re-run from the same fixture.
    const replay1 = runVertical({
      tenant,
      subject,
      objective: aimResult.value,
      attentionPolicy: modeResult.value,
      context: contextResult.value,
      candidateSet: mixResult.value,
      items: catalog.value.items,
      realizations: catalog.value.realizations,
      constraints: [],
      allowedFormats: [...allowedFormats],
      objectiveFit,
      policySelector: { policyId: "ad-evening-policy", version: "1" },
      at: T1,
      requestId: "ad-req-1",
      idempotencyKey: "ad-idem-1",
    });
    const replayRun1 = unwrapVertical(replay1);
    expect(canonicalJson(replayRun1)).toBe(canonicalJson(run1));
  });
});
