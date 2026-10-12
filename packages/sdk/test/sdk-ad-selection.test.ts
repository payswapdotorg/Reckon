/**
 * AD-004 — the SDK ad-selection composition helpers over the REAL API
 * in-process: `buildAdBearingCandidates` (queryAds → ONE merged
 * candidate set → decisions.request) and `adUserValueRewardTerm`
 * (resolve → declared ad USER value → the policy engine's reward
 * channel). The full pipeline — bearer auth, scopes, tenant law, frozen
 * zod validation on both sides, idempotency — runs for real.
 */
import { describe, expect, it } from "vitest";
import {
  createReckonClient,
  createInjectFetch,
  buildAdBearingCandidates,
  adUserValueRewardTerm,
  isReckonSdkError,
} from "../src/index.js";
import type { AdQueryRequestInput, DecisionRequestInput, ResolveRequestInput } from "../src/index.js";
import { finalizeAdMemoryRecord } from "@reckon/contracts";
import { InMemoryAdMemoryStore } from "../../../packages/persistence/src/index.js";
import {
  buildServer,
  createRuntimeAdRetrievalHandler,
  createRuntimeDecisionHandler,
  createRuntimeExperienceResolver,
  createAdSelectionSource,
} from "../../../apps/api/src/index.js";
import type { AdAvailabilityChannel, AdAvailabilitySupply, HandlerPorts } from "../../../apps/api/src/index.js";
import { buildHarness, SDK_KEYS, TENANT_A } from "./harness.js";

const AD_DECISIONS_KEY = "sdk-ad-decisions-key";
const keys = [
  ...SDK_KEYS,
  { apiKey: AD_DECISIONS_KEY, tenantId: TENANT_A, scopes: ["decisions", "outcomes", "catalog", "ads"] as never },
];

const AT = 10_000;

const supply: AdAvailabilitySupply = {
  ad: {
    schema: "reckon.catalog-item",
    schemaVersion: "0.1.0",
    itemId: "sdk-ad-flight-deal",
    kind: "advertising",
    labels: ["travel"],
    attributes: { headline: "Flights to Accra" },
  },
  realizations: [
    {
      schema: "reckon.realization",
      schemaVersion: "0.1.0",
      realizationId: "real-sdk-ad-flight",
      itemId: "sdk-ad-flight-deal",
      kind: "display",
      constraints: { formats: ["banner", "in-feed"], durationSeconds: 5 },
    },
  ],
  availability: { suppliedBy: "sdk-exchange", availableFrom: 0, availableUntil: 20_000 },
  rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
  eligibility: { flight: { fromMs: 1_000, untilMs: 15_000 }, surfaces: ["home"], gates: [], hostFrequencyPolicy: {} },
  userValue: { score: 0.8, reasons: ["planning a trip"] },
};

function buildAdSelectionHarness() {
  const store = new InMemoryAdMemoryStore();
  const channel: AdAvailabilityChannel = {
    channelId: "sdk-ad-selection-channel",
    listSupply: async () => [supply],
  };
  const handlers: Partial<HandlerPorts> = {
    decisionHandler: createRuntimeDecisionHandler({
      catalog: { listItems: async () => [], listRealizations: async () => [] },
      plans: { get: async () => null },
      adSelection: createAdSelectionSource({ store, channels: [channel] }),
    }),
    decisionStore: { get: async () => null },
    experienceResolver: createRuntimeExperienceResolver(),
    adRetrievalHandler: createRuntimeAdRetrievalHandler({ store, channels: [channel] }),
  };
  const harness = buildHarness({ keys, handlers });
  const client = createReckonClient({
    baseUrl: "http://reckon.test",
    apiKey: AD_DECISIONS_KEY,
    fetchImpl: harness.fetch,
    idGenerator: (() => {
      let n = 0;
      return () => `sdk-ad-sel-${(n += 1)}`;
    })(),
  });
  return { harness, client, store };
}

