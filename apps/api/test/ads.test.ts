/**
 * AD-003 — the /v1/ads route family over the REAL ad-retrieval runtime
 * (createRuntimeAdRetrievalHandler) on the AD-002 InMemoryAdMemoryStore
 * (test infrastructure; the PG-backed composition proof lives in
 * ads-composition.test.ts). Evidence class: controlled-local.
 *
 * Covers (route boundary — through the real fastify pipeline: auth →
 * scope → tenant law → frozen-schema validation → idempotency →
 * handler → frozen-schema response validation):
 *
 * - Both retrieval lanes (remembered through the store port, available
 *   through host availability channels) + mode variants + lane
 *   separation (law 9).
 * - Deterministic lexical matching (terms disclosed in
 *   queryUnderstanding; semantic-match never emitted — honest note).
 * - Structured filters: terms / labels / lineage / surfaces /
 *   encounter window / per-lane limit; unevaluable dimensions exclude
 *   (never a silent pass).
 * - Clock semantics: caller-supplied `at` everywhere (expiry
 *   before/at/after the boundary, rewind determinism, availability
 *   windows) — law 3.
 * - Permission gates: retain + present (store-enforced; law 2/6).
 * - Forget: all four targets, terminality, idempotent re-forget,
 *   tombstone semantics through the route (law 2).
 * - Idempotency: replay (no re-execution), typed 422 conflict,
 *   body-key vs header conventions.
 * - Auth matrix: 401 / 403 scope / 403 tenant / 400 validation / 501
 *   NotWired.
 */
import { describe, expect, it } from "vitest";
import {
  finalizeAdMemoryRecord,
  type AdForgetRequest,
  type AdMemoryRecord,
  type AdRightsConstraints,
  type SubjectReference,
  type TenantScope,
} from "@reckon/contracts";
import { InMemoryAdMemoryStore, type AdMemoryStore } from "@reckon/persistence";
import { buildServer } from "../src/server.js";
import {
  createRuntimeAdRetrievalHandler,
  type AdAvailabilityChannel,
  type AdAvailabilitySupply,
} from "../src/ad-retrieval.js";
import type { FastifyInstance } from "fastify";
import {
  ALPHA,
  BETA,
  TENANT_A,
  TENANT_B,
  TEST_KEYS,
  authHeaders,
  buildDefaultServer,
  injectJson,
  expectErrorEnvelope,
  freshIdem,
} from "./fixtures.js";

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const ADS_KEY = "test-key-ads";
const adsKeys = [
  ...TEST_KEYS,
  { apiKey: ADS_KEY, tenantId: TENANT_A, scopes: ["ads" as const] },
];

const tenantA: TenantScope = { tenantId: TENANT_A };
const subject = (ref: string): SubjectReference => ({ kind: "user", ref });

const defaultBasis = { kind: "explicit-user-consent" as const, establishedAt: 1_000, basisRef: "consent-42" };

interface MakeRecordOptions {
  readonly subjectRef?: string;
  readonly itemId?: string;
  readonly labels?: readonly string[];
  readonly advertiserRef?: string;
  readonly campaignRef?: string;
  readonly encounteredAt?: number;
  readonly recordedAt?: number;
  readonly expiresAt?: number;
  readonly retentionState?: "active" | "expired";
  readonly permissionRetain?: "granted" | "revoked";
  readonly permissionPresent?: "granted" | "revoked";
  readonly rights?: AdRightsConstraints;
  readonly adAttributes?: Record<string, unknown>;
  readonly surface?: string;
}

let fixtureSeq = 0;
function fixtureId(prefix: string): string {
  fixtureSeq += 1;
  return `${prefix}-${fixtureSeq}`;
}

function makeRecord(options: MakeRecordOptions = {}): AdMemoryRecord {
  const retention =
    options.retentionState === "expired"
      ? { state: "expired" as const, basis: defaultBasis, retainedAt: 1_000, expiresAt: 50_000, expiredAt: 60_000 }
      : {
          state: "active" as const,
          basis: defaultBasis,
          retainedAt: 1_000,
          ...(options.expiresAt !== undefined ? { expiresAt: options.expiresAt } : {}),
        };
  return finalizeAdMemoryRecord({
    tenant: tenantA,
    subject: subject(options.subjectRef ?? "user-9"),
    ad: {
      itemId: options.itemId ?? fixtureId("ad-item"),
      kind: "advertising" as const,
      labels: [...(options.labels ?? ["travel"])],
      attributes: options.adAttributes ?? { headline: "Stay in Accra" },
    },
    realizations: [],
    lineage: {
      source: "host-ad-server",
      advertiserRef: options.advertiserRef ?? "adv-default",
      campaignRef: options.campaignRef ?? "camp-1",
      creativeRefs: ["cr-1"],
    },
    retention,
    permissions: {
      retain: options.permissionRetain ?? "granted",
      present: options.permissionPresent ?? "granted",
      history: [],
    },
    provenance: {
      kind: "observed-encounter" as const,
      evidence: {
        outcomeEventId: fixtureId("ev"),
        evidenceClass: "production-observed" as const,
        encounteredAt: options.encounteredAt ?? 1_000,
        context: { contextId: "ctx-1" },
        surface: options.surface ?? "in-stream",
      },
    },
    rights: options.rights ?? { redistributionPermitted: false, gates: ["host-rights-gate"], usageRestrictions: [] },
    recordedAt: options.recordedAt ?? 2_000,
  });
}

