/**
 * AD-005 — Ads view-model tests: the pure mapping from the FROZEN ad
 * contracts to the Ads section's reading order, plus the re-rank
 * composition through the SDK's frozen-semantics helpers.
 *
 * Laws under test:
 * - LAW 9: provenance origin classes for every lane member — remembered
 *   (observed-encounter memory), retrieved (memory seeded from supply),
 *   provider-supplied (available lane) — never merged, always labeled.
 * - LAW 8: `advertising: true` on every ad card; a kernel row that maps
 *   to no ad candidate renders as an ordinary recommendation (the
 *   ad/non-ad distinction).
 * - LAW 1: retention rows always carry the explicit basis.
 * - LAW 2: forget targets parse over the frozen vocabulary; the outcome
 *   view states terminality.
 * - LAWS 3/7: the re-rank plan gates windows at the caller clock and
 *   carries USER value only; the decision request composes ONE pipeline
 *   (greedy-v1, context by reference, the documented reward-term bridge).
 * - Re-rank order display: BEFORE keeps the lanes' own order; AFTER is
 *   the kernel's order VERBATIM — never re-sorted by the view.
 *
 * Fixtures are constructed through the contracts' own construction path
 * (`finalizeAdMemoryRecord`, schema `.parse`) — clearly fixture-class
 * test data, never production evidence (Gate Q).
 */
import { describe, expect, it } from "vitest";
import {
  AdForgetResultSchema,
  AdQueryResultSchema,
  DecisionResultSchema,
  finalizeAdMemoryRecord,
  type AdMemoryRecord,
} from "@reckon/contracts";
import {
  AD_ORIGIN_BADGES,
  adOriginForCandidate,
  adOriginForRecord,
  adQueryCardViews,
  adQueryRequestInput,
  adTitleOf,
  availableAdCardView,
  evidenceTrailRows,
  forgetActionFor,
  forgetOutcomeView,
  lineageRows,
  normalizeAdsQueryParams,
  parseAdForgetBody,
  permissionView,
  rememberedAdCardView,
  rerankView,
  retentionDetailRows,
  retentionSummary,
  rightsDetailRows,
  type AdCandidate,
  type AdsQueryFormParams,
  type AdsScope,
} from "../src/lib/ads-view.js";
import { adRerankDecisionRequest, buildAdRerankPlan } from "../src/lib/ads-rerank.js";

/* ------------------------------------------------------------------ *
 * Fixtures (fixture-class test data — Gate Q)
 * ------------------------------------------------------------------ */

const TENANT = { tenantId: "tenant-test" };
const SUBJECT = { kind: "user" as const, ref: "user-9" };
const AT = 10_000;

function memoryRecord(overrides: Record<string, unknown> = {}): AdMemoryRecord {
  return finalizeAdMemoryRecord({
    tenant: TENANT,
    subject: SUBJECT,
    ad: {
      itemId: "ad-hotel-accra",
      kind: "advertising",
      labels: ["travel"],
      attributes: { title: "Stay in Accra" },
    },
    realizations: [
      {
        realizationId: "real-hotel",
        itemId: "ad-hotel-accra",
        kind: "display",
        constraints: { formats: ["banner"], durationSeconds: 5 },
      },
    ],
    lineage: { source: "host-ad-server", advertiserRef: "adv-1", campaignRef: "camp-1", creativeRefs: [] },
    retention: { state: "active", basis: { kind: "explicit-user-consent", establishedAt: 1_000 } },
    permissions: { retain: "granted", present: "granted", history: [] },
    provenance: {
      kind: "observed-encounter",
      evidence: {
        outcomeEventId: "ev-1",
        evidenceClass: "production-observed",
        encounteredAt: 1_500,
        context: { contextId: "ctx-1" },
        surface: "home",
      },
    },
    rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
    recordedAt: 2_000,
    ...overrides,
  });
}

function rememberedCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateKind: "remembered",
    advertising: true,
    record: memoryRecord(),
    whyRetrieved: [{ kind: "query-match", detail: "hotel", score: 0.75 }],
    ...overrides,
  };
}

function availableCandidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    candidateKind: "available",
    advertising: true,
    ad: {
      itemId: "ad-channel-deal",
      kind: "advertising",
      labels: ["travel"],
      attributes: { headline: "Weekend deal" },
    },
    realizations: [],
    availability: { suppliedBy: "route-exchange", availableFrom: 0, availableUntil: 20_000 },
    rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
    whyRetrieved: [{ kind: "provider-supplied", detail: "route-exchange" }],
    userValue: { score: 0.7, reasons: ["planning a trip"] },
    ...overrides,
  };
}

function queryResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    queryId: "q-1",
    tenant: TENANT,
    mode: "both",
    at: AT,
    remembered: [rememberedCandidate()],
    available: [availableCandidate()],
    notes: [],
    ...overrides,
  };
}

function decisionResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decisionId: "dec-1",
    requestId: "req-1",
    tenant: TENANT,
    action: "QUEUE",
    selectedExperience: {
      experienceId: "exp-1",
      itemId: "ad-hotel-accra",
      realizationId: "real-hotel",
      format: { kind: "banner" },
    },
    alternatives: [
      {
        experienceId: "exp-2",
        itemId: "ad-channel-deal",
        score: 0.42,
        uncertainty: { confidence: 0.8 },
      },
      { experienceId: "exp-999-organic", score: 0.31 },
    ],
    policy: { policyId: "greedy-v1", version: "1" },
    reasons: [{ code: "queued-not-interrupted", message: "attention is partial; queue the candidate" }],
    at: AT,
    ...overrides,
  };
}

const SCOPE: AdsScope = { tenant: TENANT, subject: SUBJECT };

const FORM_PARAMS: AdsQueryFormParams = {
  text: undefined,
  mode: "both",
  labels: [],
  surfaces: [],
  encounteredFromMs: undefined,
  encounteredUntilMs: undefined,
  limit: undefined,
  atMs: undefined,
};

/* ------------------------------------------------------------------ *
 * §1 Law 9 — origin classes
 * ------------------------------------------------------------------ */

describe("ad provenance origin classes (law 9)", () => {
  it("an observed-encounter memory record is REMEMBERED", () => {
    expect(adOriginForRecord(memoryRecord())).toBe("remembered");
  });

  it("a memory record seeded from supply (provider-supplied provenance) is RETRIEVED", () => {
    const seeded = memoryRecord({
      provenance: {
        kind: "provider-supplied",
        availability: { suppliedBy: "host-channel", availableFrom: 0, availableUntil: 99_000 },
      },
    });
    expect(adOriginForRecord(seeded)).toBe("retrieved");
  });

  it("an available-lane candidate is PROVIDER-SUPPLIED, whatever its memory link", () => {
    const withLink = availableCandidate({ memoryRecordId: "admem-123" });
    const parsed = AdQueryResultSchema.parse(queryResult({ remembered: [], available: [withLink] }));
    expect(adOriginForCandidate(parsed.available[0] as AdCandidate)).toBe("provider-supplied");
  });

  it("a remembered-lane candidate's origin follows its record's provenance", () => {
    const parsed = AdQueryResultSchema.parse(queryResult({ available: [] }));
    expect(adOriginForCandidate(parsed.remembered[0] as AdCandidate)).toBe("remembered");
    const seeded = AdQueryResultSchema.parse(
      queryResult({
        available: [],
        remembered: [
          rememberedCandidate({
            record: memoryRecord({
              provenance: {
                kind: "provider-supplied",
                availability: { suppliedBy: "host-channel", availableFrom: 0, availableUntil: 99_000 },
              },
            }),
          }),
        ],
      }),
    );
    expect(adOriginForCandidate(seeded.remembered[0] as AdCandidate)).toBe("retrieved");
  });

  it("the three badges carry distinct labels and explanations (the always-rendered distinguisher)", () => {
    const labels = Object.values(AD_ORIGIN_BADGES).map((badge) => badge.label);
    expect(new Set(labels).size).toBe(3);
    for (const badge of Object.values(AD_ORIGIN_BADGES)) {
      expect(badge.detail.length).toBeGreaterThan(20);
    }
    expect(AD_ORIGIN_BADGES.remembered.label).toBe("Remembered");
    expect(AD_ORIGIN_BADGES.retrieved.label).toBe("Retained from supply");
    expect(AD_ORIGIN_BADGES["provider-supplied"].label).toBe("Provider-supplied");
  });
});

