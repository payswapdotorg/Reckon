/**
 * AD-004 — SELECTION INTEGRATION: ad + organic candidates through the
 * ONE decision kernel pipeline (normalize → expand → policy → decide).
 *
 * Evidence class: controlled-local (kernel-level, in-process; the
 * route-level and PG-backed proofs live in ad-decisions.test.ts /
 * ad-selection-composition.test.ts).
 *
 * Proves:
 * - The SDK's `selectAdCandidacy`/`buildAdBearingCandidates` gate ad
 *   lanes at the caller clock (law 3) with honest notes, preserve lane
 *   provenance (law 9), and produce candidate mappings with the SAME
 *   semantics as the frozen `adCandidatesToCandidateSet`.
 * - Declared ad eligibility projects onto the per-item constraint
 *   surface (flight window → time-window, gates → policy-rights).
 * - POLICY PARITY: an ad experience and an organic experience carrying
 *   IDENTICAL declared evidence score IDENTICALLY in the policy engine
 *   (ads are ordinary candidates — no second ranking, no ad bonus or
 *   penalty anywhere).
 * - DETERMINISM: identical inputs → byte-identical pipeline outputs.
 * - The userValue → reward-term bridge: declared ad USER value flows
 *   through the policy engine's existing per-experience declared-value
 *   channel; absent evidence stays absent (uncertainty-disclosed).
 */
import { describe, expect, it } from "vitest";
import {
  adCandidatesToCandidateSet,
  finalizeAdMemoryRecord,
  AdQueryResultSchema,
  type AdCatalogItem,
  type AdMemoryRecord,
  type AdQueryResult,
  type CandidateSet,
  type CatalogItem,
  type Realization,
  type RewardSpec,
} from "@reckon/contracts";
import { normalizeCandidates, evaluatePolicy } from "@reckon/decision";
import { expandExperiences, experienceIdFor } from "@reckon/experience";
import { decide, type PlanState } from "@reckon/scheduler";
import {
  adUserValueRewardTerm,
  buildAdBearingCandidates,
  selectAdCandidacy,
} from "@reckon/sdk";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const AT = 10_000;

const adItem: AdCatalogItem = {
  schema: "reckon.catalog-item",
  schemaVersion: "0.1.0",
  itemId: "ad-hotel-accra",
  kind: "advertising",
  labels: ["travel", "hotel"],
  attributes: { headline: "Stay in Accra" },
};

const adRealization: Realization = {
  schema: "reckon.realization",
  schemaVersion: "0.1.0",
  realizationId: "real-ad-hotel",
  itemId: "ad-hotel-accra",
  kind: "display",
  constraints: { formats: ["banner", "in-feed"], durationSeconds: 5 },
};

const organicItem: CatalogItem = {
  schema: "reckon.catalog-item",
  schemaVersion: "0.1.0",
  itemId: "vid-guide",
  kind: "media",
  labels: ["travel"],
  attributes: { title: "Accra city guide" },
};

const organicRealization: Realization = {
  schema: "reckon.realization",
  schemaVersion: "0.1.0",
  realizationId: "real-vid-guide",
  itemId: "vid-guide",
  kind: "stream",
  constraints: { formats: ["full"], durationSeconds: 600 },
};

function makeRememberedRecord(options: { itemId?: string; availableFrom?: number; availableUntil?: number } = {}): AdMemoryRecord {
  return finalizeAdMemoryRecord({
    tenant: { tenantId: "tenant-a" },
    subject: { kind: "user", ref: "user-9" },
    ad: {
      itemId: options.itemId ?? "ad-hotel-accra",
      kind: "advertising",
      labels: ["travel"],
      attributes: { headline: "Stay in Accra" },
      ...(options.availableFrom !== undefined ? { availableFrom: options.availableFrom } : {}),
      ...(options.availableUntil !== undefined ? { availableUntil: options.availableUntil } : {}),
    },
    realizations: options.itemId !== undefined && options.itemId !== "ad-hotel-accra" ? [] : [adRealization],
    lineage: { source: "host-ad-server", advertiserRef: "adv-1", campaignRef: "camp-1", creativeRefs: ["cr-1"] },
    retention: {
      state: "active",
      basis: { kind: "explicit-user-consent", establishedAt: 1_000 },
    },
    permissions: { retain: "granted", present: "granted", history: [] },
    provenance: {
      kind: "observed-encounter",
      evidence: {
        outcomeEventId: "ev-seed-1",
        evidenceClass: "production-observed",
        encounteredAt: 1_500,
        context: { contextId: "ctx-1" },
        surface: "in-stream",
      },
    },
    rights: { redistributionPermitted: false, gates: ["host-rights-gate"], usageRestrictions: [] },
    recordedAt: 2_000,
  });
}

