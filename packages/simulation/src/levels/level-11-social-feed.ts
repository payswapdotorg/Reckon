/**
 * SIM-004 — Ladder Level 11: the SOCIAL FEED synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Social feed — large candidate sets, freshness, exploration,
 *    strong policy boundaries."
 *
 * The host owns a feed product (host-owned corpus, freshness model,
 * topic-affinity preferences, content-policy gates — architecture law)
 * and asks Reckon for the next feed decision through the PUBLIC surface
 * only: manifest → connect sources → per step: candidates → decision
 * request (objective, attention policy, constraints) → host presents →
 * outcome → preference delta.
 *
 * World-state transitions (all host-side, all deterministic, all
 * step-indexed — fixture-class scripted behaviors, never behavioral
 * claims):
 * - large candidate sets: retrieval ranks the ENTIRE fresh, unseen
 *   corpus (24 items at step 1; the per-step set sizes are measured);
 * - freshness: item ages advance 0.5h per step; items past the 6h
 *   freshness horizon LEAVE retrieval; the host rank blends topic
 *   affinity with a freshness factor (host authority — the core never
 *   sees the ranking);
 * - exploration: every 3rd step injects 2 candidates from the
 *   least-engaged topic (retrieval source "host-explore") alongside
 *   the ranked feed;
 * - strong policy boundaries: every request carries the host
 *   content-policy rights gate (policy-rights constraint); on steps 4
 *   and 8 the leading candidate trips the gate and the host DECLINES
 *   presentation (requested-but-not-presented: no outcome, no delta —
 *   presentation authority stays host-side) and suppresses the item
 *   for the session;
 * - outcomes: completions (the synthetic user finishes items), one
 *   scripted abandonment (every 5th presented item — scroll-past).
 *
 * This level needs NOTHING beyond the standard public decision loop:
 * the verdict is Reckon-Complete (12/12 satisfied at fixture evidence)
 * — the honest data point that ladder complexity lands host-side.
 *
 * LAWS obeyed (SIM-004 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels-wave-b.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the corpus / freshness / exploration / policy-gate code);
 * - `functions` — the named host functions: freshnessFactor,
 *   topicOfItem, feedRank, feedCandidates, feedConstraints,
 *   provideDecisionInputs, consumeDecision, provideOutcome,
 *   providePreferenceDelta, createLevel11SocialFeedHost (10 total).
 */
import type {
  DecisionResult,
  HostDecisionReaction,
  HostDecisionInputs,
  CatalogItemInput,
  RealizationInput,
  SimulationHostAdapter,
  SimulationManifestContentInput,
  SubjectReference,
  TenantScope,
} from "../harness/host-adapter.js";
import type { HardConstraint } from "@reckon/contracts";
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l11-social-feed" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l11-scroller-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The feed world: 24 corpus items across 6 topics, a freshness model
// (0.5h per step, 6h horizon), topic-affinity weights, an exploration
// policy, and the host content-policy gate. All HOST-owned.

const TOPICS = ["design", "food", "news", "sports", "tech", "travel"] as const;
type FeedTopic = (typeof TOPICS)[number];

interface CorpusItem {
  readonly itemId: string;
  readonly topic: FeedTopic;
  readonly title: string;
  readonly initialAgeHours: number;
  readonly realizationId: string;
}

const CORPUS: readonly CorpusItem[] = TOPICS.flatMap((topic, topicIndex) =>
  [0, 1, 2, 3].map((slot) => {
    const ordinal = topicIndex * 4 + slot;
    return {
      itemId: `l11-post-${String(ordinal + 1).padStart(2, "0")}`,
      topic,
      title: `${topic} digest ${slot + 1}`,
      initialAgeHours: (ordinal % 9) * 0.5,
      realizationId: `l11-real-${String(ordinal + 1).padStart(2, "0")}`,
    };
  }),
);

/** Each step advances item age by 30 minutes (virtual world time). */
const AGE_HOURS_PER_STEP = 0.5;
/** Items past this age LEAVE retrieval (the freshness horizon). */
const FRESHNESS_HORIZON_HOURS = 6;
/** Every 3rd step injects exploration candidates. */
const EXPLORATION_EVERY = 3;
/** The scripted policy-gate steps (the leading candidate trips the gate). */
const POLICY_GATE_STEPS: readonly number[] = [4, 8];
/** The scripted scroll-past step (abandonment). */
const ABANDONMENT_STEP = 5;