/** Full output-shape availability supply (the channel port's contract type). */
function makeSupply(options: {
  itemId?: string;
  labels?: readonly string[];
  attributes?: Record<string, unknown>;
  suppliedBy?: string;
  availableFrom?: number;
  availableUntil?: number;
  adAvailableFrom?: number;
  adAvailableUntil?: number;
  memoryRecordId?: string;
  surfaces?: readonly string[];
}): AdAvailabilitySupply {
  return {
    ad: {
      schema: "reckon.catalog-item",
      schemaVersion: "0.1.0",
      itemId: options.itemId ?? fixtureId("sup-item"),
      kind: "advertising",
      labels: [...(options.labels ?? ["travel"])],
      attributes: options.attributes ?? { headline: "Flights to Accra" },
      ...(options.adAvailableFrom !== undefined ? { availableFrom: options.adAvailableFrom } : {}),
      ...(options.adAvailableUntil !== undefined ? { availableUntil: options.adAvailableUntil } : {}),
    },
    realizations: [],
    availability: {
      suppliedBy: options.suppliedBy ?? "host-ad-exchange",
      ...(options.availableFrom !== undefined ? { availableFrom: options.availableFrom } : {}),
      ...(options.availableUntil !== undefined ? { availableUntil: options.availableUntil } : {}),
    },
    rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
    ...(options.memoryRecordId !== undefined ? { memoryRecordId: options.memoryRecordId } : {}),
    ...(options.surfaces !== undefined
      ? { eligibility: { surfaces: [...options.surfaces], gates: [], hostFrequencyPolicy: {} } }
      : {}),
  };
}

/** A recording availability channel (spy on lane reads + tenant observations). */
function recordingChannel(
  supplies: readonly AdAvailabilitySupply[],
): AdAvailabilityChannel & { calls: number; observedTenants: string[] } {
  const channel = {
    calls: 0,
    observedTenants: [] as string[],
    channelId: "test-channel",
    async listSupply(tenant: TenantScope): Promise<readonly AdAvailabilitySupply[]> {
      channel.calls += 1;
      channel.observedTenants.push(tenant.tenantId);
      return supplies;
    },
  };
  return channel;
}

/** A counting store delegate (proves the remembered lane was/was not read). */
class CountingAdMemoryStore implements AdMemoryStore {
  listRememberedCalls = 0;
  readonly #inner: AdMemoryStore;
  constructor(inner: AdMemoryStore) {
    this.#inner = inner;
  }
  put(record: AdMemoryRecord) {
    return this.#inner.put(record);
  }
  get(tenant: TenantScope, recordId: string) {
    return this.#inner.get(tenant, recordId);
  }
  listRemembered(tenant: TenantScope, subjectRef: SubjectReference, at: number, options?: { limit?: number }) {
    this.listRememberedCalls += 1;
    return this.#inner.listRemembered(tenant, subjectRef, at, options);
  }
  forget(request: AdForgetRequest) {
    return this.#inner.forget(request);
  }
  applyPermissionTransition(tenant: TenantScope, recordId: string, transition: Parameters<AdMemoryStore["applyPermissionTransition"]>[2]) {
    return this.#inner.applyPermissionTransition(tenant, recordId, transition);
  }
}

interface AdsServer {
  readonly app: FastifyInstance;
  readonly store: CountingAdMemoryStore;
  readonly channel: (AdAvailabilityChannel & { calls: number; observedTenants: string[] }) | undefined;
}

function buildAdsServer(options: { channels?: readonly AdAvailabilityChannel[]; store?: AdMemoryStore } = {}): AdsServer {
  const store = new CountingAdMemoryStore(options.store ?? new InMemoryAdMemoryStore());
  const firstChannel = options.channels?.[0] as AdsServer["channel"];
  const app = buildServer({
    keys: adsKeys,
    handlers: {
      adRetrievalHandler: createRuntimeAdRetrievalHandler({
        store,
        ...(options.channels !== undefined && options.channels.length > 0 ? { channels: options.channels } : {}),
      }),
    },
  });
  return { app, store, channel: firstChannel };
}

let querySeq = 0;
function adQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  querySeq += 1;
  return {
    queryId: `q-${querySeq}`,
    tenant: { tenantId: TENANT_A },
    subject: subject("user-9"),
    mode: "both",
    at: 10_000,
    idempotencyKey: `adq-${querySeq}`,
    ...overrides,
  };
}

let forgetSeq = 0;
function adForget(
  target: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  forgetSeq += 1;
  return {
    requestId: `fr-${forgetSeq}`,
    tenant: { tenantId: TENANT_A },
    subject: subject("user-9"),
    target,
    at: 12_000,
    idempotencyKey: `adf-${forgetSeq}`,
    ...overrides,
  };
}

async function queryAds(app: FastifyInstance, payload: Record<string, unknown>, key = ADS_KEY) {
  return injectJson(app, "POST", "/v1/ads/query", { payload, headers: authHeaders(key) });
}

async function forgetAds(app: FastifyInstance, payload: Record<string, unknown>, key = ADS_KEY) {
  return injectJson(app, "POST", "/v1/ads/forget", { payload, headers: authHeaders(key) });
}

/* ------------------------------------------------------------------ *
 * The suite
 * ------------------------------------------------------------------ */

