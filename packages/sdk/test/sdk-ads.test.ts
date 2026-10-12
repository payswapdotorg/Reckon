/**
 * AD-003 — the SDK ads surface (client.ads.query / client.ads.forget and
 * the queryAds/forgetAds aliases) over the REAL API in-process (the SDK
 * harness boots the actual fastify app with the REAL ad-retrieval
 * runtime over the in-memory Personal Ad Memory + a deterministic
 * availability channel). The full request/response pipeline — bearer
 * auth, ads scope, tenant law, frozen zod validation on both sides,
 * idempotency, typed error mapping — runs for real on every call.
 */
import { describe, expect, it } from "vitest";
import { createReckonClient, createInjectFetch, isReckonSdkError } from "../src/index.js";
import {
  AdForgetResultSchema,
  AdQueryResultSchema,
  finalizeAdMemoryRecord,
  type AdMemoryRecord,
  type AdQueryResult,
} from "@reckon/contracts";
import { InMemoryAdMemoryStore } from "../../../packages/persistence/src/index.js";
import { buildServer, createRuntimeAdRetrievalHandler } from "../../../apps/api/src/index.js";
import type { AdAvailabilityChannel, AdAvailabilitySupply } from "../../../apps/api/src/index.js";
import { buildHarness, SDK_KEYS, TENANT_A } from "./harness.js";
import type { AdQueryRequestInput } from "../src/index.js";

const ADS_KEY = "sdk-ads-key";
const adsKeys = [...SDK_KEYS, { apiKey: ADS_KEY, tenantId: TENANT_A, scopes: ["ads" as const] }];

function seedableHarness(options: { supplies?: readonly AdAvailabilitySupply[] } = {}) {
  const store = new InMemoryAdMemoryStore();
  const channel: AdAvailabilityChannel = {
    channelId: "sdk-test-channel",
    listSupply: async () => options.supplies ?? [],
  };
  const harness = buildHarness({
    keys: adsKeys,
    handlers: {
      adRetrievalHandler: createRuntimeAdRetrievalHandler({ store, channels: [channel] }),
    },
  });
  const client = createReckonClient({
    baseUrl: "http://reckon.test",
    apiKey: ADS_KEY,
    fetchImpl: harness.fetch,
    idGenerator: (() => {
      let n = 0;
      return () => `sdk-ads-${(n += 1)}`;
    })(),
  });
  return { harness, client, store };
}

let seedSeq = 0;
async function seedRecord(store: InMemoryAdMemoryStore, itemId?: string): Promise<AdMemoryRecord> {
  seedSeq += 1;
  const put = await store.put(
    finalizeAdMemoryRecord({
      tenant: { tenantId: TENANT_A },
      subject: { kind: "user", ref: "user-9" },
      ad: {
        itemId: itemId ?? `sdk-ad-item-${seedSeq}`,
        kind: "advertising" as const,
        labels: ["travel"],
        attributes: { headline: "Stay in Accra" },
      },
      realizations: [],
      lineage: { source: "host-ad-server", advertiserRef: "adv-1", campaignRef: "camp-1", creativeRefs: [] },
      retention: {
        state: "active" as const,
        basis: { kind: "explicit-user-consent" as const, establishedAt: 1_000 },
      },
      permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
      provenance: {
        kind: "observed-encounter" as const,
        evidence: {
          outcomeEventId: `sdk-ev-${seedSeq}`,
          evidenceClass: "production-observed" as const,
          encounteredAt: 1_500,
        },
      },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      recordedAt: 2_000,
    }),
  );
  return put.record!;
}

function sdkQuery(overrides: Record<string, unknown> = {}): AdQueryRequestInput {
  return {
    queryId: `sdk-q-${(seedSeq += 1)}`,
    tenant: { tenantId: TENANT_A },
    subject: { kind: "user", ref: "user-9" },
    mode: "both",
    at: 10_000,
    ...overrides,
  } as AdQueryRequestInput;
}