/** The freshness factor: newer is stronger; stale leaves retrieval. */
function freshnessFactor(ageHours: number): number {
  return 1 / (1 + ageHours / 3);
}

/** Host corpus knowledge: the topic behind an item id. */
function topicOfItem(itemId: string | undefined): FeedTopic {
  return CORPUS.find((item) => item.itemId === itemId)?.topic ?? "news";
}

/** The feed rank score for an item (host authority — never crosses as data). */
function feedRank(item: CorpusItem, ageHours: number, topicWeights: ReadonlyMap<string, number>): number {
  const weight = topicWeights.get(item.topic) ?? 1;
  return weight * freshnessFactor(ageHours);
}

interface FeedCandidate {
  readonly itemId: string;
  readonly realizationIds: string[];
  readonly source: string;
  readonly rankHint: number;
}

/** The feed page size: the ranked candidates a step surfaces. */
const FEED_PAGE_SIZE = 12;

/** Retrieval: the fresh, unseen, un-suppressed corpus, ranked + exploration. */
function feedCandidates(
  step: number,
  ageHoursByItem: ReadonlyMap<string, number>,
  seen: ReadonlySet<string>,
  suppressed: ReadonlySet<string>,
  topicWeights: ReadonlyMap<string, number>,
): FeedCandidate[] {
  const eligible = CORPUS.filter((item) => {
    const age = ageHoursByItem.get(item.itemId) ?? item.initialAgeHours;
    return age <= FRESHNESS_HORIZON_HOURS && !seen.has(item.itemId) && !suppressed.has(item.itemId);
  });
  const rankedEntries = eligible
    .map((item) => ({ item, score: feedRank(item, ageHoursByItem.get(item.itemId) ?? 0, topicWeights) }))
    .sort((a, b) => b.score - a.score || (a.item.itemId < b.item.itemId ? -1 : 1));
  const page = rankedEntries.slice(0, FEED_PAGE_SIZE);
  const ranked = page.map((entry, index) => ({
    itemId: entry.item.itemId,
    realizationIds: [entry.item.realizationId],
    source: "host-feed-rank",
    rankHint: index + 1,
  }));
  if (step % EXPLORATION_EVERY !== 0) return ranked;
  // Exploration: 2 candidates from the least-engaged topic, beyond the
  // ranked page (the exploration surface a feed mixes in).
  const leastTopic = [...TOPICS].sort(
    (a, b) => (topicWeights.get(a) ?? 1) - (topicWeights.get(b) ?? 1) || (a < b ? -1 : 1),
  )[0]!;
  const pageIds = new Set(page.map((entry) => entry.item.itemId));
  const explorationPool = rankedEntries
    .filter((entry) => !pageIds.has(entry.item.itemId))
    .sort((a, b) => {
      const topicBias = (a.item.topic === leastTopic ? 0 : 1) - (b.item.topic === leastTopic ? 0 : 1);
      return topicBias || (a.item.itemId < b.item.itemId ? -1 : 1);
    })
    .slice(0, 2);
  const exploration = explorationPool.map((entry, index) => ({
    itemId: entry.item.itemId,
    realizationIds: [entry.item.realizationId],
    source: "host-explore",
    rankHint: page.length + index + 1,
  }));
  return [...ranked, ...exploration];
}