/* ------------------------------------------------------------------ *
 * §2 Card views — advertising literal (law 8) + lane fields
 * ------------------------------------------------------------------ */

describe("ad card views (laws 8, 9, 4, 7)", () => {
  const parsed = AdQueryResultSchema.parse(queryResult());

  it("every ad card carries the advertising literal true (law 8)", () => {
    const remembered = rememberedAdCardView(parsed.remembered[0]);
    const available = availableAdCardView(parsed.available[0]);
    expect(remembered.advertising).toBe(true);
    expect(available.advertising).toBe(true);
  });

  it("a remembered card shows the encounter evidence trail and links to the record detail", () => {
    const card = rememberedAdCardView(parsed.remembered[0]);
    expect(card.origin).toBe("remembered");
    expect(card.encounter).not.toBeNull();
    expect(card.encounter?.outcomeEventId).toBe("ev-1");
    expect(card.encounter?.evidenceClass).toBe("production-observed");
    expect(card.encounter?.contextId).toBe("ctx-1");
    expect(card.encounter?.surface).toBe("home");
    expect(card.detailHref).toBe(`/ads/records/${card.recordId}`);
    expect(card.retention).not.toBeNull();
  });

  it("an available card shows the availability declaration, never an encounter, and keeps rights verbatim", () => {
    const card = availableAdCardView(parsed.available[0]);
    expect(card.origin).toBe("provider-supplied");
    expect(card.encounter).toBeNull();
    expect(card.retention).toBeNull();
    expect(card.availability?.suppliedBy).toBe("route-exchange");
    expect(card.rights.redistributionPermitted).toBe(false);
  });

  it("the two lanes map to SEPARATE arrays (law 9 — never merged)", () => {
    const views = adQueryCardViews(parsed);
    expect(views.remembered).toHaveLength(1);
    expect(views.available).toHaveLength(1);
    expect(views.remembered[0]?.origin).toBe("remembered");
    expect(views.available[0]?.origin).toBe("provider-supplied");
  });

  it("value separation (law 7): user value and commercial value are separate fields", () => {
    const withBoth = availableCandidate({
      commercialValue: { metrics: { ecpm: 2.5 }, declaredBy: "advertiser" },
    });
    const both = AdQueryResultSchema.parse(queryResult({ remembered: [], available: [withBoth] }));
    const card = availableAdCardView(both.available[0]);
    expect(card.values.userValue).toMatchObject({ score: 0.7, reasons: ["planning a trip"] });
    expect(card.values.commercialValue).toMatchObject({ metricsLabel: "ecpm=2.5", declaredBy: "advertiser" });
    const remembered = rememberedAdCardView(parsed.remembered[0]);
    expect(remembered.values.userValue).toBeNull();
    expect(remembered.values.commercialValue).toBeNull();
  });

  it("the title prefers the ad's own title attribute and falls back to the itemId", () => {
    expect(adTitleOf({ itemId: "ad-x", attributes: { title: "  A title  " } })).toBe("A title");
    expect(adTitleOf({ itemId: "ad-x", attributes: {} })).toBe("ad-x");
    expect(adTitleOf({ itemId: "ad-x", attributes: { title: 42 } })).toBe("ad-x");
  });
});

/* ------------------------------------------------------------------ *
 * §3 Detail rows — evidence trail, retention basis (law 1), rights (law 4)
 * ------------------------------------------------------------------ */