function makeQueryResult(options: {
  rememberedRecords?: AdMemoryRecord[];
  available?: AdQueryResult["available"];
} = {}): Pick<AdQueryResult, "remembered" | "available"> {
  // Parse through the FROZEN result schema: mode-consistent lanes,
  // structurally-active embedded records (laws 2/3/8/9 re-asserted on
  // construction — the same boundary discipline as the AD-003 route).
  const parsed = AdQueryResultSchema.parse({
    schema: "reckon.ad-query-result",
    schemaVersion: "0.1.0",
    queryId: "q-selection-test",
    tenant: { tenantId: "tenant-a" },
    mode: "both",
    at: AT,
    remembered: (options.rememberedRecords ?? [makeRememberedRecord()]).map((record) => ({
      candidateKind: "remembered" as const,
      advertising: true as const,
      record,
      whyRetrieved: [{ kind: "query-match" as const, detail: "matched terms: hotel", score: 0.5 }],
    })),
    available: options.available ?? [],
    queryUnderstanding: { terms: [] },
    notes: [],
  });
  return { remembered: parsed.remembered, available: parsed.available };
}

/* ------------------------------------------------------------------ *
 * Selection gating + mapping (the SDK composition helpers)
 * ------------------------------------------------------------------ */

describe("AD-004 selectAdCandidacy (gate at the caller clock — law 3)", () => {
  it("keeps a currently-available remembered ad and excludes one past its catalog window, with an honest note", () => {
    const open = makeRememberedRecord();
    const closed = makeRememberedRecord({ itemId: "ad-closed", availableUntil: 9_000 });
    const selection = selectAdCandidacy(makeQueryResult({ rememberedRecords: [open, closed] }), AT);
    expect(selection.candidates.map((c) => c.itemId)).toEqual(["ad-hotel-accra"]);
    expect(selection.notes.join(" ")).toContain("ad-closed");
    expect(selection.notes.join(" ")).toContain("closed at the selection clock");
  });

  it("excludes provider-supplied ads whose availability window is closed at the clock (both windows evaluated)", () => {
    const result = makeQueryResult({
      rememberedRecords: [],
      available: [
        {
          candidateKind: "available",
          advertising: true,
          ad: { ...adItem, itemId: "ad-supply-open" },
          realizations: [],
          availability: { suppliedBy: "exchange", availableFrom: 0, availableUntil: 20_000 },
          rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
          whyRetrieved: [{ kind: "provider-supplied", detail: "supplied by exchange" }],
        },
        {
          candidateKind: "available",
          advertising: true,
          ad: { ...adItem, itemId: "ad-supply-closed" },
          realizations: [],
          availability: { suppliedBy: "exchange", availableFrom: 20_000 },
          rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
          whyRetrieved: [{ kind: "provider-supplied", detail: "supplied by exchange" }],
        },
        {
          candidateKind: "available",
          advertising: true,
          // Channel window open but the AD's own catalog window closed.
          ad: { ...adItem, itemId: "ad-supply-ad-closed", availableUntil: 1_000 },
          realizations: [],
          availability: { suppliedBy: "exchange", availableFrom: 0, availableUntil: 20_000 },
          rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
          whyRetrieved: [{ kind: "provider-supplied", detail: "supplied by exchange" }],
        },
      ],
    });
    const selection = selectAdCandidacy(result, AT);
    expect(selection.candidates.map((c) => c.itemId)).toEqual(["ad-supply-open"]);
    expect(selection.notes).toHaveLength(2);
  });

  it("maps gated-in ads with the SAME semantics as the frozen adCandidatesToCandidateSet (parity)", () => {
    const result = makeQueryResult();
    // The frozen mapping over the un-gated result (all lanes here are open).
    const frozenSet = adCandidatesToCandidateSet("cs-parity", result);
    const selection = selectAdCandidacy(result, AT);
    expect(selection.candidates).toEqual(frozenSet.candidates);
  });

  it("projects declared availability-lane eligibility onto per-item hard constraints (flight + gates)", () => {
    const result = makeQueryResult({
      rememberedRecords: [],
      available: [
        {
          candidateKind: "available",
          advertising: true,
          ad: adItem,
          realizations: [adRealization],
          availability: { suppliedBy: "exchange" },
          rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
          eligibility: {
            flight: { fromMs: 1_000, untilMs: 20_000 },
            surfaces: ["home-feed"],
            gates: ["brand-safety-gate"],
            hostFrequencyPolicy: { cap: 3 },
          },
          whyRetrieved: [],
        },
      ],
    });
    const selection = selectAdCandidacy(result, AT);
    expect(selection.itemConstraints["ad-hotel-accra"]).toEqual([
      { kind: "time-window", fromMs: 1_000, untilMs: 20_000 },
      { kind: "policy-rights", gateId: "brand-safety-gate" },
    ]);
  });

  it("is deterministic: identical inputs yield deep-equal selections", () => {
    const result = makeQueryResult();
    expect(selectAdCandidacy(result, AT)).toEqual(selectAdCandidacy(result, AT));
  });
});