describe("AD-003 POST /v1/ads/query — both lanes", () => {
  it("returns remembered (store order) and available (channel order) candidates in separate arrays with disclosed understanding", async () => {
    const channel = recordingChannel([
      makeSupply({ itemId: "sup-open", availableFrom: 0, availableUntil: 100_000 }),
      makeSupply({ itemId: "sup-closed", availableUntil: 5_000 }),
    ]);
    const server = buildAdsServer({ channels: [channel] });
    const hotel = makeRecord({ itemId: "ad-hotel", recordedAt: 2_000, encounteredAt: 1_500 });
    const laptop = makeRecord({
      itemId: "ad-laptop",
      recordedAt: 4_000,
      encounteredAt: 3_500,
      labels: ["electronics"],
      adAttributes: { headline: "Lightweight laptop deals" },
    });
    await server.store.put(hotel);
    await server.store.put(laptop);

    const res = await queryAds(server.app, adQuery());
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.schema).toBe("reckon.ad-query-result");
    expect(body.queryId).toBe("q-" + querySeq);
    expect(body.mode).toBe("both");
    expect(body.at).toBe(10_000);

    const remembered = body.remembered as {
      advertising: boolean;
      record: { recordId: string; recordedAt: number };
      whyRetrieved: { kind: string }[];
    }[];
    expect(remembered.map((entry) => entry.record.recordId)).toEqual([hotel.recordId, laptop.recordId]);
    // Law 7: deterministic chronological order (recordedAt ASC) — never re-sorted.
    expect(remembered[0]!.record.recordedAt).toBeLessThanOrEqual(remembered[1]!.record.recordedAt);
    for (const entry of remembered) {
      expect(entry.advertising).toBe(true);
      expect(entry.whyRetrieved.map((reason) => reason.kind)).toContain("user-requested");
    }

    const available = body.available as { ad: { itemId: string }; memoryRecordId?: string; availability: { suppliedBy: string } }[];
    expect(available).toHaveLength(1);
    expect(available[0]!.ad.itemId).toBe("sup-open");
    expect(available[0]!.availability.suppliedBy).toBe("host-ad-exchange");
    expect(available[0]!.memoryRecordId).toBeUndefined();

    expect(body.queryUnderstanding).toEqual({ terms: [] });
    const notes = body.notes as string[];
    expect(notes.join(" | ")).toContain("availability window was closed");
    expect(channel.observedTenants).toEqual([TENANT_A]);
    await server.app.close();
  });

  it("links an available candidate to the current remembered record of the same ad (mode both only)", async () => {
    const channel = recordingChannel([
      makeSupply({ itemId: "ad-hotel", availableFrom: 0, availableUntil: 100_000 }),
    ]);
    const server = buildAdsServer({ channels: [channel] });
    const hotel = makeRecord({ itemId: "ad-hotel", recordedAt: 2_000 });
    await server.store.put(hotel);

    const res = await queryAds(server.app, adQuery());
    const available = (res.body as { available: { memoryRecordId?: string }[] }).available;
    expect(available).toHaveLength(1);
    expect(available[0]!.memoryRecordId).toBe(hotel.recordId);

    // mode=available never reads memory — the link cannot be synthesized.
    const resAvailableOnly = await queryAds(
      server.app,
      adQuery({ mode: "available", subject: subject("user-9") }),
    );
    const availableOnly = (resAvailableOnly.body as { available: { memoryRecordId?: string }[] }).available;
    expect(availableOnly).toHaveLength(1);
    expect(availableOnly[0]!.memoryRecordId).toBeUndefined();
    expect(server.store.listRememberedCalls).toBe(1); // only the mode=both query read memory
    await server.app.close();
  });

  it("available candidates carry provider-supplied provenance first (law 9) and channel-declared rights verbatim (law 4)", async () => {
    const supply = makeSupply({ itemId: "sup-rights", availableFrom: 0, availableUntil: 100_000 });
    supply.rights = { redistributionPermitted: false, gates: ["host-gate-1"], usageRestrictions: ["no-retargeting"] };
    const server = buildAdsServer({ channels: [recordingChannel([supply])] });
    const res = await queryAds(server.app, adQuery({ mode: "available" }));
    const available = (
      res.body as { available: { whyRetrieved: { kind: string; detail: string }[]; rights: AdRightsConstraints }[] }
    ).available;
    expect(available).toHaveLength(1);
    expect(available[0]!.whyRetrieved[0]!.kind).toBe("provider-supplied");
    expect(available[0]!.whyRetrieved[0]!.detail).toContain("host-ad-exchange");
    expect(available[0]!.rights.gates).toEqual(["host-gate-1"]);
    expect(available[0]!.rights.usageRestrictions).toEqual(["no-retargeting"]);
    await server.app.close();
  });

  it("no availability channels → honest empty available lane with a disclosed note (never faked supply)", async () => {
    const server = buildAdsServer();
    const res = await queryAds(server.app, adQuery());
    expect(res.status).toBe(200);
    const body = res.body as { available: unknown[]; notes: string[] };
    expect(body.available).toEqual([]);
    expect(body.notes.join(" | ")).toContain("no ad availability channels are configured");
    await server.app.close();
  });
});