describe("AD-003 SDK — reckon.ads.query (and the queryAds alias)", () => {
  it("round-trips the frozen contracts on both sides: remembered + available lanes, memory link, disclosed terms", async () => {
    const { harness, client, store } = seedableHarness({
      supplies: [
        {
          ad: {
            schema: "reckon.catalog-item",
            schemaVersion: "0.1.0",
            itemId: "sdk-shared-ad",
            kind: "advertising",
            labels: ["travel"],
            attributes: { headline: "Flights to Accra" },
          },
          realizations: [],
          availability: { suppliedBy: "sdk-ad-exchange", availableFrom: 0, availableUntil: 100_000 },
          rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
        },
      ],
    });
    const seeded = await seedRecord(store, "sdk-shared-ad");

    const result: AdQueryResult = await client.queryAds(sdkQuery({ text: "accra hotel" }));
    // The client already validated against AdQueryResultSchema; re-parse
    // proves the wire shape independently.
    expect(AdQueryResultSchema.parse(result)).toEqual(result);
    expect(result.schema).toBe("reckon.ad-query-result");
    expect(result.mode).toBe("both");
    expect(result.at).toBe(10_000);
    expect(result.queryUnderstanding?.terms).toEqual(["accra", "hotel"]);
    expect(result.remembered).toHaveLength(1);
    expect(result.remembered[0]!.record.recordId).toBe(seeded.recordId);
    expect(result.remembered[0]!.advertising).toBe(true);
    expect(result.available).toHaveLength(1);
    expect(result.available[0]!.availability.suppliedBy).toBe("sdk-ad-exchange");
    // The available candidate of the SAME ad links to the current memory record.
    expect(result.available[0]!.memoryRecordId).toBe(seeded.recordId);
    // The family method and the alias are the same surface.
    const viaFamily = await client.ads.query(sdkQuery({ mode: "remembered" }));
    expect(viaFamily.mode).toBe("remembered");
    expect(viaFamily.available).toEqual([]);
    expect(client.lastResponseMode()).toBe("live");
    await harness.app.close();
  });

  it("sends a generated Idempotency-Key header when the request omits the body key (the UX_DX_GAP is hidden from callers)", async () => {
    const { harness, client, store } = seedableHarness();
    await seedRecord(store);
    // No idempotencyKey in the body, none in options — must NOT 400.
    const result = await client.ads.query(sdkQuery());
    expect(result.remembered).toHaveLength(1);
    await harness.app.close();
  });

  it("replays idempotently when the body carries the key; conflicts are typed", async () => {
    const { harness, client, store } = seedableHarness();
    await seedRecord(store);
    // The SAME body (same queryId + idempotencyKey) replays verbatim.
    const payload = sdkQuery({ idempotencyKey: "sdk-shared-key" });
    const first = await client.ads.query(payload);
    const replay = await client.ads.query(payload);
    expect(replay).toEqual(first);
    await expect(
      client.ads.query({ ...payload, text: "different body same key" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 422 });
    await harness.app.close();
  });
});

describe("AD-003 SDK — reckon.ads.forget (and the forgetAds alias)", () => {
  it("forgets through the route and the result parses against the frozen contract", async () => {
    const { harness, client, store } = seedableHarness();
    const seeded = await seedRecord(store);

    const result = await client.forgetAds({
      requestId: "sdk-forget-1",
      tenant: { tenantId: TENANT_A },
      subject: { kind: "user", ref: "user-9" },
      target: { kind: "all" },
      reason: "sdk test forget",
      at: 12_000,
      idempotencyKey: "sdk-forget-idem-1",
    });
    expect(AdForgetResultSchema.parse(result)).toEqual(result);
    expect(result.forgottenCount).toBe(1);
    expect(result.forgottenRecordIds).toEqual([seeded.recordId]);

    // Terminal: the remembered lane is empty afterwards.
    const query = await client.ads.query(sdkQuery({ mode: "remembered" }));
    expect(query.remembered).toEqual([]);

    // A second forget of the same target reports zero (row-level idempotency).
    const reForget = await client.ads.forget({
      requestId: "sdk-forget-2",
      tenant: { tenantId: TENANT_A },
      subject: { kind: "user", ref: "user-9" },
      target: { kind: "all" },
      at: 13_000,
      idempotencyKey: "sdk-forget-idem-2",
    });
    expect(reForget.forgottenCount).toBe(0);
    await harness.app.close();
  });

  it("a forget request missing the body idempotencyKey fails client-side validation (SDK_REQUEST_INVALID)", async () => {
    const { harness, client } = seedableHarness();
    await expect(
      client.forgetAds({
        requestId: "sdk-forget-bad",
        tenant: { tenantId: TENANT_A },
        subject: { kind: "user", ref: "user-9" },
        target: { kind: "all" },
        at: 12_000,
        // idempotencyKey omitted — the frozen contract requires it.
      } as never),
    ).rejects.toMatchObject({ code: "SDK_REQUEST_INVALID" });
    await harness.app.close();
  });
});

describe("AD-003 SDK — typed error mapping for the ads family", () => {
  it("403 INSUFFICIENT_SCOPE → ReckonScopeError (a key without the ads scope)", async () => {
    const { harness } = seedableHarness();
    const betaClient = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: "sdk-beta", // decisions-only key
      fetchImpl: harness.fetch,
    });
    const caught = await betaClient.ads.query(sdkQuery()).catch((error: unknown) => error);
    expect(isReckonSdkError(caught)).toBe(true);
    expect((caught as { name: string }).name).toBe("ReckonScopeError");
    expect((caught as { code: string }).code).toBe("INSUFFICIENT_SCOPE");
    expect((caught as { statusCode: number }).statusCode).toBe(403);
    await harness.app.close();
  });

  it("403 TENANT_MISMATCH → ReckonTenantMismatchError (body tenant ≠ key tenant)", async () => {
    const { harness, client } = seedableHarness();
    const caught = await client.ads
      .query(sdkQuery({ tenant: { tenantId: "sdk-tenant-b" } }))
      .catch((error: unknown) => error);
    expect((caught as { name: string }).name).toBe("ReckonTenantMismatchError");
    expect((caught as { code: string }).code).toBe("TENANT_MISMATCH");
    await harness.app.close();
  });

  it("400 VALIDATION_ERROR → ReckonValidationError (header/body idempotency mismatch)", async () => {
    const { harness, client } = seedableHarness();
    const caught = await client.ads
      .query(sdkQuery({ idempotencyKey: "sdk-body-key" }), {
        headers: { "idempotency-key": "sdk-conflicting-header" },
      })
      .catch((error: unknown) => error);
    expect((caught as { name: string }).name).toBe("ReckonValidationError");
    expect((caught as { code: string }).code).toBe("VALIDATION_ERROR");
    expect((caught as { statusCode: number }).statusCode).toBe(400);
    await harness.app.close();
  });

  it("501 NOT_WIRED → ReckonNotWiredError (no ads handler mounted)", async () => {
    const app = buildServer({ apiVersion: "test", keys: adsKeys });
    const client = createReckonClient({
      baseUrl: "http://reckon.test",
      apiKey: ADS_KEY,
      fetchImpl: createInjectFetch(app),
    });
    const caught = await client.queryAds(sdkQuery()).catch((error: unknown) => error);
    expect((caught as { name: string }).name).toBe("ReckonNotWiredError");
    expect((caught as { code: string }).code).toBe("NOT_WIRED");
    expect((caught as { statusCode: number }).statusCode).toBe(501);
    await app.close();
  });
});