describe("AD-004 buildAdBearingCandidates (one merged candidate universe)", () => {
  it("merges organic + ad candidates into ONE frozen-schema-valid set (ads keep lane provenance)", () => {
    const built = buildAdBearingCandidates({
      setId: "cs-merged-1",
      organic: {
        setId: "cs-organic",
        candidates: [{ itemId: "vid-guide", realizationIds: ["real-vid-guide"], source: "host-retrieval", rankHint: 1 }],
      },
      adQueryResult: makeQueryResult(),
      at: AT,
    });
    expect(built.candidateSet.setId).toBe("cs-merged-1");
    expect(built.candidateSet.candidates.map((c) => [c.itemId, c.source])).toEqual([
      ["vid-guide", "host-retrieval"],
      ["ad-hotel-accra", "reckon.ad-memory.remembered"],
    ]);
    expect(built.items.map((i) => i.itemId)).toEqual(["ad-hotel-accra"]);
    expect(built.realizations.map((r) => r.realizationId)).toEqual(["real-ad-hotel"]);
  });

  it("throws a typed error when the merged set would be empty (frozen CandidateSet min(1))", () => {
    const closedOnly = makeQueryResult({ rememberedRecords: [makeRememberedRecord({ itemId: "ad-closed", availableUntil: 1 })] });
    expect(() =>
      buildAdBearingCandidates({ setId: "cs-empty", adQueryResult: closedOnly, at: AT }),
    ).toThrow(/at least one candidate/);
  });
});

/* ------------------------------------------------------------------ *
 * THE ONE PIPELINE: ad + organic through normalize → expand → policy → decide
 * ------------------------------------------------------------------ */

const OBJECTIVE = { objectiveId: "obj-relax", version: "1", kind: "relax" as const, params: {} };

function runPipeline(input: {
  candidateSet: CandidateSet;
  items: CatalogItem[];
  realizations: Realization[];
  itemConstraints?: Record<string, readonly unknown[]>;
  reward?: RewardSpec;
  attentionStyle?: "mindful" | "balanced";
  at?: number;
}) {
  const normalized = normalizeCandidates({
    candidates: input.candidateSet,
    items: input.items,
    realizations: input.realizations,
    tenant: { tenantId: "tenant-a" },
  });
  if (!normalized.ok) throw new Error(normalized.error.message);
  const expansion = expandExperiences({
    candidates: normalized.value,
    items: input.items,
    realizations: input.realizations,
    formatPolicy: { allowedFormats: ["full", "clip", "banner", "in-feed", "interstitial", "card"] },
    objective: OBJECTIVE,
    constraints: [],
    ...(input.itemConstraints !== undefined ? { itemConstraints: input.itemConstraints as never } : {}),
  });
  if (!expansion.ok) throw new Error(expansion.error.message);
  const policy = evaluatePolicy({
    experiences: expansion.value.experiences.map((e) => e.experience),
    objective: OBJECTIVE,
    constraints: [],
    ...(input.reward !== undefined ? { reward: input.reward } : {}),
    policyId: "greedy-v1",
    policyVersion: "1",
  });
  if (!policy.ok) throw new Error(policy.error.message);
  const scheduler = decide({
    currentState: { status: "idle", queue: [], resumeCheckpoints: [] } satisfies PlanState,
    request: {
      schema: "reckon.decision-request",
      schemaVersion: "0.1.0",
      requestId: "req-pipeline",
      tenant: { tenantId: "tenant-a" },
      subject: { kind: "user", ref: "user-9" },
      objective: OBJECTIVE,
      attentionPolicy: { policyId: "ap-1", version: "1", style: input.attentionStyle ?? "balanced", params: {} },
      context: { contextId: "ctx-1" },
      candidates: input.candidateSet,
      constraints: [],
      policySelector: { policyId: "greedy-v1", version: "1" },
      at: input.at ?? AT,
      idempotencyKey: "idem-pipeline",
    },
    scored: policy.value.scored,
  });
  if (!scheduler.ok) throw new Error(scheduler.error.message);
  return { expansion, policy, scheduler };
}