describe("AD-003 POST /v1/ads/query — deterministic lexical matching (honest, no model)", () => {
  it("extracts disclosed terms from raw text and matches case-insensitive substrings over ad metadata", async () => {
    const server = buildAdsServer();
    const hotel = makeRecord({ itemId: "ad-hotel", adAttributes: { headline: "Stay in Accra" }, recordedAt: 2_000 });
    const laptop = makeRecord({
      itemId: "ad-laptop",
      labels: ["electronics"],
      adAttributes: { headline: "Lightweight laptop deals" },
      recordedAt: 4_000,
    });
    await server.store.put(hotel);
    await server.store.put(laptop);

    const res = await queryAds(server.app, adQuery({ text: "Show me the laptop ads I saw last week" }));
    expect(res.status).toBe(200);
    const body = res.body as {
      remembered: { record: { recordId: string }; whyRetrieved: { kind: string; score?: number; detail?: string }[] }[];
      queryUnderstanding: { terms: string[] };
      notes: string[];
    };
    // "show/me/the/ads/i/saw/last/week" are stopwords — only "laptop" survives.
    expect(body.queryUnderstanding.terms).toEqual(["laptop"]);
    expect(body.remembered).toHaveLength(1);
    expect(body.remembered[0]!.record.recordId).toBe(laptop.recordId);
    const matchReason = body.remembered[0]!.whyRetrieved.find((reason) => reason.kind === "query-match");
    expect(matchReason).toBeDefined();
    expect(matchReason!.score).toBe(1);
    expect(matchReason!.detail).toContain("laptop");
    // Honest semantic limitation disclosed; the semantic-match REASON
    // kind is never emitted (the note explains why — it may mention the
    // kind by name, the lanes never carry it).
    expect(body.notes.join(" | ")).toContain("no embedding model was consulted");
    const reasonKinds = body.remembered.flatMap((entry) => entry.whyRetrieved.map((reason) => reason.kind));
    expect(reasonKinds).not.toContain("semantic-match");
    await server.app.close();
  });

  it("partial term matches carry a fractional score hint but never reorder the lane (law 7)", async () => {
    const server = buildAdsServer();
    const both = makeRecord({
      itemId: "ad-both",
      adAttributes: { headline: "Accra hotel deals" },
      recordedAt: 9_000,
    });
    const one = makeRecord({ itemId: "ad-one", adAttributes: { headline: "Hotel booking" }, recordedAt: 1_000 });
    await server.store.put(both);
    await server.store.put(one);

    const res = await queryAds(server.app, adQuery({ text: "hotel deals accra" }));
    const remembered = (
      res.body as { remembered: { record: { recordId: string; recordedAt: number }; whyRetrieved: { kind: string; score?: number }[] }[] }
    ).remembered;
    expect(remembered).toHaveLength(2);
    // Chronological order preserved even though "ad-both" (later) matches more terms.
    expect(remembered.map((entry) => entry.record.recordId)).toEqual([one.recordId, both.recordId]);
    const scoreOf = (recordId: string) =>
      remembered.find((entry) => entry.record.recordId === recordId)!.whyRetrieved.find((r) => r.kind === "query-match")!.score;
    expect(scoreOf(both.recordId)).toBe(1);
    expect(scoreOf(one.recordId)).toBeCloseTo(1 / 3, 5);
    await server.app.close();
  });

  it("text with no usable terms is disclosed honestly and constrains nothing", async () => {
    const server = buildAdsServer();
    const record = makeRecord({ itemId: "ad-x", recordedAt: 2_000 });
    await server.store.put(record);
    const res = await queryAds(server.app, adQuery({ text: "show me the ads" }));
    const body = res.body as { remembered: unknown[]; queryUnderstanding: { terms: string[] }; notes: string[] };
    expect(body.queryUnderstanding.terms).toEqual([]);
    expect(body.remembered).toHaveLength(1);
    expect(body.notes.join(" | ")).toContain("yielded no usable search terms");
    await server.app.close();
  });

  it("context is accepted by reference only — disclosed, never matched (law 5)", async () => {
    const server = buildAdsServer();
    const res = await queryAds(server.app, adQuery({ context: { contextId: "ctx-evening" } }));
    const body = res.body as { notes: string[] };
    expect(body.notes.join(" | ")).toContain("context was accepted by reference only");
    await server.app.close();
  });
});

