/**
 * SIM-002 — Ladder Level 2: the SIMPLE CONTENT FEED synthetic host.
 *
 * Ladder definition:
 *   "Simple content feed — preferences, context, outcomes and queue/replace."
 *
 * World-state transitions this host owns (all host-side, all deterministic):
 * - PREFERENCES: per-topic weights start at 1.0 and move with every
 *   outcome (completion +0.3 / abandonment −0.2, floored at 0.1). The
 *   weights feed BACK into retrieval: each step's candidate set is
 *   ranked topic-first by current weight, and already-consumed articles
 *   leave the feed — the measurable preference → retrieval → decision
 *   loop through the public surface.
 * - CONTEXT: the session's day-part rotates morning → afternoon →
 *   evening by step; each decision references a per-step context id
 *   composed from it. The host can only pass an OPAQUE contextId —
 *   the frozen ContextSnapshot payload (day-part, device, attention)
 *   has NO public ingestion route — honestly declared as a partial
 *   capability with friction API_GAP in the manifest below.
 * - OUTCOMES: the synthetic user completes items and abandons every
 *   4th one (fixed scripted pattern — fixture-class synthetic
 *   behavior, never observed evidence).
 * - QUEUE/REPLACE: the feed keeps a prefetch queue of depth 2; every
 *   queued decision pushes the newly selected experience and REPLACES
 *   the overflow (oldest dropped). On abandonment steps the whole
 *   queue is discarded (stale content after a negative signal).
 *
 * LAWS: zero internal imports; no Math.random / Date.now / wall clock /
 * LLM / network; synthetic outcomes are evidenceClass "fixture";
 * deterministic given (seed, fresh host factory) — replay gate applies.
 *
 * Glue (honest; re-verified mechanically by levels.test.ts): `loc` =
 * comment-stripped non-blank lines of this module; `customAdapterLoc`
 * = lines inside the glue:adapter markers (world + transitions);
 * `functions` = createLevel2WorldState, dayPartForStep, rankArticles,
 * weightOf, isAbandonmentStep, applyPreferenceUpdate, pushIntoQueue,
 * provideDecisionInputs, consumeDecision, provideOutcome,
 * providePreferenceDelta, createLevel2ContentFeedHost (12).
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
import type { ReckonCompleteProfileDeclarationInput } from "@reckon/contracts";

const TENANT: TenantScope = { tenantId: "tenant-l2-content-feed" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l2-reader-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The feed world: 10 articles across 5 topics; per-topic preference
// weights; a depth-2 prefetch queue with a replace policy; a day-part
// rotation; and a scripted synthetic-user behavior pattern.

interface FeedArticle {
  readonly itemId: string;
  readonly title: string;
  readonly topic: string;
  readonly realizationId: string;
}

const FEED_ARTICLES: readonly FeedArticle[] = [
  { itemId: "l2-feed-01", title: "Small models, big racks", topic: "technology", realizationId: "l2-real-feed-01" },
  { itemId: "l2-feed-02", title: "The battery crunch", topic: "technology", realizationId: "l2-real-feed-02" },
  { itemId: "l2-feed-03", title: "Rates and you", topic: "business", realizationId: "l2-real-feed-03" },
  { itemId: "l2-feed-04", title: "Supply chains rerouted", topic: "business", realizationId: "l2-real-feed-04" },
  { itemId: "l2-feed-05", title: "A whale census", topic: "science", realizationId: "l2-real-feed-05" },
  { itemId: "l2-feed-06", title: "Fusion milestones", topic: "science", realizationId: "l2-real-feed-06" },
  { itemId: "l2-feed-07", title: "Museum nights", topic: "culture", realizationId: "l2-real-feed-07" },
  { itemId: "l2-feed-08", title: "Essays on attention", topic: "culture", realizationId: "l2-real-feed-08" },
  { itemId: "l2-feed-09", title: "City marathon recap", topic: "sports", realizationId: "l2-real-feed-09" },
  { itemId: "l2-feed-10", title: "Transfer window math", topic: "sports", realizationId: "l2-real-feed-10" },
];

const FEED_TOPICS: readonly string[] = ["technology", "business", "science", "culture", "sports"];

const QUEUE_DEPTH = 2;

interface FeedQueueEntry {
  readonly experienceId: string;
  readonly itemId: string;
  readonly topic: string;
  readonly enqueuedAtStep: number;
}

interface Level2WorldState {
  preferenceWeights: Map<string, number>;
  queue: FeedQueueEntry[];
  replacedCount: number;
  completions: number;
  abandonments: number;
  consumedItems: Set<string>;
  contextLog: { step: number; contextId: string; dayPart: string }[];
  presentedLog: { step: number; itemId: string; topic: string; outcomeType: string }[];
}

export interface Level2WorldView {
  readonly preferenceWeights: ReadonlyMap<string, number>;
  readonly queue: readonly FeedQueueEntry[];
  readonly replacedCount: number;
  readonly completions: number;
  readonly abandonments: number;
  readonly contextLog: readonly { step: number; contextId: string; dayPart: string }[];
  readonly presentedLog: readonly { step: number; itemId: string; topic: string; outcomeType: string }[];
}

function createLevel2WorldState(): Level2WorldState {
  const preferenceWeights = new Map<string, number>();
  for (const topic of FEED_TOPICS) preferenceWeights.set(topic, 1.0);
  return {
    preferenceWeights,
    queue: [],
    replacedCount: 0,
    completions: 0,
    abandonments: 0,
    consumedItems: new Set(),
    contextLog: [],
    presentedLog: [],
  };
}

/** Day-part rotation: morning → afternoon → evening by step. */
function dayPartForStep(step: number): "morning" | "afternoon" | "evening" {
  return (["morning", "afternoon", "evening"] as const)[(step - 1) % 3]!;
}

