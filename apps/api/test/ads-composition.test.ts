/**
 * AD-003 — composition-level proof over a REAL PostgreSQL server: the
 * PRODUCTION composition (buildProductionServer) mounts the ad-retrieval
 * runtime on the REAL PgAdMemoryStore (the m007_ad_memory migration
 * ships with applyMigrations), and the /v1/ads route family answers
 * through the full production pipeline. The SDK client drives the
 * frozen contracts end-to-end:
 *
 *   seed (PG store put) → query (remembered from PG + available from a
 *   composed availability channel + memory link) → caller-clock expiry
 *   (before/after/rewind — deterministic replay against PG) → forget
 *   through the route (terminal) → query again (empty lane).
 *
 * Evidence class: controlled-local (real PG engine + production
 * executor + production composition; the deployed-infrastructure wire
 * path is Gate L with a real DATABASE_URL).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { finalizeAdMemoryRecord } from "@reckon/contracts";
import { createReckonClient, createInjectFetch } from "@reckon/sdk";
import { buildProductionServer, type ProductionComposition } from "../src/index.js";
import type { AdAvailabilityChannel, AdAvailabilitySupply } from "../src/index.js";
import { startTestPostgres, type TestPostgres } from "../../../packages/persistence/test/pg-harness.js";

let server: TestPostgres;
let composition: ProductionComposition;
let client: ReturnType<typeof createReckonClient>;

beforeAll(async () => {
  server = await startTestPostgres();
  const channel: AdAvailabilityChannel = {
    channelId: "pg-test-channel",
    listSupply: async () => [
      {
        ad: {
          schema: "reckon.catalog-item",
          schemaVersion: "0.1.0",
          itemId: "pg-shared-ad",
          kind: "advertising",
          labels: ["travel"],
          attributes: { headline: "Flights to Accra" },
        },
        realizations: [],
        availability: { suppliedBy: "pg-ad-exchange", availableFrom: 0, availableUntil: 100_000 },
        rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      },
    ] satisfies AdAvailabilitySupply[],
  };
  composition = await buildProductionServer({
    executor: server.executor,
    webhookEncryptionKey: { bytes: randomBytes(32) },
    keys: [
      {
        apiKey: "prod-ads-key-a",
        tenantId: "prod-tenant-a",
        scopes: ["decisions", "outcomes", "plans", "catalog", "ads"] as never,
      },
    ],
    apiVersion: "ad-003-production",
    clock: { now: () => 1_000 },
    adAvailabilityChannels: [channel],
  });
  client = createReckonClient({
    baseUrl: "http://reckon-production.test",
    apiKey: "prod-ads-key-a",
    fetchImpl: createInjectFetch(composition.app as never) as never,
    idGenerator: (() => {
      let n = 0;
      return () => `pg-ads-${(n += 1)}`;
    })(),
  });
}, 120_000);

afterAll(async () => {
  await composition.close();
  await server.stop();
}, 60_000);

async function seedPgRecord(options: { itemId: string; expiresAt?: number; recordedAt?: number }) {
  return composition.stores.adMemory.put(
    finalizeAdMemoryRecord({
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      ad: {
        itemId: options.itemId,
        kind: "advertising" as const,
        labels: ["travel"],
        attributes: { headline: "Stay in Accra" },
      },
      realizations: [],
      lineage: { source: "host-ad-server", advertiserRef: "adv-pg", campaignRef: "camp-pg", creativeRefs: [] },
      retention: {
        state: "active" as const,
        basis: { kind: "explicit-user-consent" as const, establishedAt: 1_000 },
        ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
      },
      permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
      provenance: {
        kind: "observed-encounter" as const,
        evidence: {
          outcomeEventId: `pg-ev-${options.itemId}`,
          evidenceClass: "production-observed" as const,
          encounteredAt: 1_500,
        },
      },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      recordedAt: options.recordedAt ?? 2_000,
    }),
  );
}

describe("AD-003 production composition — PG-backed ad retrieval through the real store", () => {
  it("query returns the PG-persisted memory in the remembered lane, channel supply in the available lane, and links them", async () => {
    const seeded = await seedPgRecord({ itemId: "pg-shared-ad" });

    const result = await client.queryAds({
      queryId: "pg-q-1",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      mode: "both",
      at: 10_000,
    });
    expect(result.schema).toBe("reckon.ad-query-result");
    expect(result.remembered).toHaveLength(1);
    expect(result.remembered[0]!.record.recordId).toBe(seeded.record!.recordId);
    // Provenance verbatim from the stored record (law 9).
    expect(result.remembered[0]!.record.provenance.kind).toBe("observed-encounter");
    expect(result.remembered[0]!.record.retention.state).toBe("active");
    expect(result.available).toHaveLength(1);
    expect(result.available[0]!.availability.suppliedBy).toBe("pg-ad-exchange");
    expect(result.available[0]!.memoryRecordId).toBe(seeded.record!.recordId);
  });

  it("caller-clock expiry against PG: before/at/after the boundary, rewind returns the record again", async () => {
    await seedPgRecord({ itemId: "pg-expiring-ad", expiresAt: 20_000, recordedAt: 3_000 });

    const before = await client.queryAds({
      queryId: "pg-q-2",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      mode: "remembered",
      text: "expiring",
      at: 19_999,
    });
    expect(before.remembered.map((entry) => entry.record.ad.itemId)).toEqual(["pg-expiring-ad"]);

    const after = await client.queryAds({
      queryId: "pg-q-3",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      mode: "remembered",
      at: 20_000,
    });
    expect(after.remembered.map((entry) => entry.record.ad.itemId)).not.toContain("pg-expiring-ad");

    // Rewind: deterministic replay — the store keeps no hidden now.
    const rewind = await client.queryAds({
      queryId: "pg-q-4",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      mode: "remembered",
      text: "expiring",
      at: 19_999,
    });
    expect(rewind.remembered.map((entry) => entry.record.ad.itemId)).toEqual(["pg-expiring-ad"]);
  });

  it("forget through the route is terminal against PG: the ad disappears from every later query", async () => {
    const seeded = await seedPgRecord({ itemId: "pg-forgotten-ad", recordedAt: 4_000 });

    const forgetResult = await client.forgetAds({
      requestId: "pg-forget-1",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      target: { kind: "record", recordId: seeded.record!.recordId },
      reason: "composition test forget",
      at: 12_000,
      idempotencyKey: "pg-forget-idem-1",
    });
    expect(forgetResult.forgottenCount).toBe(1);
    expect(forgetResult.forgottenRecordIds).toEqual([seeded.record!.recordId]);

    const afterForget = await client.queryAds({
      queryId: "pg-q-5",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      mode: "remembered",
      at: 10_000,
    });
    expect(afterForget.remembered.map((entry) => entry.record.ad.itemId)).not.toContain("pg-forgotten-ad");

    // The PG tombstone: get() returns null on every read path (law 2).
    expect(await composition.stores.adMemory.get({ tenantId: "prod-tenant-a" }, seeded.record!.recordId)).toBeNull();

    // Row-level idempotency: a fresh forget of the same record reports 0.
    const reForget = await client.forgetAds({
      requestId: "pg-forget-2",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-42" },
      target: { kind: "record", recordId: seeded.record!.recordId },
      at: 13_000,
      idempotencyKey: "pg-forget-idem-2",
    });
    expect(reForget.forgottenCount).toBe(0);
  });

  it("the subject scope holds: another subject's memory is invisible through the same key", async () => {
    await seedPgRecord({ itemId: "pg-other-subject-ad", recordedAt: 5_000 });
    // The seed above is subject user-42; querying as user-99 through the
    // SAME tenant key sees none of it.
    const result = await client.queryAds({
      queryId: "pg-q-6",
      tenant: { tenantId: "prod-tenant-a" },
      subject: { kind: "user", ref: "user-99" },
      mode: "remembered",
      at: 10_000,
    });
    expect(result.remembered).toEqual([]);
  });
});