describe("AD-003 POST /v1/ads/query — structured filters", () => {
  it("labels filter matches case-insensitively (any-of) and reports label-match", async () => {
    const server = buildAdsServer();
    const hotel = makeRecord({ itemId: "ad-h1", labels: ["Travel", "deals"], recordedAt: 2_000 });
    const laptop = makeRecord({ itemId: "ad-l1", labels: ["electronics"], recordedAt: 3_000 });
    await server.store.put(hotel);
    await server.store.put(laptop);
    const res = await queryAds(server.app, adQuery({ filters: { labels: ["travel"] } }));
    const remembered = (res.body as { remembered: { record: { recordId: string }; whyRetrieved: { kind: string }[] }[] }).remembered;
    expect(remembered).toHaveLength(1);
    expect(remembered[0]!.record.recordId).toBe(hotel.recordId);
    expect(remembered[0]!.whyRetrieved.some((reason) => reason.kind === "label-match")).toBe(true);
    await server.app.close();
  });

  it("lineage filters match remembered lineage (lineage-match) and exclude the available lane honestly", async () => {
    const channel = recordingChannel([makeSupply({ itemId: "sup-1", availableFrom: 0, availableUntil: 100_000 })]);
    const server = buildAdsServer({ channels: [channel] });
    const hotel = makeRecord({ itemId: "ad-h2", advertiserRef: "adv-hotel", recordedAt: 2_000 });
    const other = makeRecord({ itemId: "ad-o2", advertiserRef: "adv-other", recordedAt: 3_000 });
    await server.store.put(hotel);
    await server.store.put(other);

    const res = await queryAds(server.app, adQuery({ filters: { advertiserRefs: ["adv-hotel"] } }));
    const body = res.body as {
      remembered: { record: { recordId: string }; whyRetrieved: { kind: string; detail: string }[] }[];
      available: unknown[];
      notes: string[];
    };
    expect(body.remembered).toHaveLength(1);
    expect(body.remembered[0]!.record.recordId).toBe(hotel.recordId);
    expect(body.remembered[0]!.whyRetrieved.some((r) => r.kind === "lineage-match" && r.detail.includes("adv-hotel"))).toBe(true);
    // Availability declarations carry no lineage — excluded, with the honest note.
    expect(body.available).toEqual([]);
    expect(body.notes.join(" | ")).toContain("provider-supplied availability carries no lineage");
    await server.app.close();
  });

  it("campaign refs filter matches campaign lineage", async () => {
    const server = buildAdsServer();
    const camp = makeRecord({ itemId: "ad-c1", campaignRef: "camp-summer", recordedAt: 2_000 });
    await server.store.put(camp);
    const res = await queryAds(server.app, adQuery({ filters: { campaignRefs: ["camp-summer"] } }));
    const remembered = (res.body as { remembered: { record: { recordId: string }[] } }).remembered;
    expect(remembered).toHaveLength(1);
    await server.app.close();
  });

  it("surfaces filter matches the encounter surface (remembered) and eligibility surfaces (available)", async () => {
    const channel = recordingChannel([
      makeSupply({ itemId: "sup-web", surfaces: ["web"], availableFrom: 0, availableUntil: 100_000 }),
      makeSupply({ itemId: "sup-tv", surfaces: ["tv"], availableFrom: 0, availableUntil: 100_000 }),
    ]);
    const server = buildAdsServer({ channels: [channel] });
    const inStream = makeRecord({ itemId: "ad-s1", surface: "in-stream", recordedAt: 2_000 });
    const inApp = makeRecord({ itemId: "ad-s2", surface: "in-app", recordedAt: 3_000 });
    await server.store.put(inStream);
    await server.store.put(inApp);

    // One filter, both lanes: "in-stream" matches the remembered
    // encounter surface; "web" matches the available lane's declared
    // eligibility surfaces.
    const res = await queryAds(server.app, adQuery({ filters: { surfaces: ["IN-STREAM", "web"] } }));
    const body = res.body as { remembered: { record: { recordId: string } }[]; available: { ad: { itemId: string } }[] };
    expect(body.remembered).toHaveLength(1);
    expect(body.remembered[0]!.record.recordId).toBe(inStream.recordId);
    // web supply matches the surface filter; tv does not.
    expect(body.available.map((entry) => entry.ad.itemId)).toEqual(["sup-web"]);
    await server.app.close();
  });

  it("encounter window filters apply to observed encounters only (inclusive bounds)", async () => {
    const channel = recordingChannel([makeSupply({ itemId: "sup-e", availableFrom: 0, availableUntil: 100_000 })]);
    const server = buildAdsServer({ channels: [channel] });
    const early = makeRecord({ itemId: "ad-e1", encounteredAt: 1_500, recordedAt: 2_000 });
    const late = makeRecord({ itemId: "ad-e2", encounteredAt: 3_500, recordedAt: 4_000 });
    await server.store.put(early);
    await server.store.put(late);

    const res = await queryAds(
      server.app,
      adQuery({ filters: { encounteredFrom: 1_500, encounteredUntil: 2_000 } }),
    );
    const body = res.body as { remembered: { record: { recordId: string }; whyRetrieved: { kind: string }[] }[]; available: unknown[]; notes: string[] };
    expect(body.remembered.map((entry) => entry.record.recordId)).toEqual([early.recordId]);
    expect(body.remembered[0]!.whyRetrieved.some((reason) => reason.kind === "temporal-match")).toBe(true);
    expect(body.available).toEqual([]);
    expect(body.notes.join(" | ")).toContain("encounter-window filter");
    await server.app.close();
  });

  it("limit caps each lane independently (per the frozen filter contract)", async () => {
    const channel = recordingChannel([
      makeSupply({ itemId: "sup-a", availableFrom: 0, availableUntil: 100_000 }),
      makeSupply({ itemId: "sup-b", availableFrom: 0, availableUntil: 100_000 }),
      makeSupply({ itemId: "sup-c", availableFrom: 0, availableUntil: 100_000 }),
    ]);
    const server = buildAdsServer({ channels: [channel] });
    await server.store.put(makeRecord({ itemId: "ad-r1", recordedAt: 1_000 }));
    await server.store.put(makeRecord({ itemId: "ad-r2", recordedAt: 2_000 }));
    await server.store.put(makeRecord({ itemId: "ad-r3", recordedAt: 3_000 }));

    const res = await queryAds(server.app, adQuery({ filters: { limit: 2 } }));
    const body = res.body as { remembered: unknown[]; available: unknown[] };
    expect(body.remembered).toHaveLength(2);
    expect(body.available).toHaveLength(2);
    await server.app.close();
  });

  it("filters combine conjunctively across dimensions", async () => {
    const server = buildAdsServer();
    const hotelTravel = makeRecord({ itemId: "ad-ct1", labels: ["travel"], adAttributes: { headline: "Beach resort" }, recordedAt: 2_000 });
    const hotelTech = makeRecord({ itemId: "ad-ct2", labels: ["electronics"], adAttributes: { headline: "Beach speakers" }, recordedAt: 3_000 });
    await server.store.put(hotelTravel);
    await server.store.put(hotelTech);

    const res = await queryAds(server.app, adQuery({ filters: { labels: ["travel"], terms: ["beach"] } }));
    const remembered = (res.body as { remembered: { record: { recordId: string } }[] }).remembered;
    expect(remembered.map((entry) => entry.record.recordId)).toEqual([hotelTravel.recordId]);
    await server.app.close();
  });
});