describe("ad detail fact rows", () => {
  it("the evidence trail states the observed encounter, its outcome event and context BY REFERENCE", () => {
    const rows = evidenceTrailRows(memoryRecord());
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("provenance class")).toContain("observed-encounter");
    expect(byLabel.get("outcome event")).toBe("ev-1");
    expect(byLabel.get("encounter context")).toBe("by reference: ctx-1");
  });

  it("a supply-seeded record's evidence trail states the declaration instead", () => {
    const seeded = memoryRecord({
      provenance: {
        kind: "provider-supplied",
        availability: { suppliedBy: "host-channel", availableFrom: 0, availableUntil: 99_000 },
      },
    });
    const rows = evidenceTrailRows(seeded);
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("provenance class")).toContain("provider-supplied");
    expect(byLabel.get("declared by")).toBe("host-channel");
  });

  it("retention rows ALWAYS carry the basis (law 1) and expiry when declared", () => {
    const rows = retentionDetailRows(
      memoryRecord({
        retention: {
          state: "active",
          basis: { kind: "host-retention-policy", establishedAt: 1_000, description: "90-day window" },
          expiresAt: 50_000,
        },
      }),
    );
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("retention basis")).toContain("host-retention-policy");
    expect(byLabel.get("retention basis")).toContain("90-day window");
    expect(byLabel.get("expires at")).toBeDefined();
  });

  it("the retention summary keeps state, basis kind and expiry together", () => {
    const summary = retentionSummary(
      memoryRecord({
        retention: { state: "active", basis: { kind: "legal-obligation", establishedAt: 1 }, expiresAt: 99 },
      }).retention,
    );
    expect(summary).toMatchObject({ state: "active", basisKind: "legal-obligation" });
    expect(summary.expiryLabel).not.toBeNull();
  });

  it("rights rows state redistribution-not-permitted as the DEFAULT (law 4)", () => {
    const rows = rightsDetailRows({ redistributionPermitted: false, gates: ["rights-gate-1"], usageRestrictions: [] });
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("redistribution permitted")).toContain("no");
    expect(byLabel.get("rights gates")).toBe("rights-gate-1");
  });

  it("lineage rows keep host refs opaque (advertiser, campaign, creative chain)", () => {
    const rows = lineageRows(memoryRecord());
    const byLabel = new Map(rows.map((row) => [row.label, row.value]));
    expect(byLabel.get("advertiser ref")).toBe("adv-1");
    expect(byLabel.get("lineage source")).toBe("host-ad-server");
    expect(byLabel.get("record id")).toMatch(/^admem-/);
  });
});

/* ------------------------------------------------------------------ *
 * §4 Permission / consent rows
 * ------------------------------------------------------------------ */