describe("AD-004 ad + organic candidates through the ONE kernel pipeline", () => {
  const built = buildAdBearingCandidates({
    setId: "cs-one-pipeline",
    organic: {
      setId: "cs-organic",
      candidates: [{ itemId: "vid-guide", realizationIds: ["real-vid-guide"], source: "host-retrieval" }],
    },
    adQueryResult: makeQueryResult(),
    at: AT,
  });
  const items = [organicItem, ...built.items];
  const realizations = [organicRealization, ...built.realizations];

  it("expands the ad into its declared format variants alongside the organic experience (one expansion surface)", () => {
    const { expansion } = runPipeline({ candidateSet: built.candidateSet, items, realizations });
    const formatsByItem = new Map<string, string[]>();
    for (const entry of expansion.value.experiences) {
      const list = formatsByItem.get(entry.experience.itemId) ?? [];
      list.push(entry.experience.format.kind);
      formatsByItem.set(entry.experience.itemId, list);
    }
    expect(formatsByItem.get("ad-hotel-accra")?.sort()).toEqual(["banner", "in-feed"]);
    expect(formatsByItem.get("vid-guide")).toEqual(["full"]);
    // Provenance: the ad experience's proposing sources are the ad lane.
    const adEntry = expansion.value.experiences.find((e) => e.experience.itemId === "ad-hotel-accra");
    expect(adEntry?.sources).toEqual(["reckon.ad-memory.remembered"]);
  });

  it("POLICY PARITY: an ad experience and an organic experience with IDENTICAL declared evidence score identically", () => {
    // Same declared per-experience reward value for the ad and the organic
    // experience (the policy engine's documented params.values channel).
    const adBannerId = experienceIdFor("real-ad-hotel", { kind: "banner", params: {} });
    const organicFullId = experienceIdFor("real-vid-guide", { kind: "full", params: {} });
    const reward: RewardSpec = {
      rewardId: "host-declared-v1",
      version: "1",
      terms: [
        {
          termId: "host-fit",
          version: "1",
          kind: "satisfaction-proxy",
          weight: 1,
          params: { values: { [adBannerId]: 0.8, [organicFullId]: 0.8 } },
        },
      ],
    };
    const { policy } = runPipeline({ candidateSet: built.candidateSet, items, realizations, reward });
    const adScore = policy.value.scored.find((s) => s.experience.experienceId === adBannerId)?.score;
    const organicScore = policy.value.scored.find((s) => s.experience.experienceId === organicFullId)?.score;
    expect(adScore).toBeDefined();
    expect(organicScore).toBeDefined();
    expect(adScore).toBe(organicScore);
    // And with NO declared evidence both are 0 (absence is never fabricated).
    const bare = runPipeline({ candidateSet: built.candidateSet, items, realizations });
    const bareAd = bare.policy.value.scored.find((s) => s.experience.experienceId === adBannerId)?.score;
    const bareOrganic = bare.policy.value.scored.find((s) => s.experience.experienceId === organicFullId)?.score;
    expect(bareAd).toBe(0);
    expect(bareOrganic).toBe(0);
  });

  it("the userValue → reward-term bridge ranks the ad by declared USER value through the policy engine", () => {
    const resolveLike = [
      { experienceId: experienceIdFor("real-ad-hotel", { kind: "banner", params: {} }), itemId: "ad-hotel-accra" },
      { experienceId: experienceIdFor("real-vid-guide", { kind: "full", params: {} }), itemId: "vid-guide" },
    ];
    const term = adUserValueRewardTerm({
      experiences: resolveLike,
      userValueByItemId: { "ad-hotel-accra": { score: 0.9, reasons: ["planning a trip"] } },
    });
    expect(term).not.toBeNull();
    const reward: RewardSpec = { rewardId: "with-ad-user-value", version: "1", terms: [term!] };
    const { policy, scheduler } = runPipeline({ candidateSet: built.candidateSet, items, realizations, reward });
    const adBannerId = experienceIdFor("real-ad-hotel", { kind: "banner", params: {} });
    // The ad outranks the organic experience ONLY through the declared
    // user-value evidence (the organic term value is absent → 0 with
    // uncertainty disclosure, never guessed).
    expect(policy.value.scored[0]?.experience.experienceId).toBe(adBannerId);
    expect(scheduler.value.action).toBe("QUEUE");
    expect(scheduler.value.selectedExperience?.itemId).toBe("ad-hotel-accra");
    expect(scheduler.value.selectedExperience?.format.kind).toBe("banner");
  });

  it("is DETERMINISTIC: identical pipeline inputs yield identical policy order and scheduler decisions", () => {
    const first = runPipeline({ candidateSet: built.candidateSet, items, realizations });
    const second = runPipeline({ candidateSet: built.candidateSet, items, realizations });
    expect(first.policy.value.scored.map((s) => [s.experience.experienceId, s.score])).toEqual(
      second.policy.value.scored.map((s) => [s.experience.experienceId, s.score]),
    );
    expect(first.scheduler.value).toEqual(second.scheduler.value);
  });

  it("mindful attention policy SUGGESTS the ad instead of auto-starting it (no implicit attention consumption)", () => {
    const { scheduler } = runPipeline({
      candidateSet: built.candidateSet,
      items,
      realizations,
      attentionStyle: "mindful",
    });
    expect(scheduler.value.action).toBe("SUGGEST");
  });
});