describe("AD-003 POST /v1/ads/query — clock semantics (law 3, caller-supplied at)", () => {
  it("retention expiry is evaluated against the caller clock: before/at/after the boundary, rewind works", async () => {
    const server = buildAdsServer();
    await server.store.put(makeRecord({ itemId: "ad-exp", expiresAt: 5_000, recordedAt: 2_000 }));

    const before = await queryAds(server.app, adQuery({ at: 4_999 }));
    expect((before.body as { remembered: unknown[] }).remembered).toHaveLength(1);

    const atBoundary = await queryAds(server.app, adQuery({ at: 5_000 }));
    expect((atBoundary.body as { remembered: unknown[] }).remembered).toEqual([]); // expiresAt <= at is expired

    const after = await queryAds(server.app, adQuery({ at: 6_000 }));
    expect((after.body as { remembered: unknown[] }).remembered).toEqual([]);

    // Rewind: replay at the earlier clock returns the record again —
    // the store keeps no hidden now; `at` is the only clock.
    const rewind = await queryAds(server.app, adQuery({ at: 4_999 }));
    expect((rewind.body as { remembered: unknown[] }).remembered).toHaveLength(1);
    await server.app.close();
  });

  it("structurally expired records are never remembered candidates at any clock", async () => {
    const server = buildAdsServer();
    await server.store.put(makeRecord({ itemId: "ad-dead", retentionState: "expired", recordedAt: 2_000 }));
    for (const at of [1_000, 60_000, 1_000_000]) {
      const res = await queryAds(server.app, adQuery({ at }));
      expect((res.body as { remembered: unknown[] }).remembered).toEqual([]);
    }
    await server.app.close();
  });

  it("availability windows (channel declaration AND the ad's own catalog window) gate the available lane at the caller clock", async () => {
    const server = buildAdsServer({
      channels: [
        recordingChannel([
          makeSupply({ itemId: "sup-win", availableFrom: 2_000, availableUntil: 8_000 }),
          makeSupply({ itemId: "sup-adwindow", availableFrom: 0, availableUntil: 100_000, adAvailableUntil: 6_000 }),
        ]),
      ],
    });
    const tooEarly = await queryAds(server.app, adQuery({ mode: "available", at: 1_000 }));
    // sup-win's channel window opens at 2_000 (excluded); sup-adwindow
    // is open at 1_000 through BOTH its windows.
    expect((tooEarly.body as { available: { ad: { itemId: string } }[] }).available.map((c) => c.ad.itemId)).toEqual([
      "sup-adwindow",
    ]);
    expect(((tooEarly.body as { notes: string[] }).notes).join(" | ")).toContain("availability window was closed");

    const inside = await queryAds(server.app, adQuery({ mode: "available", at: 5_000 }));
    // Both supplies are open at 5_000 (the second via both its channel
    // window and its ad's own catalog window).
    expect((inside.body as { available: { ad: { itemId: string } }[] }).available.map((c) => c.ad.itemId)).toEqual([
      "sup-win",
      "sup-adwindow",
    ]);

    // At 7_000 the second supply's AD-level window has closed (law 3 —
    // an ad past its own catalog window is not currently available).
    const adWindowClosed = await queryAds(server.app, adQuery({ mode: "available", at: 7_000 }));
    expect((adWindowClosed.body as { available: { ad: { itemId: string } }[] }).available.map((c) => c.ad.itemId)).toEqual([
      "sup-win",
    ]);

    const tooLate = await queryAds(server.app, adQuery({ mode: "available", at: 9_000 }));
    expect((tooLate.body as { available: unknown[] }).available).toEqual([]);
    await server.app.close();
  });

  it("permission gates: present-revoked and retain-revoked records never enter the remembered lane", async () => {
    const server = buildAdsServer();
    await server.store.put(makeRecord({ itemId: "ad-present", permissionPresent: "revoked", recordedAt: 2_000 }));
    await server.store.put(makeRecord({ itemId: "ad-retain", permissionRetain: "revoked", recordedAt: 3_000 }));
    await server.store.put(makeRecord({ itemId: "ad-fine", recordedAt: 4_000 }));
    const res = await queryAds(server.app, adQuery());
    const remembered = (res.body as { remembered: { record: { ad: { itemId: string } } }[] }).remembered;
    expect(remembered.map((entry) => entry.record.ad.itemId)).toEqual(["ad-fine"]);
    await server.app.close();
  });

  it("mode variants: remembered does not query channels; available does not read memory", async () => {
    const channel = recordingChannel([makeSupply({ itemId: "sup-m", availableFrom: 0, availableUntil: 100_000 })]);
    const server = buildAdsServer({ channels: [channel] });
    await server.store.put(makeRecord({ itemId: "ad-m1", recordedAt: 2_000 }));

    const rememberedOnly = await queryAds(server.app, adQuery({ mode: "remembered" }));
    const rememberedBody = rememberedOnly.body as { remembered: unknown[]; available: unknown[] };
    expect(rememberedBody.remembered).toHaveLength(1);
    expect(rememberedBody.available).toEqual([]);
    expect(channel.calls).toBe(0);

    const availableOnly = await queryAds(server.app, adQuery({ mode: "available" }));
    const availableBody = availableOnly.body as { remembered: unknown[]; available: unknown[] };
    expect(availableBody.remembered).toEqual([]);
    expect(availableBody.available).toHaveLength(1);
    expect(server.store.listRememberedCalls).toBe(1); // only the mode=remembered/both queries
    await server.app.close();
  });
});

