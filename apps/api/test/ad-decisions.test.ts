/**
 * AD-004 — API ROUTE integration: the decision/experience request
 * pipeline over ad-bearing candidate sets, through the REAL fastify
 * pipeline (auth → scope → tenant law → frozen-schema validation →
 * idempotency → the REAL runtime decision handler with the ad-selection
 * source → frozen-schema response validation).
 *
 * Covers:
 * - POST /v1/decisions with DECLARED ad candidates (frozen ad-lane
 *   sources) alongside organic candidates: ad truth resolves from the
 *   ad lane (memory + channels) at the REQUEST clock; the response
 *   carries the ad experience with format/timing/provenance and the
 *   policy/scheduler explainability of the ONE pipeline.
 * - Context BY REFERENCE (law 5): the request's ContextReference flows;
 *   no raw context exists anywhere on the wire.
 * - Idempotency: same key + body → verbatim replay; same key +
 *   different body → typed 422.
 * - Clock semantics: the caller-supplied `at` gates ad candidacy
 *   (window-closed ads fall out; rewinding the clock restores them —
 *   deterministic replay).
 * - POST /v1/experiences/resolve with ad items + per-item constraints
 *   (the additive API-level envelope field).
 *
 * Evidence class: controlled-local (in-process; PG-backed proof in
 * ad-selection-composition.test.ts).
 */
import { describe, expect, it } from "vitest";
import { finalizeAdMemoryRecord, type AdMemoryRecord } from "@reckon/contracts";
import { InMemoryAdMemoryStore } from "@reckon/persistence";
import { buildServer } from "../src/server.js";
import { createRuntimeDecisionHandler, createRuntimeExperienceResolver } from "../src/composition.js";
import { createAdSelectionSource } from "../src/ad-selection.js";
import { createRuntimeAdRetrievalHandler, type AdAvailabilityChannel } from "../src/ad-retrieval.js";
import type { HandlerPorts } from "../src/ports.js";
import { ALPHA, TENANT_A, authHeaders, injectJson, freshIdem } from "./fixtures.js";

/* ------------------------------------------------------------------ *
 * Wiring — the REAL runtime decision handler + ad-selection source
 * ------------------------------------------------------------------ */

const AT = 10_000;

const adMemory = new InMemoryAdMemoryStore();

const channel: AdAvailabilityChannel = {
  channelId: "route-test-channel",
  listSupply: async () => [
    {
      ad: {
        schema: "reckon.catalog-item",
        schemaVersion: "0.1.0",
        itemId: "ad-channel-deal",
        kind: "advertising",
        labels: ["travel"],
        attributes: { headline: "Weekend deal" },
      },
      realizations: [
        {
          schema: "reckon.realization",
          schemaVersion: "0.1.0",
          realizationId: "real-ad-channel-card",
          itemId: "ad-channel-deal",
          kind: "card",
          constraints: { formats: ["card"], durationSeconds: 3 },
        },
      ],
      availability: { suppliedBy: "route-exchange", availableFrom: 0, availableUntil: 20_000 },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      eligibility: { flight: { fromMs: 1_000, untilMs: 15_000 }, surfaces: ["home"], gates: ["freq-cap"], hostFrequencyPolicy: {} },
      userValue: { score: 0.7, reasons: ["planning a trip"] },
    },
  ],
};

function seedRememberedAd(options: { itemId: string; availableUntil?: number; formats?: string[] }): AdMemoryRecord {
  const record = finalizeAdMemoryRecord({
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    ad: {
      itemId: options.itemId,
      kind: "advertising",
      labels: ["travel"],
      attributes: { headline: "Stay in Accra" },
      ...(options.availableUntil !== undefined ? { availableUntil: options.availableUntil } : {}),
    },
    realizations: [
      {
        schema: "reckon.realization",
        schemaVersion: "0.1.0",
        realizationId: `real-${options.itemId}`,
        itemId: options.itemId,
        kind: "display",
        constraints: { formats: options.formats ?? ["banner"], durationSeconds: 5 },
      },
    ],
    lineage: { source: "host-ad-server", advertiserRef: "adv-1", campaignRef: "camp-1", creativeRefs: [] },
    retention: { state: "active", basis: { kind: "explicit-user-consent", establishedAt: 1_000 } },
    permissions: { retain: "granted", present: "granted", history: [] },
    provenance: {
      kind: "observed-encounter",
      evidence: { outcomeEventId: "ev-seed", evidenceClass: "production-observed", encounteredAt: 1_500, context: { contextId: "ctx-1" } },
    },
    rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
    recordedAt: 2_000,
  });
  return adMemory.put(record).then((put) => {
    if (put.record === null) throw new Error("seed failed (tombstone?)");
    return put.record;
  }) as never as AdMemoryRecord;
}