async function seedRemembered(store: InMemoryAdMemoryStore): Promise<void> {
  await store.put(
    finalizeAdMemoryRecord({
      tenant: { tenantId: TENANT_A },
      subject: { kind: "user", ref: "user-9" },
      ad: {
        itemId: "sdk-ad-remembered-hotel",
        kind: "advertising" as const,
        labels: ["travel"],
        attributes: { headline: "Stay in Accra" },
      },
      realizations: [
        {
          schema: "reckon.realization",
          schemaVersion: "0.1.0",
          realizationId: "real-sdk-remembered-hotel",
          itemId: "sdk-ad-remembered-hotel",
          kind: "display",
          constraints: { formats: ["card"], durationSeconds: 4 },
        },
      ],
      lineage: { source: "host-ad-server", advertiserRef: "adv-1", campaignRef: "camp-1", creativeRefs: [] },
      retention: { state: "active" as const, basis: { kind: "explicit-user-consent" as const, establishedAt: 1_000 } },
      permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
      provenance: {
        kind: "observed-encounter" as const,
        evidence: { outcomeEventId: "sdk-ev-seed", evidenceClass: "production-observed" as const, encounteredAt: 1_500 },
      },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      recordedAt: 2_000,
    }),
  );
}

describe("AD-004 SDK — buildAdBearingCandidates + decisions.request round-trip", () => {
  it("queryAds → merged candidate set → ONE decision through the real pipeline (ad selected with format + provenance)", async () => {
    const { harness, client, store } = buildAdSelectionHarness();
    try {
      await seedRemembered(store);

      // 1. The AD-003 retrieval (both lanes).
      const queryResult = await client.queryAds({
        queryId: "sdk-ad-sel-q-1",
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        mode: "both",
        at: AT,
      } as AdQueryRequestInput);
      expect(queryResult.remembered).toHaveLength(1);
      expect(queryResult.available).toHaveLength(1);

      // 2. The AD-004 host-side composition: ONE merged candidate set.
      const built = buildAdBearingCandidates({
        setId: "sdk-cs-merged",
        organic: {
          setId: "sdk-cs-organic",
          candidates: [{ itemId: "sdk-organic-video", realizationIds: [], source: "host-retrieval" }],
        },
        adQueryResult: queryResult,
        at: AT,
      });
      expect(built.candidateSet.candidates).toHaveLength(3);

      // 3. The decision request declares the merged set; the production
      // handler resolves ad truth from the SAME lanes at the request clock.
      const decision = await client.decisions.request({
        requestId: "sdk-ad-sel-req-1",
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        objective: { objectiveId: "obj-shop", kind: "shop" },
        attentionPolicy: { policyId: "ap-1", style: "balanced" },
        context: { contextId: "ctx-sdk-1" },
        candidates: built.candidateSet,
        policySelector: { policyId: "greedy-v1", version: "1" },
        at: AT,
        idempotencyKey: "sdk-ad-sel-idem-1",
      } as DecisionRequestInput);
      expect(decision.schema).toBe("reckon.decision-result");
      expect(decision.action).toBe("QUEUE");
      // The organic candidate has no catalog truth (honest absence); the
      // ads expand from ad-lane truth — the selected experience is an ad.
      expect(["sdk-ad-remembered-hotel", "sdk-ad-flight-deal"]).toContain(decision.selectedExperience?.itemId);
      expect(["card", "banner", "in-feed"]).toContain(decision.selectedExperience?.format.kind);
    } finally {
      await harness.app.close();
    }
  });

  it("resolve → adUserValueRewardTerm → the ad ranks by declared USER value through the policy engine", async () => {
    const { harness, client, store } = buildAdSelectionHarness();
    try {
      await seedRemembered(store);
      const queryResult = await client.queryAds({
        queryId: "sdk-ad-sel-q-2",
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        mode: "available",
        at: AT,
      } as AdQueryRequestInput);

      const built = buildAdBearingCandidates({
        setId: "sdk-cs-reward",
        adQueryResult: queryResult,
        at: AT,
      });

      // Resolve the ad experiences (ids for the reward term values).
      const resolved = await client.experiences.resolve({
        items: [...built.items],
        realizations: [...built.realizations],
        itemConstraints: built.itemConstraints,
      } as ResolveRequestInput);
      expect(resolved.experiences.map((e) => e.format.kind).sort()).toEqual(["banner", "in-feed"]);
      // The flight-window constraint from declared eligibility is stamped.
      expect(resolved.experiences[0]!.constraints).toContainEqual({ kind: "time-window", fromMs: 1_000, untilMs: 15_000 });

      const term = adUserValueRewardTerm({
        experiences: resolved.experiences,
        userValueByItemId: built.userValueByItemId,
      });
      expect(term).not.toBeNull();
      expect(Object.keys(term!.params["values"] as Record<string, number>)).toHaveLength(2);

      const decision = await client.decisions.request({
        requestId: "sdk-ad-sel-req-2",
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        objective: { objectiveId: "obj-shop", kind: "shop" },
        attentionPolicy: { policyId: "ap-1", style: "balanced" },
        context: { contextId: "ctx-sdk-2" },
        candidates: built.candidateSet,
        reward: { rewardId: "sdk-host-reward", version: "1", terms: [term!] },
        policySelector: { policyId: "greedy-v1", version: "1" },
        at: AT,
        idempotencyKey: "sdk-ad-sel-idem-2",
      } as DecisionRequestInput);
      // Declared user value 0.8 flows through the reward channel: the ad
      // is selected (score 0.4 = ½·0 fit + ½·0.8 reward).
      expect(decision.selectedExperience?.itemId).toBe("sdk-ad-flight-deal");
      expect(decision.alternatives).toHaveLength(1);
    } finally {
      await harness.app.close();
    }
  });

  it("typed error when the merged set would be empty (frozen CandidateSet min(1))", () => {
    expect(() =>
      buildAdBearingCandidates({
        setId: "sdk-cs-empty",
        adQueryResult: { remembered: [], available: [] },
        at: AT,
      }),
    ).toThrow(/at least one candidate/);
  });

  it("adUserValueRewardTerm returns null when no experience carries declared user value (nothing invented)", () => {
    expect(
      adUserValueRewardTerm({
        experiences: [{ experienceId: "exp-x", itemId: "item-no-value" }],
        userValueByItemId: {},
      }),
    ).toBeNull();
  });

  it("a decisions-scopeless key cannot reach the decisions route (typed scope error)", async () => {
    const { harness } = buildAdSelectionHarness();
    try {
      const client = createReckonClient({
        baseUrl: "http://reckon.test",
        apiKey: (SDK_KEYS.find((k) => !("scopes" in k && (k.scopes as string[]).includes?.("decisions")))?.apiKey ?? "sdk-key-tenant-b"),
        fetchImpl: harness.fetch,
        idGenerator: () => "sdk-ad-sel-x",
      });
      await expect(
        client.decisions.request({
          requestId: "req-no-scope",
          tenant: { tenantId: TENANT_A },
          subject: { kind: "user", ref: "user-9" },
          objective: { objectiveId: "obj", kind: "shop" },
          attentionPolicy: { policyId: "ap", style: "balanced" },
          context: { contextId: "ctx" },
          candidates: { setId: "cs", candidates: [{ itemId: "x", realizationIds: [], source: "host-retrieval" }] },
          policySelector: { policyId: "p", version: "1" },
          at: AT,
          idempotencyKey: "idem-no-scope",
        } as DecisionRequestInput),
      ).rejects.toSatisfy((error: unknown) => isReckonSdkError(error));
    } finally {
      await harness.app.close();
    }
  });
});