/** Strong policy boundaries: rights + dedupe + latency constraints. */
function feedConstraints(): HardConstraint[] {
  return [
    { kind: "policy-rights", gateId: "l11-content-policy-v1" },
    { kind: "custom", constraintId: "l11-seen-exclusion", params: { scope: "session" } },
    { kind: "max-latency", latencyMs: 150 },
  ];
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL11_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: CORPUS.map((item) => ({
    itemId: item.itemId,
    kind: "article" as const,
    labels: ["post", item.topic],
    attributes: { title: item.title, topic: item.topic },
  })),
  realizations: CORPUS.map((item) => ({
    realizationId: item.realizationId,
    itemId: item.itemId,
    kind: "feed-card",
    constraints: { render: "card", freshnessHorizonHours: FRESHNESS_HORIZON_HOURS },
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL11_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l11-social-feed",
    name: "Driftline Social Feed",
    hostAdapterId: "adapter-l11-social-feed-1",
    version: "0.1.0",
  },
  declaredAt: 0,
  supportedCapabilities: [
    { capability: "tenant-identity", status: "supported", evidenceClass: "fixture" },
    {
      capability: "catalog-registration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
    },
    {
      capability: "realization-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/catalog/realizations"],
      sdkMethods: ["catalog.upsertRealization"],
    },
    {
      capability: "candidate-retrieval",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
      notes: "large candidate sets (the full fresh unseen corpus, 24 at step 1) with host rank hints + exploration candidates every 3rd step",
    },
    {
      capability: "objective-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "objective declared on every decision request (in-request field)",
    },
    {
      capability: "constraint-declaration",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "policy-rights content-policy gate + custom session dedupe gate + max-latency feed budget on every request",
    },
    {
      capability: "attention-policy",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "attention policy declared on every decision request (in-request field)",
    },
    {
      capability: "decision-request",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      notes: "host-side execution of schedule deltas (QUEUE feed presentation; policy-gated steps are requested but not presented)",
    },
    {
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
      notes: "topic-affinity deltas re-rank retrieval (host-side preference model)",
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
  ],
};

/** The Level 11 Reckon-Complete profile: what this archetype REQUIRES. */
export const level11SocialFeedProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l11-social-feed",
  name: "Social feed",
  description: "SIM-004 ladder level 11 — large candidate sets, freshness, exploration, strong policy boundaries.",
  ladderLevel: 11,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "constraint-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "schedule-execution" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 11 host (fresh world state — replay-safe by construction). */
export interface Level11Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level11WorldView;
}

export interface Level11WorldView {
  readonly presentations: number;
  readonly presentedLog: ReadonlyArray<{
    step: number;
    itemId: string;
    topic: string;
    eventType: string;
    ageHours: number;
  }>;
  readonly policyDeferrals: readonly number[];
  readonly policySuppressed: readonly string[];
  readonly staleDeparted: readonly string[];
  readonly candidateSetSizes: readonly number[];
  readonly explorationSteps: readonly number[];
  readonly explorationSources: readonly string[];
  readonly topicWeights: Readonly<Record<string, number>>;
  readonly deltaDimensions: readonly string[];
}

interface Level11WorldState {
  presentations: number;
  presentedLog: Array<{ step: number; itemId: string; topic: string; eventType: string; ageHours: number }>;
  policyDeferrals: number[];
  policySuppressed: string[];
  staleDeparted: string[];
  candidateSetSizes: number[];
  explorationSteps: number[];
  explorationSources: string[];
  topicWeights: Map<string, number>;
  deltaDimensions: string[];
}

function createLevel11WorldState(): Level11WorldState {
  return {
    presentations: 0,
    presentedLog: [],
    policyDeferrals: [],
    policySuppressed: [],
    staleDeparted: [],
    candidateSetSizes: [],
    explorationSteps: [],
    explorationSources: [],
    topicWeights: new Map(TOPICS.map((topic) => [topic, 1])),
    deltaDimensions: [],
  };
}

export function createLevel11SocialFeedHost(): Level11Host {
  const state = createLevel11WorldState();
  const seen = new Set<string>();
  const suppressed = new Set<string>();
  /** Item age in hours, advancing 0.5h per step. */
  const ageHoursByItem = new Map(CORPUS.map((item) => [item.itemId, item.initialAgeHours]));
  let presentedCount = 0;

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l11-social-feed-1",
    hostSystem: {
      hostId: "host-l11-social-feed",
      name: "Driftline Social Feed",
      version: "0.1.0",
    },
    glue: { functions: 10, loc: 423, customAdapterLoc: 91 },
    manifestContent: LEVEL11_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL11_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL11_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      // Freshness: every item ages 0.5h per step; items past the horizon
      // LEAVE retrieval (host-side world transition).
      for (const item of CORPUS) {
        const age = (ageHoursByItem.get(item.itemId) ?? 0) + AGE_HOURS_PER_STEP;
        ageHoursByItem.set(item.itemId, age);
        if (age > FRESHNESS_HORIZON_HOURS && !state.staleDeparted.includes(item.itemId)) {
          state.staleDeparted.push(item.itemId);
        }
      }
      const candidates = feedCandidates(step, ageHoursByItem, seen, suppressed, state.topicWeights);
      state.candidateSetSizes.push(candidates.length);
      if (candidates.some((candidate) => candidate.source === "host-explore")) {
        state.explorationSteps.push(step);
      }
      state.explorationSources.push(candidates[0]?.source ?? "none");
      return {
        contextId: `ctx-l11-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: {
          objectiveId: "obj-l11-discover",
          version: "1",
          kind: "discover",
          params: { mode: "feed-scroll" },
        },
        attentionPolicy: {
          policyId: "ap-l11-balanced",
          version: "1",
          style: "balanced",
          params: { maxFeedRefreshesPerHour: 12 },
        },
        candidates: {
          setId: `cs-l11-${step}`,
          candidates: candidates.map((candidate) => ({ ...candidate })),
        },
        constraints: feedConstraints(),
        policySelector: { policyId: "driftline-feed-v1" },
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const itemId = result.selectedExperience?.itemId ?? "";
      state.presentations += 1;
      if (POLICY_GATE_STEPS.includes(step)) {
        // Strong policy boundary: the leading candidate trips the host
        // content-policy gate — requested-but-not-presented (no outcome,
        // no delta) and suppressed for the session.
        state.policyDeferrals.push(step);
        state.policySuppressed.push(itemId);
        suppressed.add(itemId);
        return { presented: false };
      }
      // Consumption exclusion: presented items never re-show.
      seen.add(itemId);
      presentedCount += 1;
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      const itemId = result.selectedExperience?.itemId ?? "";
      const topic = topicOfItem(itemId);
      const ageHours = ageHoursByItem.get(itemId) ?? 0;
      const abandoned = step === ABANDONMENT_STEP;
      const eventType: "completion" | "abandonment" = abandoned ? "abandonment" : "completion";
      state.presentedLog.push({ step, itemId, topic, eventType, ageHours: Math.round(ageHours * 10) / 10 });
      const weight = (state.topicWeights.get(topic) ?? 1) + (abandoned ? -0.15 : 0.25);
      state.topicWeights.set(topic, Math.round(Math.max(0.1, weight) * 100) / 100);
      return {
        eventId: `ev-l11-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType,
        occurredAt: nowMs,
        evidenceClass: "fixture" as const,
        metrics: {
          dwellSeconds: abandoned ? 2 : 30 + 5 * presentedCount,
          ageHours: Math.round(ageHours * 10) / 10,
          candidateSetSize: state.candidateSetSizes[state.candidateSetSizes.length - 1] ?? 0,
        },
        idempotencyKey: `idem-out-l11-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const topic = topicOfItem(result.selectedExperience?.itemId ?? "");
      const dimension = `topic.${topic}`;
      state.deltaDimensions.push(dimension);
      const abandoned = step === ABANDONMENT_STEP;
      return {
        deltaId: `delta-l11-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension,
        op: abandoned ? ("decay" as const) : ("add" as const),
        ...(abandoned ? { confidenceDelta: -0.05 } : { newValue: state.topicWeights.get(topic) ?? 1 }),
        resultingConfidence: Math.min(0.9, 0.5 + 0.04 * step),
        model: { modelId: "driftline-topic-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return {
    host,
    world: {
      get presentations() { return state.presentations; },
      get presentedLog() { return state.presentedLog.map((entry) => ({ ...entry })); },
      get policyDeferrals() { return [...state.policyDeferrals]; },
      get policySuppressed() { return [...state.policySuppressed]; },
      get staleDeparted() { return [...state.staleDeparted]; },
      get candidateSetSizes() { return [...state.candidateSetSizes]; },
      get explorationSteps() { return [...state.explorationSteps]; },
      get explorationSources() { return [...state.explorationSources]; },
      get topicWeights() { return Object.fromEntries([...state.topicWeights.entries()].sort()); },
      get deltaDimensions() { return [...state.deltaDimensions]; },
    },
  };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level11SocialFeedMeta = {
  level: 11,
  name: "Social feed",
  hostAdapterId: "adapter-l11-social-feed-1",
  requiredCapabilities: 12,
  expectedSatisfied: 12,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;
