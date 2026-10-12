/**
 * SIM-002 — Ladder Level 1: the STATIC CATALOG PICKER synthetic host.
 *
 * Ladder definition (docs/simulations/reckon-complete-ladder.md):
 *   "Static catalog picker — query a small catalog and return the best item."
 *
 * The host owns a small, static catalog of articles (host-owned catalog
 * authority — architecture law), ranks it with a fixed editorial order,
 * and asks Reckon for the best item once per step through the PUBLIC
 * surface only (manifest → connect sources → candidates → decision →
 * outcome → preference delta).
 *
 * World state: STATIC — nothing transitions between steps except the
 * host's own presentation ledger (what it showed, what came back). That
 * is the point of Level 1: it is the baseline integration archetype; all
 * ladder complexity above it comes from world-state transitions the
 * LATER levels add host-side, never Reckon-side.
 *
 * LAWS obeyed (SIM-002 work order):
 * - zero internal Reckon imports — only @reckon/contracts types + the
 *   harness host-adapter seam (enforced by the conformance scanner);
 * - no Math.random, no Date.now / wall-clock reads, no LLM/network;
 * - every synthetic outcome carries evidenceClass "fixture" — synthetic
 *   host output NEVER becomes observed evidence;
 * - deterministic: a fresh host from this factory + the same run seed
 *   yields byte-identical records (replay gate).
 *
 * Glue declaration (honest, host-declared; mechanically re-verified by
 * packages/simulation/test/levels.test.ts):
 * - `loc` — comment-stripped non-blank lines of THIS module;
 * - `customAdapterLoc` — lines between the `glue:adapter` markers below
 *   (the world-state/presentation-ledger code specific to this host);
 * - `functions` — the named host functions: createLevel1WorldState,
 *   staticCandidates, topicOfItem, provideDecisionInputs,
 *   consumeDecision, provideOutcome, providePreferenceDelta,
 *   createLevel1StaticCatalogHost, plus the module-level catalog
 *   builder (9 total).
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

/** Host-owned identity (host is the identity authority — never Reckon). */
const TENANT: TenantScope = { tenantId: "tenant-l1-static-catalog" };
const SUBJECT: SubjectReference = { kind: "user", ref: "user-l1-picker-1" };

// --- glue:adapter:begin ----------------------------------------------------
// The static world: 6 articles, one web realization each. The picker's
// editorial ranking is FIXED (index order) — "static catalog" verbatim.

interface StaticArticle {
  readonly itemId: string;
  readonly title: string;
  readonly topic: string;
  readonly realizationId: string;
}

const STATIC_ARTICLES: readonly StaticArticle[] = [
  { itemId: "l1-brief-01", title: "Morning brief", topic: "news", realizationId: "l1-real-brief-01" },
  { itemId: "l1-brief-02", title: "Markets in five lines", topic: "business", realizationId: "l1-real-brief-02" },
  { itemId: "l1-brief-03", title: "Chip supply notes", topic: "technology", realizationId: "l1-real-brief-03" },
  { itemId: "l1-brief-04", title: "City hall roundup", topic: "local", realizationId: "l1-real-brief-04" },
  { itemId: "l1-brief-05", title: "Weekend science read", topic: "science", realizationId: "l1-real-brief-05" },
  { itemId: "l1-brief-06", title: "Sports final scores", topic: "sports", realizationId: "l1-real-brief-06" },
];

/** Presentation ledger — the only mutable host state at this level. */
interface Level1WorldState {
  presentations: number;
  presentedTitles: string[];
  presentedTopics: string[];
  outcomeSteps: number[];
  deltaDimensions: string[];
}

/** Read-only view over the final world state (for deterministic assertions). */
export interface Level1WorldView {
  readonly presentations: number;
  readonly presentedTitles: readonly string[];
  readonly presentedTopics: readonly string[];
  readonly outcomeSteps: readonly number[];
  readonly deltaDimensions: readonly string[];
}

function createLevel1WorldState(): Level1WorldState {
  return { presentations: 0, presentedTitles: [], presentedTopics: [], outcomeSteps: [], deltaDimensions: [] };
}

/** Fixed editorial ranking: index order, rank hint = position + 1. */
function staticCandidates() {
  return STATIC_ARTICLES.map((article, index) => ({
    itemId: article.itemId,
    realizationIds: [article.realizationId],
    source: "host-static-catalog",
    rankHint: index + 1,
  }));
}

/** The topic of a selected item (host's own catalog knowledge). */
function topicOfItem(itemId: string): string {
  return STATIC_ARTICLES.find((article) => article.itemId === itemId)?.topic ?? "news";
}
// --- glue:adapter:end ------------------------------------------------------