describe("AD-003 POST /v1/ads/forget — terminal, audit-preserving (law 2)", () => {
  it("forgets a single record through the route; the ad disappears from retrieval forever", async () => {
    const server = buildAdsServer();
    const record = makeRecord({ itemId: "ad-f1", recordedAt: 2_000 });
    await server.store.put(record);

    const forgetRes = await forgetAds(server.app, adForget({ kind: "record", recordId: record.recordId }, { reason: "not relevant" }));
    expect(forgetRes.status).toBe(200);
    const forgetBody = forgetRes.body as { schema: string; forgottenCount: number; forgottenRecordIds: string[]; at: number };
    expect(forgetBody.schema).toBe("reckon.ad-forget-result");
    expect(forgetBody.forgottenCount).toBe(1);
    expect(forgetBody.forgottenRecordIds).toEqual([record.recordId]);
    expect(forgetBody.at).toBe(12_000);

    const queryRes = await queryAds(server.app, adQuery());
    expect((queryRes.body as { remembered: unknown[] }).remembered).toEqual([]);

    // No un-forget: the tombstone read path returns null.
    expect(await server.store.get(tenantA, record.recordId)).toBeNull();

    // Re-forget the same record (fresh request): idempotent, reports 0.
    const reForget = await forgetAds(server.app, adForget({ kind: "record", recordId: record.recordId }));
    expect((reForget.body as { forgottenCount: number }).forgottenCount).toBe(0);
    await server.app.close();
  });

  it("forgets by item, by advertiser and all — scoped to the request tenant+subject", async () => {
    const server = buildAdsServer();
    const hotel1 = makeRecord({ itemId: "item-hotel", advertiserRef: "adv-h", recordedAt: 2_000 });
    const hotel2 = makeRecord({ itemId: "item-hotel-2", advertiserRef: "adv-h", recordedAt: 3_000 });
    const tech = makeRecord({ itemId: "item-tech", advertiserRef: "adv-t", recordedAt: 4_000 });
    await server.store.put(hotel1);
    await server.store.put(hotel2);
    await server.store.put(tech);

    const byItem = await forgetAds(server.app, adForget({ kind: "item", itemId: "item-hotel" }));
    expect((byItem.body as { forgottenCount: number }).forgottenCount).toBe(1);

    const byAdvertiser = await forgetAds(server.app, adForget({ kind: "advertiser", advertiserRef: "adv-t" }));
    expect((byAdvertiser.body as { forgottenCount: number }).forgottenCount).toBe(1);

    const remaining = await queryAds(server.app, adQuery());
    expect((remaining.body as { remembered: { record: { recordId: string } }[] }).remembered.map((r) => r.record.recordId)).toEqual([hotel2.recordId]);

    const all = await forgetAds(server.app, adForget({ kind: "all" }));
    expect((all.body as { forgottenCount: number }).forgottenCount).toBe(1);
    const empty = await queryAds(server.app, adQuery());
    expect((empty.body as { remembered: unknown[] }).remembered).toEqual([]);
    await server.app.close();
  });

  it("forget is tenant-scoped: another tenant's memory is untouched", async () => {
    const server = buildAdsServer();
    const record = makeRecord({ subjectRef: "user-9", itemId: "ad-t1", recordedAt: 2_000 });
    await server.store.put(record);
    // A forget for a DIFFERENT subject cannot touch user-9's memory.
    const other = await forgetAds(server.app, adForget({ kind: "all" }, { subject: subject("someone-else") }));
    expect((other.body as { forgottenCount: number }).forgottenCount).toBe(0);
    const query = await queryAds(server.app, adQuery());
    expect((query.body as { remembered: unknown[] }).remembered).toHaveLength(1);
    await server.app.close();
  });
});