function weightOf(weights: ReadonlyMap<string, number>, topic: string): number {
  return weights.get(topic) ?? 1.0;
}

/** Preference-driven retrieval: topic weight DESC, then article index;
 *  already-presented articles are consumed (a feed never re-shows). */
function rankArticles(weights: ReadonlyMap<string, number>, consumed: ReadonlySet<string>) {
  const unconsumed = FEED_ARTICLES.filter((article) => !consumed.has(article.itemId));
  const pool = unconsumed.length > 0 ? unconsumed : FEED_ARTICLES;
  const ordered = [...pool].sort((a, b) => {
    const byWeight = weightOf(weights, b.topic) - weightOf(weights, a.topic);
    if (byWeight !== 0) return byWeight;
    if (a.topic !== b.topic) return a.topic < b.topic ? -1 : 1;
    return a.itemId < b.itemId ? -1 : 1;
  });
  return ordered.map((article, index) => ({
    itemId: article.itemId,
    realizationIds: [article.realizationId],
    source: "host-feed-retrieval",
    rankHint: index + 1,
  }));
}

/** The synthetic user abandons every 4th feed item (scripted pattern). */
function isAbandonmentStep(step: number): boolean {
  return step % 4 === 0;
}

/** Weight transition: completion +0.3 / abandonment −0.2 (floor 0.1). */
function applyPreferenceUpdate(weights: Map<string, number>, topic: string, outcomeType: string): number {
  const current = weightOf(weights, topic);
  const next =
    outcomeType === "abandonment" ? Math.max(0.1, current - 0.2) : Math.min(3.0, current + 0.3);
  weights.set(topic, next);
  return next;
}

/** Queue/replace: enqueue the selected experience at depth 2 (FIFO out). */
function pushIntoQueue(state: Level2WorldState, entry: FeedQueueEntry, replaceAll: boolean): void {
  if (replaceAll) {
    state.replacedCount += state.queue.length;
    state.queue = [];
  }
  state.queue.push(entry);
  while (state.queue.length > QUEUE_DEPTH) {
    state.queue.shift();
    state.replacedCount += 1;
  }
}
// --- glue:adapter:end ------------------------------------------------------

const LEVEL2_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: FEED_ARTICLES.map((article) => ({
    itemId: article.itemId,
    kind: "article" as const,
    labels: ["feed", article.topic],
    attributes: { title: article.title, topic: article.topic },
  })),
  realizations: FEED_ARTICLES.map((article) => ({
    realizationId: article.realizationId,
    itemId: article.itemId,
    kind: "web",
  })),
};

const LEVEL2_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l2-content-feed",
    name: "Simple Content Feed",
    hostAdapterId: "adapter-l2-content-feed-1",
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
      notes: "retrieval re-ranked every step from live topic weights (preference feedback loop)",
    },
    {
      capability: "context-snapshots",
      status: "partial",
      evidenceClass: "fixture",
      friction: "API_GAP",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes:
        "decision requests carry an opaque contextId reference only; the frozen ContextSnapshot payload " +
        "(time.dayPart, device, attention, fatigue) has no public ingestion route — the feed's context " +
        "transitions cannot cross the public surface as data, only as an id",
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
      capability: "outcome-return",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
      notes: "completion and abandonment outcomes returned per item",
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
      notes: "topic deltas with decay, scoped to the decision context",
    },
    {
      capability: "schedule-execution",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
      notes: "host-side execution of the decision scheduleDelta: prefetch queue of depth 2 with replace " +
        "policy (overflow dropped; whole queue replaced after abandonment)",
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
  ],
};