/** Host catalog source — connected once, before the loop (public API). */
const LEVEL1_CATALOG: { items: readonly CatalogItemInput[]; realizations: readonly RealizationInput[] } = {
  items: STATIC_ARTICLES.map((article) => ({
    itemId: article.itemId,
    kind: "article" as const,
    labels: ["brief", article.topic],
    attributes: { title: article.title, topic: article.topic },
  })),
  realizations: STATIC_ARTICLES.map((article) => ({
    realizationId: article.realizationId,
    itemId: article.itemId,
    kind: "web",
  })),
};

/** The host's honest capability manifest (statuses, evidence, ops, methods). */
const LEVEL1_MANIFEST_CONTENT: SimulationManifestContentInput = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-l1-static-catalog",
    name: "Static Catalog Picker",
    hostAdapterId: "adapter-l1-static-catalog-1",
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
    },
    {
      capability: "preference-feedback",
      status: "supported",
      evidenceClass: "fixture",
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    {
      capability: "conformance-verification",
      status: "supported",
      evidenceClass: "fixture",
      notes: "harness conformance verdict; no API route — machine-checked offline",
    },
  ],
};

/** The Level 1 Reckon-Complete profile: what this archetype REQUIRES. */
export const level1StaticCatalogProfile: ReckonCompleteProfileDeclarationInput = {
  profileId: "profile-l1-static-catalog",
  name: "Static catalog picker",
  description: "SIM-002 ladder level 1 — query a small catalog and return the best item.",
  ladderLevel: 1,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "realization-declaration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture",
  declaredAt: 1_000,
};

/** A fresh Level 1 host (fresh world state — replay-safe by construction). */
export interface Level1Host {
  readonly host: SimulationHostAdapter;
  readonly world: Level1WorldView;
}

export function createLevel1StaticCatalogHost(): Level1Host {
  const state = createLevel1WorldState();

  const host: SimulationHostAdapter = {
    hostAdapterId: "adapter-l1-static-catalog-1",
    hostSystem: {
      hostId: "host-l1-static-catalog",
      name: "Static Catalog Picker",
      version: "0.1.0",
    },
    glue: { functions: 9, loc: 248, customAdapterLoc: 42 },
    manifestContent: LEVEL1_MANIFEST_CONTENT,
    catalog: {
      items: LEVEL1_CATALOG.items.map((item) => ({ ...item })),
      realizations: LEVEL1_CATALOG.realizations.map((realization) => ({ ...realization })),
    },

    provideDecisionInputs(step: number): HostDecisionInputs {
      return {
        contextId: `ctx-l1-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        objective: { objectiveId: "obj-l1-stay-informed", version: "1", kind: "stay-informed", params: {} },
        attentionPolicy: { policyId: "ap-l1-balanced", version: "1", style: "balanced", params: {} },
        candidates: { setId: `cs-l1-${step}`, candidates: staticCandidates() },
        policySelector: { policyId: "greedy-v1" },
      };
    },

    consumeDecision(_step: number, result: DecisionResult): HostDecisionReaction {
      const itemId = result.selectedExperience?.itemId;
      state.presentations += 1;
      state.presentedTopics.push(topicOfItem(itemId ?? ""));
      state.presentedTitles.push(
        STATIC_ARTICLES.find((article) => article.itemId === itemId)?.title ?? "unknown",
      );
      return { presented: true };
    },

    provideOutcome(step: number, result: DecisionResult, _reaction: HostDecisionReaction, nowMs: number) {
      state.outcomeSteps.push(step);
      return {
        eventId: `ev-l1-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        decisionId: result.decisionId,
        experienceId: result.selectedExperience?.experienceId,
        eventType: "completion",
        occurredAt: nowMs,
        evidenceClass: "fixture",
        metrics: { dwellSeconds: 20 + 5 * step },
        idempotencyKey: `idem-out-l1-${step}`,
      };
    },

    providePreferenceDelta(step: number, result: DecisionResult, nowMs: number) {
      const topic = topicOfItem(result.selectedExperience?.itemId ?? "");
      state.deltaDimensions.push(`topic.${topic}`);
      return {
        deltaId: `delta-l1-${step}`,
        tenant: TENANT,
        subject: SUBJECT,
        dimension: `topic.${topic}`,
        op: "add",
        newValue: step,
        resultingConfidence: Math.min(0.9, 0.5 + 0.05 * step),
        model: { modelId: "host-l1-static-picker", version: "1" },
        timestamp: nowMs,
      };
    },
  };

  return { host, world: state };
}

/** Level metadata for wave reporting (mirrors the module's declarations). */
export const level1StaticCatalogMeta = {
  level: 1,
  name: "Static catalog picker",
  hostAdapterId: "adapter-l1-static-catalog-1",
  requiredCapabilities: 10,
  expectedSatisfied: 10,
  expectedPartial: 0,
  expectedMissing: 0,
  expectedGaps: [] as readonly string[],
} as const;