describe("AD-003 idempotency (the platform body-key convention)", () => {
  it("replays a query verbatim without re-executing the handler", async () => {
    const server = buildAdsServer();
    await server.store.put(makeRecord({ itemId: "ad-i1", recordedAt: 2_000 }));
    const payload = adQuery({ idempotencyKey: "shared-query-key" });

    const first = await queryAds(server.app, payload);
    expect(first.status).toBe(200);
    expect(first.headers["idempotent-replayed"]).toBeUndefined();
    const second = await queryAds(server.app, payload);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    // The replay short-circuits the handler — memory was read exactly once.
    expect(server.store.listRememberedCalls).toBe(1);
    await server.app.close();
  });

  it("same key + different body → typed 422 IDEMPOTENCY_CONFLICT", async () => {
    const server = buildAdsServer();
    const first = await queryAds(server.app, adQuery({ idempotencyKey: "conflict-key" }));
    expect(first.status).toBe(200);
    const conflicting = await queryAds(
      server.app,
      adQuery({ idempotencyKey: "conflict-key", text: "different body same key" }),
    );
    expectErrorEnvelope(conflicting.status, conflicting.body, "IDEMPOTENCY_CONFLICT");
    expect(conflicting.status).toBe(422);
    await server.app.close();
  });

  it("body key is authoritative; a mismatching header is a typed 400; no key at all is a typed 400", async () => {
    const server = buildAdsServer();
    await server.store.put(makeRecord({ itemId: "ad-i2", recordedAt: 2_000 }));

    const mismatch = await injectJson(server.app, "POST", "/v1/ads/query", {
      payload: adQuery({ idempotencyKey: "body-key-1" }),
      headers: authHeaders(ADS_KEY, { "idempotency-key": "header-key-1" }),
    });
    expectErrorEnvelope(mismatch.status, mismatch.body, "VALIDATION_ERROR");
    expect(mismatch.status).toBe(400);

    const noKey = await queryAds(server.app, adQuery({ idempotencyKey: undefined }));
    expectErrorEnvelope(noKey.status, noKey.body, "VALIDATION_ERROR");
    expect(noKey.status).toBe(400);

    const headerOnly = await injectJson(server.app, "POST", "/v1/ads/query", {
      payload: adQuery({ idempotencyKey: undefined }),
      headers: authHeaders(ADS_KEY, { "idempotency-key": freshIdem("ads-header") }),
    });
    expect(headerOnly.status).toBe(200);
    await server.app.close();
  });

  it("forget replays idempotently (body key REQUIRED by the frozen contract)", async () => {
    const server = buildAdsServer();
    const record = makeRecord({ itemId: "ad-i3", recordedAt: 2_000 });
    await server.store.put(record);
    const payload = adForget({ kind: "record", recordId: record.recordId });
    const first = await forgetAds(server.app, payload);
    expect(first.status).toBe(200);
    const second = await forgetAds(server.app, payload);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(second.body).toEqual(first.body);
    // No body key → typed 400 (the frozen contract requires it).
    const missing = await forgetAds(server.app, adForget({ kind: "all" }, { idempotencyKey: undefined }));
    expectErrorEnvelope(missing.status, missing.body, "VALIDATION_ERROR");
    await server.app.close();
  });
});

describe("AD-003 /v1/ads auth + validation matrix", () => {
  it("401 without a bearer key", async () => {
    const server = buildAdsServer();
    const res = await injectJson(server.app, "POST", "/v1/ads/query", {
      payload: adQuery(),
      headers: { "content-type": "application/json" },
    });
    expectErrorEnvelope(res.status, res.body, "UNAUTHENTICATED");
    expect(res.status).toBe(401);
    await server.app.close();
  });

  it("403 INSUFFICIENT_SCOPE for a key without the ads scope", async () => {
    const server = buildAdsServer();
    const res = await queryAds(server.app, adQuery(), BETA);
    expectErrorEnvelope(res.status, res.body, "INSUFFICIENT_SCOPE");
    expect(res.status).toBe(403);
    await server.app.close();
  });

  it("403 TENANT_MISMATCH when the body tenant differs from the key's tenant", async () => {
    const server = buildAdsServer();
    const res = await queryAds(server.app, adQuery({ tenant: { tenantId: TENANT_B } }));
    expectErrorEnvelope(res.status, res.body, "TENANT_MISMATCH");
    expect(res.status).toBe(403);
    await server.app.close();
  });

  it("400 VALIDATION_ERROR for contract-invalid bodies (missing at / bad mode / missing queryId / bad filter limit)", async () => {
    const server = buildAdsServer();
    for (const overrides of [
      { at: undefined },
      { mode: "sometimes" },
      { queryId: undefined },
      { filters: { limit: 0 } },
      { filters: { limit: 1.5 } },
      { text: "" },
    ]) {
      const res = await queryAds(server.app, adQuery(overrides));
      expectErrorEnvelope(res.status, res.body, "VALIDATION_ERROR");
      expect(res.status).toBe(400);
    }
    await server.app.close();
  });

  it("400 VALIDATION_ERROR for contract-invalid forget bodies (missing target / missing idempotencyKey)", async () => {
    const server = buildAdsServer();
    const noTarget = await forgetAds(server.app, adForget({ kind: "record" })); // recordId missing
    expectErrorEnvelope(noTarget.status, noTarget.body, "VALIDATION_ERROR");
    const badTarget = await forgetAds(server.app, adForget({ kind: "warehouse" }));
    expectErrorEnvelope(badTarget.status, badTarget.body, "VALIDATION_ERROR");
    await server.app.close();
  });

  it("501 NOT_WIRED on a server without a mounted ads handler", async () => {
    const defaultServer = buildDefaultServer({ keys: adsKeys });
    const res = await injectJson(defaultServer, "POST", "/v1/ads/query", {
      payload: adQuery(),
      headers: authHeaders(ADS_KEY),
    });
    expectErrorEnvelope(res.status, res.body, "NOT_WIRED");
    expect(res.status).toBe(501);
    const forgetRes = await injectJson(defaultServer, "POST", "/v1/ads/forget", {
      payload: adForget({ kind: "all" }),
      headers: authHeaders(ADS_KEY),
    });
    expectErrorEnvelope(forgetRes.status, forgetRes.body, "NOT_WIRED");
    expect(forgetRes.status).toBe(501);
    await defaultServer.close();
  });
});