export const level2ContentFeedProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l2-content-feed",
  name: "Simple content feed",
  description: "SIM-002 ladder level 2 — preferences, context, outcomes and queue/replace.",
  ladderLevel: 2,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "context-snapshots" },
    { capability: "objective-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "schedule-execution" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

export interface Level2Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level2WorldView;
}

export function createLevel2ContentFeedHost(): Level2Host {
  const state = createLevel2WorldState();

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l2-content-feed-1",
    hostSystem: {
      hostId: "host-l2-content-feed",
      name: "Simple Content Feed",
      version: "0.1.0",
    },
    glue: { functions: 12, loc: 362, customAdapterLoc: 102 },
    manifestContent: LEVEL2_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL2_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL2_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      const dayPart = dayPartForStep(step);
      const contextId = `ctx-l2-${step}-${dayPart}`;
      state.contextLog.push({ step, contextId, dayPart });
      return {
        contextId,
        tenant: TENANT,
        subject: SUBJECT,
        objective: { objectiveId: "obj-l2-discover", version: "1", kind: "discover", params: {} },
        attentionPolicy: { policyId: "ap-l2-balanced", version: "1", style: "balanced", params: {} },
        candidates: { setId: `cs-l2-${step}`, candidates: rankArticles(state.preferenceWeights, state.consumedItems) },
        policySelector: { policyId: "greedy-v1" },
      };
    },

    consumeDecision(step: number, result: DecisionResult): HostDecisionReaction {
      const itemId = result.selectedExperience?.itemId ?? "";
      const article = FEED_ARTICLES.find((entry) => entry.itemId === itemId);
      const topic = article?.topic ?? "technology";
      state.consumedItems.add(itemId);
      const replaceAll = isAbandonmentStep(step);
      pushIntoQueue(
        state,
        {
          experienceId: result.selectedExperience?.experienceId ?? "",
          itemId,
          topic,
          enqueuedAtStep: step,
        },
        replaceAll,
      );
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      const itemId = result.selectedExperience?.itemId ?? "";
      const topic = FEED_ARTICLES.find((entry) => entry.itemId === itemId)?.topic ?? "technology";
      const outcomeType = isAbandonmentStep(step) ? "abandonment" : "completion";
      if (outcomeType === "completion") state.completions += 1;
      else state.abandonments += 1;
      state.presentedLog.push({ step, itemId, topic, outcomeType });
      const weight = weightOf(state.preferenceWeights, topic);
      return {
        eventId: `ev-l2-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType: outcomeType,
        occurredAt: nowMs,
        context: { contextId: `ctx-l2-${step}-${dayPartForStep(step)}` },
        evidenceClass: "fixture",
        metrics: {
          dwellSeconds: outcomeType === "completion" ? 30 + Math.round(10 * weight) : 8,
          scrollDepth: outcomeType === "completion" ? 0.8 : 0.3,
        },
        idempotencyKey: `idem-out-l2-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const itemId = result.selectedExperience?.itemId ?? "";
      const topic = FEED_ARTICLES.find((entry) => entry.itemId === itemId)?.topic ?? "technology";
      const outcomeType = isAbandonmentStep(step) ? "abandonment" : "completion";
      const oldValue = weightOf(state.preferenceWeights, topic);
      const newValue = applyPreferenceUpdate(state.preferenceWeights, topic, outcomeType);
      return {
        deltaId: `delta-l2-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension: `topic.${topic}`,
        op: "add",
        oldValue,
        newValue,
        scope: { contextId: `ctx-l2-${step}-${dayPartForStep(step)}` },
        resultingConfidence: 0.55,
        decay: { halfLifeSeconds: 3600 },
        model: { modelId: "host-l2-feed-affinity", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return { host, world: state };
}

export const level2ContentFeedMeta = {
  level: 2,
  name: "Simple content feed",
  hostAdapterId: "adapter-l2-content-feed-1",
  requiredCapabilities: 12,
  expectedSatisfied: 11,
  expectedPartial: 1,
  expectedMissing: 0,
  expectedGaps: ["context-snapshots|API_GAP"] as readonly string[],
} as const;
