/**
 * AD-004 — composition-level proof over a REAL PostgreSQL server: the
 * PRODUCTION composition (buildProductionServer) carries the FULL ad
 * selection + format/timing + memory round-trip through the real
 * pipeline:
 *
 *   seed PG memory → SDK queryAds (AD-003) → SDK buildAdBearingCandidates
 *   (AD-004 merged candidate set) → POST /v1/decisions with ad +
 *   organic candidates (the ONE kernel chain; ad truth resolved from PG
 *   memory + the composed channel at the request clock) → decision
 *   result carries the ad experience → SDK outcomes.append (impression)
 *   → the composition's ad-encounter capture writes Personal Ad Memory
 *   through the REAL PgAdMemoryStore → queryAds returns the captured ad
 *   as a remembered candidate → forgetAds → gone (terminal).
 *
 * Evidence class: controlled-local (real PG engine + production
 * executor + production composition + SDK; the deployed-infrastructure
 * wire path is Gate L with a real DATABASE_URL).
 *
 * Environmental note (honest): this sandbox exposes libicuuc.so.76 (not
 * .60); the embedded-postgres PG 18 binaries booted and ran cleanly
 * here — no ICU60 failure was observed in this environment.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createReckonClient, createInjectFetch, buildAdBearingCandidates, selectAdCandidacy } from "@reckon/sdk";
import type { DecisionRequestInput, OutcomeEventInput } from "@reckon/sdk";
import { buildProductionServer, type ProductionComposition } from "../src/index.js";
import type { AdAvailabilityChannel, AdAvailabilitySupply } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../../packages/persistence/test/pg-harness.js";

const TENANT = "prod-ad-sel-tenant";
const SUBJECT = { kind: "user" as const, ref: "user-42" };
const AT = 10_000;

let server: TestPostgres;
let composition: ProductionComposition;
let client: ReturnType<typeof createReckonClient>;
let decisionSeq = 0;

const channel: AdAvailabilityChannel = {
  channelId: "pg-ad-sel-channel",
  listSupply: async () => [
    {
      ad: {
        schema: "reckon.catalog-item",
        schemaVersion: "0.1.0",
        itemId: "pg-ad-supply-gadget",
        kind: "advertising",
        labels: ["tech"],
        attributes: { headline: "Gadget deal" },
      },
      realizations: [
        {
          schema: "reckon.realization",
          schemaVersion: "0.1.0",
          realizationId: "real-pg-ad-supply",
          itemId: "pg-ad-supply-gadget",
          kind: "display",
          constraints: { formats: ["banner", "card"], durationSeconds: 4 },
        },
      ],
      availability: { suppliedBy: "pg-exchange", availableFrom: 0, availableUntil: 1_000_000 },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      userValue: { score: 0.6, reasons: ["recently shopped tech"] },
    } satisfies AdAvailabilitySupply,
  ],
};

beforeAll(async () => {
  server = await startTestPostgres();
  composition = await buildProductionServer({
    executor: server.executor,
    webhookEncryptionKey: { bytes: randomBytes(32) },
    keys: [
      {
        apiKey: "prod-ad-sel-key",
        tenantId: TENANT,
        scopes: ["decisions", "outcomes", "plans", "catalog", "ads"] as never,
      },
    ],
    apiVersion: "ad-004-production",
    clock: { now: () => 1_000 },
    adAvailabilityChannels: [channel],
    adMemoryCapture: {
      policy: {
        eventTypes: ["impression"],
        retentionBasis: {
          kind: "explicit-user-consent",
          establishedAt: 1_000,
          basisRef: "pg-consent-rec-1",
          description: "user opted into ad memory (composition test)",
        },
      },
    },
  });
  client = createReckonClient({
    baseUrl: "http://reckon-production.test",
    apiKey: "prod-ad-sel-key",
    fetchImpl: createInjectFetch(composition.app as never) as never,
    idGenerator: (() => {
      let n = 0;
      return () => `pg-ad-sel-${(n += 1)}`;
    })(),
  });
}, 120_000);

afterAll(async () => {
  await composition.close();
  await server.stop();
}, 60_000);

async function pgDecisionRequest(overrides: Record<string, unknown> = {}): Promise<ReturnType<typeof client.decisions.request>> {
  decisionSeq += 1;
  return client.decisions.request({
    requestId: `pg-ad-req-${decisionSeq}`,
    tenant: { tenantId: TENANT },
    subject: SUBJECT,
    objective: { objectiveId: "obj-shop", kind: "shop" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-pg-1" },
    candidates: { setId: "pg-cs", candidates: [] },
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: AT,
    idempotencyKey: `pg-ad-idem-${decisionSeq}`,
    ...overrides,
  } as DecisionRequestInput);
}

describe("AD-004 production composition — the full ad selection + memory round-trip over PG", () => {
  it("queryAds → merged candidates → ONE decision; the ad experience is selected from ad-lane truth", async () => {
    // The channel supplies pg-ad-supply-gadget (available at AT).
    const queryResult = await client.queryAds({
      queryId: "pg-ad-sel-q-1",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "available",
      at: AT,
    });
    expect(queryResult.available).toHaveLength(1);

    const built = buildAdBearingCandidates({
      setId: "pg-cs-merged-1",
      adQueryResult: queryResult,
      at: AT,
    });
    expect(built.candidateSet.candidates).toHaveLength(1);

    const decision = await pgDecisionRequest({ candidates: built.candidateSet });
    expect(decision.action).toBe("QUEUE");
    expect(decision.selectedExperience?.itemId).toBe("pg-ad-supply-gadget");
    // Format variants from the ad realization (banner + card), one selected.
    expect(["banner", "card"]).toContain(decision.selectedExperience?.format.kind);
    // The remaining variant rides the alternatives with its score.
    expect(decision.alternatives).toHaveLength(1);
  });

  it("impression outcome → the composition captures the encounter into PG memory → queryAds remembers it", async () => {
    // Decide first (to obtain the ad experience id deterministically).
    const queryResult = await client.queryAds({
      queryId: "pg-ad-sel-q-2",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "available",
      at: AT,
    });
    const built = buildAdBearingCandidates({ setId: "pg-cs-merged-2", adQueryResult: queryResult, at: AT });
    const decision = await pgDecisionRequest({ candidates: built.candidateSet });
    const experienceId = decision.selectedExperience!.experienceId;

    // The host reports the observed impression through the EXISTING
    // outcomes surface (context by reference — law 5).
    const outcome = await client.outcomes.append({
      eventId: "pg-ad-ev-1",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      decisionId: decision.decisionId,
      experienceId,
      eventType: "impression",
      occurredAt: AT,
      context: { contextId: "ctx-pg-1" },
      evidenceClass: "production-observed",
      idempotencyKey: "pg-ad-ev-idem-1",
    } as OutcomeEventInput);
    expect(outcome.eventId).toBe("pg-ad-ev-1");

    // The capture ran after the outcome was durable: the ad is now a
    // REMEMBERED candidate in PG (provenance = the observed encounter).
    const remembered = await client.queryAds({
      queryId: "pg-ad-sel-q-3",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "remembered",
      at: AT + 1,
    });
    expect(remembered.remembered.map((c) => c.record.ad.itemId)).toEqual(["pg-ad-supply-gadget"]);
    const record = remembered.remembered[0]!.record;
    if (record.provenance.kind !== "observed-encounter") {
      throw new Error("expected observed-encounter provenance");
    }
    expect(record.provenance.evidence.outcomeEventId).toBe("pg-ad-ev-1");
    expect(record.provenance.evidence.encounteredAt).toBe(AT);
    expect(record.provenance.evidence.context).toEqual({ contextId: "ctx-pg-1" });
    expect(record.retention.basis.kind).toBe("explicit-user-consent");
    // The remembered record now ALSO resolves decision truth (one lane seam).
    const rememberedDecision = await pgDecisionRequest({
      candidates: {
        setId: "pg-cs-remembered",
        candidates: [{ itemId: "pg-ad-supply-gadget", realizationIds: ["real-pg-ad-supply"], source: "reckon.ad-memory.remembered" }],
      },
    });
    expect(rememberedDecision.selectedExperience?.itemId).toBe("pg-ad-supply-gadget");
  });

  it("simulated-class impressions are NEVER captured (law 10 — PG stays clean)", async () => {
    await client.outcomes.append({
      eventId: "pg-ad-ev-sim",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      experienceId: "exp-simulated-ad",
      eventType: "impression",
      occurredAt: AT,
      evidenceClass: "simulated",
      idempotencyKey: "pg-ad-ev-idem-sim",
    } as OutcomeEventInput);

    const remembered = await client.queryAds({
      queryId: "pg-ad-sel-q-4",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "remembered",
      at: AT + 2,
    });
    expect(remembered.remembered.map((c) => c.record.ad.itemId)).toEqual(["pg-ad-supply-gadget"]);
  });

  it("terminal forget through the route: the captured ad disappears from every later query (law 2, PG tombstone)", async () => {
    const remembered = await client.queryAds({
      queryId: "pg-ad-sel-q-5",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "remembered",
      at: AT,
    });
    const recordId = remembered.remembered[0]!.record.recordId;

    const forget = await client.forgetAds({
      requestId: "pg-ad-forget-1",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      target: { kind: "record", recordId },
      reason: "composition round-trip complete",
      at: AT + 3,
      idempotencyKey: "pg-ad-forget-idem-1",
    });
    expect(forget.forgottenCount).toBe(1);

    const after = await client.queryAds({
      queryId: "pg-ad-sel-q-6",
      tenant: { tenantId: TENANT },
      subject: SUBJECT,
      mode: "remembered",
      at: AT + 4,
    });
    expect(after.remembered).toEqual([]);
    // The PG tombstone: get() returns null on every read path.
    expect(await composition.stores.adMemory.get({ tenantId: TENANT }, recordId)).toBeNull();
  });

  it("clock semantics against PG: a window-closed supply ad is not declared at the later clock; rewind restores it", async () => {
    const before = buildAdBearingCandidates({
      setId: "pg-cs-clock-before",
      adQueryResult: await client.queryAds({
        queryId: "pg-ad-sel-q-7",
        tenant: { tenantId: TENANT },
        subject: SUBJECT,
        mode: "available",
        at: AT,
      }),
      at: AT,
    });
    expect(before.candidateSet.candidates).toHaveLength(1);

    // Cross-clock honesty: the host queried at AT (the ad was supplied),
    // then decides LATER — the AD-004 selection gate closes the window at
    // the SELECTION clock (the query's own gate covered only its `at`).
    const laterSelection = selectAdCandidacy(
      await client.queryAds({
        queryId: "pg-ad-sel-q-8",
        tenant: { tenantId: TENANT },
        subject: SUBJECT,
        mode: "available",
        at: AT,
      }),
      1_000_001,
    );
    expect(laterSelection.candidates).toHaveLength(0);
    expect(laterSelection.notes.join(" ")).toContain("closed at the selection clock");
    expect(() =>
      buildAdBearingCandidates({
        setId: "pg-cs-clock-after",
        adQueryResult: { remembered: [], available: [] },
        at: 1_000_001,
      }),
    ).toThrow(/at least one candidate/);

    // Rewind: deterministic replay at the earlier clock.
    const rewind = buildAdBearingCandidates({
      setId: "pg-cs-clock-rewind",
      adQueryResult: await client.queryAds({
        queryId: "pg-ad-sel-q-9",
        tenant: { tenantId: TENANT },
        subject: SUBJECT,
        mode: "available",
        at: AT,
      }),
      at: AT,
    });
    expect(rewind.candidateSet.candidates).toHaveLength(1);
  });
});