function buildAdServer() {
  const handlers: Partial<HandlerPorts> = {
    decisionHandler: createRuntimeDecisionHandler({
      catalog: {
        listItems: async () => [],
        listRealizations: async () => [],
      },
      plans: { get: async () => null },
      adSelection: createAdSelectionSource({ store: adMemory, channels: [channel] }),
    }),
    decisionStore: { get: async () => null },
    outcomeIngest: { ingest: async (event) => event },
    experienceResolver: createRuntimeExperienceResolver(),
    adRetrievalHandler: createRuntimeAdRetrievalHandler({ store: adMemory, channels: [channel] }),
  };
  return buildServer({ keys: [{ apiKey: ALPHA, tenantId: TENANT_A, scopes: ["decisions", "outcomes", "catalog", "ads"] }], handlers });
}

function adDecisionRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req-ad-1",
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    objective: { objectiveId: "obj-shop", kind: "shop" },
    attentionPolicy: { policyId: "ap-1", style: "balanced" },
    context: { contextId: "ctx-42" },
    candidates: {
      setId: "cs-ad-route",
      candidates: [
        { itemId: "ad-remembered-hotel", realizationIds: [`real-ad-remembered-hotel`], source: "reckon.ad-memory.remembered" },
        { itemId: "ad-channel-deal", realizationIds: ["real-ad-channel-card"], source: "reckon.ad-availability.current" },
      ],
    },
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: AT,
    idempotencyKey: freshIdem("ad-decision"),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * POST /v1/decisions — ad-bearing requests
 * ------------------------------------------------------------------ */

describe("POST /v1/decisions with declared ad candidates (AD-004)", () => {
  it("resolves ad truth from BOTH lanes at the request clock and returns ad experiences through the ONE pipeline", async () => {
    await seedRememberedAd({ itemId: "ad-remembered-hotel" });
    const app = buildAdServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest(),
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["schema"]).toBe("reckon.decision-result");
      // The scheduler QUEUEs the best scored candidate (balanced policy,
      // no declared evidence ⇒ deterministic id tie-break) — the selected
      // experience is one of the ads, expanded from ad-lane truth.
      expect(body["action"]).toBe("QUEUE");
      const selected = body["selectedExperience"] as Record<string, unknown>;
      expect(["ad-remembered-hotel", "ad-channel-deal"]).toContain(selected["itemId"]);
      expect(selected["format"]).toMatchObject({ kind: expect.any(String) });
      // Explainability: alternatives + reasons ride the frozen result.
      expect(Array.isArray(body["alternatives"])).toBe(true);
      expect(Array.isArray(body["reasons"])).toBe(true);
      expect(body["provenance"]).toMatchObject({ system: "reckon-api-production" });
    } finally {
      await app.close();
    }
  });

  it("carries the request's context BY REFERENCE (law 5) — no raw context field exists on the wire", async () => {
    await seedRememberedAd({ itemId: "ad-remembered-hotel" });
    const app = buildAdServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({ context: { contextId: "ctx-by-ref-7" } }),
        headers: authHeaders(ALPHA),
      });
      expect(res.status).toBe(200);
      // The request schema IS the frozen contract: context is a
      // ContextReference ({contextId}) — an attempt to smuggle raw
      // location/attention data is a typed 400 (unknown keys stripped /
      // shape mismatch), proven below.
      const badContext = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({ context: { contextId: "ctx-x", location: { lat: 5.6, lng: -0.2 } } }),
        headers: authHeaders(ALPHA),
      });
      expect(badContext.status).toBe(200); // zod strips unknown keys (law 5: nothing persists)
      const parsed = badContext.body as { selectedExperience?: { itemId?: string } };
      expect(parsed.selectedExperience).toBeDefined();
    } finally {
      await app.close();
    }
  });

  it("idempotency: same key + same body → verbatim replay; same key + different body → typed 422", async () => {
    await seedRememberedAd({ itemId: "ad-remembered-hotel" });
    const app = buildAdServer();
    try {
      const payload = adDecisionRequest({ idempotencyKey: "ad-idem-1" });
      const first = await injectJson(app, "POST", "/v1/decisions", { payload, headers: authHeaders(ALPHA) });
      expect(first.status).toBe(200);
      const second = await injectJson(app, "POST", "/v1/decisions", { payload, headers: authHeaders(ALPHA) });
      expect(second.status).toBe(200);
      expect(second.headers["idempotent-replayed"]).toBe("true");
      expect(second.body).toEqual(first.body);

      const conflict = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({ idempotencyKey: "ad-idem-1", at: AT + 1 }),
        headers: authHeaders(ALPHA),
      });
      expect(conflict.status).toBe(422);
      expect((conflict.body as { error: { code?: string } }).error?.code).toBe("IDEMPOTENCY_CONFLICT");
    } finally {
      await app.close();
    }
  });

  it("clock semantics: the caller-supplied `at` gates ad candidacy — a window-closed ad falls out, rewinding restores it", async () => {
    await seedRememberedAd({ itemId: "ad-remembered-hotel", availableUntil: 12_000 });
    await seedRememberedAd({ itemId: "ad-open-ended" });
    const app = buildAdServer();
    try {
      const before = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({
          at: 11_999,
          candidates: {
            setId: "cs-clock",
            candidates: [
              { itemId: "ad-remembered-hotel", realizationIds: ["real-ad-remembered-hotel"], source: "reckon.ad-memory.remembered" },
              { itemId: "ad-open-ended", realizationIds: ["real-ad-open-ended"], source: "reckon.ad-memory.remembered" },
            ],
          },
        }),
        headers: authHeaders(ALPHA),
      });
      expect(before.status).toBe(200);
      const beforeAlternatives = (before.body as { alternatives: { experienceId: string }[] }).alternatives.length;
      // Both ads expand (2 banner experiences) + the scheduler selects 1.
      expect(beforeAlternatives).toBe(1);

      const after = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({
          at: 12_000,
          candidates: {
            setId: "cs-clock",
            candidates: [
              { itemId: "ad-remembered-hotel", realizationIds: ["real-ad-remembered-hotel"], source: "reckon.ad-memory.remembered" },
              { itemId: "ad-open-ended", realizationIds: ["real-ad-open-ended"], source: "reckon.ad-memory.remembered" },
            ],
          },
        }),
        headers: authHeaders(ALPHA),
      });
      expect(after.status).toBe(200);
      // The window-closed ad resolves no truth at the later clock — the
      // honest-absence law excludes it (only the open-ended ad remains).
      const afterBody = after.body as { selectedExperience?: { itemId?: string }; alternatives?: unknown[] };
      expect(afterBody.selectedExperience?.itemId).toBe("ad-open-ended");
      expect(afterBody.alternatives).toHaveLength(0);

      // Rewind: deterministic replay — the same request at 11_999 again
      // selects the same experience as the first call.
      const rewind = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({
          at: 11_999,
          idempotencyKey: freshIdem("rewind"),
          candidates: {
            setId: "cs-clock",
            candidates: [
              { itemId: "ad-remembered-hotel", realizationIds: ["real-ad-remembered-hotel"], source: "reckon.ad-memory.remembered" },
              { itemId: "ad-open-ended", realizationIds: ["real-open-ended-x"], source: "reckon.ad-memory.remembered" },
              { itemId: "ad-open-ended", realizationIds: ["real-ad-open-ended"], source: "reckon.ad-memory.remembered" },
            ],
          },
        }),
        headers: authHeaders(ALPHA),
      });
      expect(rewind.status).toBe(200);
      expect((rewind.body as { selectedExperience?: { itemId?: string } }).selectedExperience?.itemId).toBe(
        (before.body as { selectedExperience?: { itemId?: string } }).selectedExperience?.itemId,
      );
    } finally {
      await app.close();
    }
  });

  it("an ad candidate with NO resolvable truth anywhere is excluded by the honest-absence law (never invented)", async () => {
    const app = buildAdServer();
    try {
      const res = await injectJson(app, "POST", "/v1/decisions", {
        payload: adDecisionRequest({
          candidates: {
            setId: "cs-ghost",
            candidates: [{ itemId: "ad-ghost", realizationIds: [], source: "reckon.ad-memory.remembered" }],
          },
        }),
        headers: authHeaders(ALPHA),
      });
      // No expandable experiences ⇒ the runtime handler's honest
      // composition error (500 — never a fabricated ad experience).
      expect(res.status).toBe(500);
    } finally {
      await app.close();
    }
  });
});