describe("permission view (the consent surface's data)", () => {
  it("grants map with their meanings; history maps append-only transitions", () => {
    const record = memoryRecord({
      permissions: {
        retain: "granted",
        present: "revoked",
        history: [
          {
            capability: "present",
            from: "granted",
            to: "revoked",
            at: 5_000,
            reason: "user asked to stop seeing this ad",
          },
        ],
      },
    });
    const view = permissionView(record);
    expect(view.retain).toMatchObject({ capability: "retain", granted: true });
    expect(view.present).toMatchObject({ capability: "present", granted: false });
    expect(view.retain.meaning).toContain("hold this ad");
    expect(view.present.meaning).toContain("re-show");
    expect(view.history).toHaveLength(1);
    expect(view.history[0]).toMatchObject({
      capability: "present",
      from: "granted",
      to: "revoked",
      reason: "user asked to stop seeing this ad",
    });
  });

  it("a record written with revoked retain shows the revoke honestly", () => {
    const view = permissionView(
      memoryRecord({ permissions: { retain: "revoked", present: "granted", history: [] } }),
    );
    expect(view.retain.granted).toBe(false);
    expect(view.present.granted).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * §5 Query param normalization + request plumbing
 * ------------------------------------------------------------------ */

describe("normalizeAdsQueryParams + adQueryRequestInput (the GET-form plumbing)", () => {
  it("mode falls back to both; text is trimmed and bounded; lists split and cap", () => {
    const params = normalizeAdsQueryParams({
      q: "  what laptop ads have I seen  ",
      mode: "nonsense",
      labels: "travel, electronics ,",
      surfaces: "home",
      from: "1000",
      until: "abc",
      limit: "20",
    });
    expect(params.text).toBe("what laptop ads have I seen");
    expect(params.mode).toBe("both");
    expect(params.labels).toEqual(["travel", "electronics"]);
    expect(params.surfaces).toEqual(["home"]);
    expect(params.encounteredFromMs).toBe(1000);
    expect(params.encounteredUntilMs).toBeUndefined();
    expect(params.limit).toBe(20);
  });

  it("valid modes pass through; array params take the first entry; the replay clock parses", () => {
    const params = normalizeAdsQueryParams({ mode: ["remembered", "both"], at: "5000" });
    expect(params.mode).toBe("remembered");
    expect(params.atMs).toBe(5000);
  });

  it("the request composes scope, mode, text and ONLY the declared filters", () => {
    const withFilters = adQueryRequestInput(
      { ...FORM_PARAMS, text: "hotel", mode: "remembered", labels: ["travel"], limit: 5 },
      SCOPE,
      { queryId: "q-42" },
      AT,
    );
    expect(withFilters).toMatchObject({
      queryId: "q-42",
      tenant: TENANT,
      subject: SUBJECT,
      mode: "remembered",
      text: "hotel",
      at: AT,
    });
    expect(withFilters.filters).toMatchObject({ labels: ["travel"], limit: 5 });

    const bare = adQueryRequestInput(FORM_PARAMS, SCOPE, { queryId: "q-43" }, AT);
    expect(bare.filters).toBeUndefined();
    expect("text" in bare).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * §6 Forget target parsing + outcome (law 2)
 * ------------------------------------------------------------------ */

describe("forget controls (law 2 — terminal)", () => {
  it("the frozen target vocabulary parses: record, item, advertiser, all", () => {
    expect(parseAdForgetBody({ kind: "record", recordId: "admem-1" })).toMatchObject({
      ok: true,
      target: { kind: "record", recordId: "admem-1" },
    });
    expect(parseAdForgetBody({ kind: "item", itemId: "ad-x" })).toMatchObject({
      ok: true,
      target: { kind: "item", itemId: "ad-x" },
    });
    expect(parseAdForgetBody({ kind: "advertiser", advertiserRef: "adv-42" })).toMatchObject({
      ok: true,
      target: { kind: "advertiser", advertiserRef: "adv-42" },
    });
    expect(parseAdForgetBody({ kind: "all" })).toMatchObject({ ok: true, target: { kind: "all" } });
    expect(parseAdForgetBody({ kind: "all", reason: "  spring cleaning  " })).toMatchObject({
      ok: true,
      reason: "spring cleaning",
    });
  });

  it("malformed targets reject honestly (non-objects, bad kinds, bad ids)", () => {
    expect(parseAdForgetBody(null).ok).toBe(false);
    expect(parseAdForgetBody("all").ok).toBe(false);
    expect(parseAdForgetBody({ kind: "campaign" }).ok).toBe(false);
    expect(parseAdForgetBody({ kind: "record", recordId: "not a valid id!" }).ok).toBe(false);
    expect(parseAdForgetBody({ kind: "item" }).ok).toBe(false);
  });

  it("the mode-machine action descriptor names each target honestly", () => {
    expect(forgetActionFor({ kind: "record", recordId: "admem-1" })).toMatchObject({
      id: "forget-ad",
      context: "record admem-1",
    });
    expect(forgetActionFor({ kind: "all" }).label).toContain("every remembered ad");
  });

  it("the forget outcome view states terminality and the affected ids", () => {
    const result = AdForgetResultSchema.parse({
      requestId: "fr-1",
      tenant: TENANT,
      forgottenCount: 2,
      forgottenRecordIds: ["admem-1", "admem-2"],
      at: AT,
    });
    const view = forgetOutcomeView(result);
    expect(view.title).toBe("Forgot 2 records");
    expect(view.detail).toContain("never be retrieved");
    expect(view.forgottenRecordIds).toEqual(["admem-1", "admem-2"]);
    const zero = forgetOutcomeView(
      AdForgetResultSchema.parse({ requestId: "fr-2", tenant: TENANT, forgottenCount: 0, at: AT }),
    );
    expect(zero.title).toBe("Nothing was forgotten");
    expect(zero.detail).toContain("idempotent");
  });
});

/* ------------------------------------------------------------------ *
 * §7 Re-rank composition (the kernel path — no second ranking)
 * ------------------------------------------------------------------ */

describe("buildAdRerankPlan (the SDK's frozen-semantics mapping)", () => {
  it("gates both lanes at the caller clock and maps them into ONE candidate set with lane sources", () => {
    const parsed = AdQueryResultSchema.parse(queryResult());
    const outcome = buildAdRerankPlan({ queryResult: parsed, at: AT, setId: "cs-1" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const sources = outcome.plan.candidateSet.candidates.map((candidate) => candidate.source);
    expect(sources).toEqual(["reckon.ad-memory.remembered", "reckon.ad-availability.current"]);
    expect(outcome.plan.candidateSet.candidates[0]).toMatchObject({ itemId: "ad-hotel-accra", rankHint: 1 });
    expect(outcome.plan.candidateSet.candidates[1]).toMatchObject({ itemId: "ad-channel-deal", rankHint: 2 });
    // scoreHint is the best whyRetrieved score — a HINT, never a decision.
    expect(outcome.plan.candidateSet.candidates[0]?.scoreHint).toBeCloseTo(0.75, 5);
    // the available fixture's provider-supplied reason carries no score —
    // absent evidence stays absent (never invented).
    expect(outcome.plan.candidateSet.candidates[1]?.scoreHint).toBeUndefined();
  });

  it("closed-window ads are excluded with honest notes (law 3)", () => {
    const closed = AdQueryResultSchema.parse(
      queryResult({
        available: [availableCandidate({ availability: { suppliedBy: "x", availableFrom: 0, availableUntil: 5_000 } })],
      }),
    );
    const outcome = buildAdRerankPlan({ queryResult: closed, at: AT, setId: "cs-2" });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.plan.candidateSet.candidates.map((c) => c.itemId)).toEqual(["ad-hotel-accra"]);
    expect(outcome.plan.notes.join(" ")).toContain("excluded");
  });

  it("an empty result yields the honest no-candidates outcome (never fabricated)", () => {
    const empty = AdQueryResultSchema.parse(queryResult({ remembered: [], available: [] }));
    const outcome = buildAdRerankPlan({ queryResult: empty, at: AT, setId: "cs-3" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.notes.length).toBeGreaterThan(0);
  });
});

describe("adRerankDecisionRequest (ONE pipeline, context by reference, law 7)", () => {
  const parsed = AdQueryResultSchema.parse(queryResult());
  const plan = buildAdRerankPlan({ queryResult: parsed, at: AT, setId: "cs-1" });
  if (!plan.ok) throw new Error("fixture plan must build");

  it("composes the documented request: greedy-v1, balanced, context BY REFERENCE, idempotency", () => {
    const request = adRerankDecisionRequest({
      plan: plan.plan,
      scope: SCOPE,
      ids: { requestId: "req-1", idempotencyKey: "idem-1", contextId: "ctx-42", rewardId: "reward-1" },
      at: AT,
      experiences: [],
    });
    expect(request).toMatchObject({
      requestId: "req-1",
      idempotencyKey: "idem-1",
      policySelector: { policyId: "greedy-v1", version: "1" },
      at: AT,
    });
    expect(request.objective).toMatchObject({ objectiveId: "obj-ad-compare", kind: "shop" });
    expect(request.attentionPolicy).toMatchObject({ policyId: "att-ad-compare", style: "balanced" });
    // Law 5: context is a bare reference — no raw context fields exist.
    expect(request.context).toEqual({ contextId: "ctx-42" });
    expect(request.candidates).toBe(plan.plan.candidateSet);
    expect(request.reward).toBeUndefined();
  });

  it("declared user value rides the documented reward-term bridge (keyed by resolved experience ids)", () => {
    const request = adRerankDecisionRequest({
      plan: plan.plan,
      scope: SCOPE,
      ids: { requestId: "req-2", idempotencyKey: "idem-2", contextId: "ctx-42", rewardId: "reward-1" },
      at: AT,
      experiences: [{ experienceId: "exp-deal", itemId: "ad-channel-deal" }],
    });
    expect(request.reward).toBeDefined();
    expect(request.reward?.terms).toHaveLength(1);
    expect(request.reward?.terms[0]).toMatchObject({ termId: "reckon.ad.user-value", kind: "satisfaction-proxy" });
    expect(request.reward?.terms[0]?.params).toMatchObject({ values: { "exp-deal": 0.7 } });
  });
});

/* ------------------------------------------------------------------ *
 * §8 Re-rank rows — BEFORE/AFTER order display
 * ------------------------------------------------------------------ */

describe("rerankView (before/after — the kernel's order VERBATIM)", () => {
  const parsed = AdQueryResultSchema.parse(queryResult());
  const decision = DecisionResultSchema.parse(decisionResult());

  it("BEFORE keeps the lanes' own order (remembered first) with positional hints", () => {
    const view = rerankView({ queryResult: parsed, decision, experiences: [] });
    expect(view.before.map((row) => row.itemId)).toEqual(["ad-hotel-accra", "ad-channel-deal"]);
    expect(view.before.map((row) => row.rankHint)).toEqual([1, 2]);
    expect(view.before[0]).toMatchObject({ advertising: true, origin: "remembered", lane: "remembered" });
    expect(view.before[1]).toMatchObject({ advertising: true, origin: "provider-supplied", lane: "available" });
    expect(view.before[0]?.scoreHint).toBeCloseTo(0.75, 5);
    expect(view.before[0]?.topReason).toContain("query-match");
  });

  it("AFTER is the kernel's alternatives order VERBATIM — the view never re-sorts", () => {
    const view = rerankView({ queryResult: parsed, decision, experiences: [] });
    expect(view.after.map((row) => row.experienceId)).toEqual(["exp-2", "exp-999-organic"]);
    expect(view.after[0]?.score).toBe(0.42);
    // The kernel returned exp-2 (score 0.42) BEFORE exp-999 (score 0.31) —
    // but the assertion is ORDER PRESERVATION, not score sorting: whatever
    // the kernel's array order is, the view keeps it.
    const kernelOrder = decision.alternatives.map((alt) => alt.experienceId);
    expect(view.after.map((row) => row.experienceId)).toEqual(kernelOrder);
  });

  it("the selected row is marked, carries the action, and maps to its ad", () => {
    const view = rerankView({ queryResult: parsed, decision, experiences: [] });
    expect(view.selected).not.toBeNull();
    expect(view.selected?.selected).toBe(true);
    expect(view.selected?.itemId).toBe("ad-hotel-accra");
    expect(view.selected?.advertising).toBe(true);
    expect(view.selected?.origin).toBe("remembered");
    expect(view.selected?.action).toBe("QUEUE");
    expect(view.action).toBe("QUEUE");
    expect(view.actionMeaning).toContain("queue");
  });

  it("an alternative mapping to no ad candidate is an ORDINARY RECOMMENDATION (law 8 distinction)", () => {
    const view = rerankView({ queryResult: parsed, decision, experiences: [] });
    const organic = view.after.find((row) => row.experienceId === "exp-999-organic");
    expect(organic?.advertising).toBe(false);
    expect(organic?.origin).toBeNull();
    expect(organic?.itemId).toBeNull();
  });

  it("mapped alternatives carry the ad marks and the kernel's why (reason, uncertainty, exclusions)", () => {
    const withReason = DecisionResultSchema.parse(
      decisionResult({
        alternatives: [
          { experienceId: "exp-2", itemId: "ad-channel-deal", score: 0.42, reason: "lower declared user value", excludedBy: "freq-cap", uncertainty: { confidence: 0.8 } },
        ],
      }),
    );
    // the resolved-experience mapping (the loader passes the resolved ad
    // experiences; exp-2 resolves to the available-lane ad).
    const experiences = [{ experienceId: "exp-2", itemId: "ad-channel-deal" }];
    const view = rerankView({ queryResult: parsed, decision: withReason, experiences });
    const row = view.after[0];
    expect(row?.advertising).toBe(true);
    expect(row?.origin).toBe("provider-supplied");
    expect(row?.reason).toBe("lower declared user value");
    expect(row?.excludedBy).toBe("freq-cap");
    expect(row?.uncertainty).toContain("confidence 0.800");
  });

  it("the decision's reasons and schedule delta surface for the defer/suppress WHY display", () => {
    const view = rerankView({ queryResult: parsed, decision, experiences: [] });
    expect(view.reasons).toEqual([
      { code: "queued-not-interrupted", message: "attention is partial; queue the candidate" },
    ]);
    expect(view.actionMeaning).toContain("Defer");
  });
});