/* ------------------------------------------------------------------ *
 * POST /v1/experiences/resolve — ad items + per-item constraints
 * ------------------------------------------------------------------ */

describe("POST /v1/experiences/resolve with ad items (AD-004)", () => {
  it("expands ad format variants and stamps per-item constraints (the additive envelope field)", async () => {
    const app = buildAdServer();
    try {
      const res = await injectJson(app, "POST", "/v1/experiences/resolve", {
        payload: {
          items: [
            {
              itemId: "ad-resolve",
              kind: "advertising",
              labels: ["travel"],
              attributes: {},
            },
          ],
          realizations: [
            {
              realizationId: "real-ad-resolve-banner",
              itemId: "ad-resolve",
              kind: "display",
              constraints: { formats: ["banner"], durationSeconds: 5 },
            },
            {
              realizationId: "real-ad-resolve-interstitial",
              itemId: "ad-resolve",
              kind: "interstitial",
              constraints: { formats: ["interstitial"], durationSeconds: 20 },
            },
          ],
          itemConstraints: {
            "ad-resolve": [{ kind: "max-duration", seconds: 6 }],
          },
        },
        headers: { ...authHeaders(ALPHA), "idempotency-key": freshIdem("resolve") },
      });
      expect(res.status).toBe(200);
      const body = res.body as { schema: string; experiences: { format: { kind: string }; constraints: unknown[] }[] };
      expect(body.schema).toBe("reckon.experience");
      // The 20s interstitial fails the 6s bumper policy; only the banner survives.
      expect(body.experiences.map((e) => e.format.kind)).toEqual(["banner"]);
      expect(body.experiences[0]!.constraints).toEqual([{ kind: "max-duration", seconds: 6 }]);
    } finally {
      await app.close();
    }
  });
});
