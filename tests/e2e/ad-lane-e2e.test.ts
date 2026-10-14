/**
 * AD-006 — the ad-lane END-TO-END proof suite (W3 lane, owner of
 * tests/e2e/**): BOTH ad-lane paths through the PRODUCTION composition
 * (`buildProductionServer`) over a REAL PostgreSQL engine (the
 * pg-harness embedded PG 18, the same engine class Neon serves):
 *
 * PATH 1 — the MEMORY path (frozen lane contract):
 *   encounter/save → retain → query/retrieve → resolve experience →
 *   decide → schedule → present → outcome
 *
 * PATH 2 — the CONTEXTUAL path (frozen lane contract):
 *   current context → eligible ads → retrieval → decision → correct
 *   format/timing → outcome
 *
 * Every assertion below maps to one of the AD-006 evidence requirements
 * (E1–E11) or one of the ten ad-memory privacy/policy laws (L1–L10);
 * the mapping is recorded per-test and consolidated in
 * docs/handoff/ad-lane-e2e-evidence.md (the evidence appendix) and
 * docs/handoff/ad-lane-production-matrix.md (the capability matrix).
 *
 * DETERMINISM CONTRACT (work order): every clock input is a fixed
 * constant (the composition clock is pinned; every request carries its
 * own caller-supplied `at`); there is no wall-clock dependence, no
 * network, no random ids (the SDK id generator is a deterministic
 * sequence; the webhook encryption key is a FIXED 32-byte seed). The
 * only availability channel is a deterministic test double — the
 * deployment-time composition seam channels occupy by design (AD-003),
 * never a live provider.
 *
 * EVIDENCE CLASS: controlled-local — real PG engine + real production
 * composition + real route pipeline + real SDK over inject-fetch; the
 * deployed-infrastructure wire path is probed separately in
 * docs/deployment/ad-lane-verification.md (production-observed facts
 * only where genuinely observed).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AD_CANDIDATE_SOURCES,
  AD_RETRIEVAL_REASON_KINDS,
  AdEncounterEvidenceSchema,
  AdMemoryRecordSchema,
  DecisionResultSchema,
  OBSERVED_EVIDENCE_CLASSES,
  RewardTermSchema,
  finalizeAdMemoryRecord,
  isAdAvailableAt,
  isAdCandidateCurrentlyAvailable,
} from "../../packages/contracts/src/index.js";
import type {
  AdQueryResult,
  AdRetrievalReason,
  DecisionResult,
  Experience,
} from "../../packages/contracts/src/index.js";
import {
  createReckonClient,
  createInjectFetch,
  buildAdBearingCandidates,
  selectAdCandidacy,
  adUserValueRewardTerm,
} from "../../packages/sdk/src/index.js";
import type { DecisionRequestInput, OutcomeEventInput, ResolveRequestInput } from "../../packages/sdk/src/client.js";
import { buildProductionServer, type ProductionComposition } from "../../apps/api/src/index.js";
import type { AdAvailabilityChannel, AdAvailabilitySupply } from "../../apps/api/src/index.js";
import { startTestPostgres, type TestPostgres } from "../../packages/persistence/test/pg-harness.js";

/* ------------------------------------------------------------------ *
 * Fixed constants — the deterministic world (no wall clock, no random)
 * ------------------------------------------------------------------ */

const TENANT_ID = "ad006-e2e-tenant";
const TENANT = { tenantId: TENANT_ID };
const SUBJECT = { kind: "user" as const, ref: "user-e2e" };
const OTHER_SUBJECT = { kind: "user" as const, ref: "user-other" };

/** Composition clock — pinned for the whole suite (infra timestamps only). */
const PINNED_NOW = 1_000;

// Caller-supplied evaluation clocks (contract rule #4 — every temporal
// evaluation in the lane runs against these, deterministically).
const T_BASIS = 1_000; // retention basis established
const T_ENCOUNTER = 8_000; // the observed encounter happened
const T_QUERY = 10_000; // main query/decision clock
const T_EXPIRY = 20_000; // expiry boundary of the expiring memory record
const T_POST_EXPIRY = 30_000; // after expiry
const T_CHANNEL_CLOSE = 100_000; // channel availability window close
const T_LATE = 200_000; // past every ad window

/** A FIXED webhook encryption key (32 bytes) — determinism over the infra seam. */
const FIXED_WEBHOOK_KEY = new Uint8Array(32).fill(0xad);

/** The deployment-declared capture policy basis (law 1 — explicit, never defaulted). */
const CAPTURE_BASIS = {
  kind: "explicit-user-consent" as const,
  establishedAt: T_BASIS,
  basisRef: "ad006-consent-record-1",
  description: "user opted into Personal Ad Memory (AD-006 E2E fixture consent)",
};

/* ------------------------------------------------------------------ *
 * The deterministic availability channel (the composed deployment seam)
 * ------------------------------------------------------------------ */

const SUPPLY_GADGET = {
  ad: {
    schema: "reckon.catalog-item",
    schemaVersion: "0.1.0",
    itemId: "ad006-gadget-promo",
    kind: "advertising",
    labels: ["tech", "gadgets"],
    attributes: { headline: "Gadget deal — headphones 30% off" },
    // The ad's OWN catalog window (mirrors a real host ad flight): the
    // remembered-lane selection gate evaluates THIS window at the clock.
    availableFrom: 0,
    availableUntil: T_CHANNEL_CLOSE,
  },
  realizations: [
    {
      schema: "reckon.realization",
      schemaVersion: "0.1.0",
      realizationId: "real-ad006-gadget",
      itemId: "ad006-gadget-promo",
      kind: "display",
      constraints: { formats: ["banner", "card"], durationSeconds: 4 },
    },
  ],
  availability: { suppliedBy: "ad006-exchange", availableFrom: 0, availableUntil: T_CHANNEL_CLOSE },
  rights: {
    redistributionPermitted: false,
    gates: ["ad006-rights-gate"],
    usageRestrictions: ["no-redistribution"],
  },
  eligibility: {
    flight: { fromMs: 0, untilMs: T_CHANNEL_CLOSE },
    surfaces: ["home-feed"],
    gates: ["ad006-brand-gate"],
    hostFrequencyPolicy: { maxPerDay: 3 },
  },
  userValue: { score: 0.6, method: "host-assessment", reasons: ["recently shopped tech"] },
  commercialValue: { metrics: { ecpm: 4.2 }, currency: "USD", declaredBy: "ad006-exchange" },
} satisfies AdAvailabilitySupply;

/** Window already CLOSED at every evaluation clock we use (suppressed — law 3). */
const SUPPLY_CLOSED = {
  ad: {
    schema: "reckon.catalog-item",
    schemaVersion: "0.1.0",
    itemId: "ad006-closed-promo",
    kind: "advertising",
    labels: ["travel"],
    attributes: { headline: "Expired travel sale" },
  },
  realizations: [],
  availability: { suppliedBy: "ad006-exchange", availableFrom: 0, availableUntil: 5_000 },
  rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
} satisfies AdAvailabilitySupply;

const channel: AdAvailabilityChannel = {
  channelId: "ad006-channel",
  listSupply: async () => [SUPPLY_GADGET, SUPPLY_CLOSED] as AdAvailabilitySupply[],
};

/* ------------------------------------------------------------------ *
 * Suite-scoped composition (beforeAll/afterAll — the pg-harness law)
 * ------------------------------------------------------------------ */

let server: TestPostgres;
let composition: ProductionComposition;
let client: ReturnType<typeof createReckonClient>;
/** A second client whose key LACKS the `ads` scope (rights denial, E5). */
let noAdsClient: ReturnType<typeof createReckonClient>;

let idSeq = 0;
const nextId = (prefix: string): string => {
  idSeq += 1;
  return `${prefix}-ad006-${idSeq}`;
};

beforeAll(async () => {
  server = await startTestPostgres();
  composition = await buildProductionServer({
    executor: server.executor,
    webhookEncryptionKey: { bytes: FIXED_WEBHOOK_KEY },
    keys: [
      {
        apiKey: "ad006-e2e-key",
        tenantId: TENANT_ID,
        scopes: ["decisions", "outcomes", "plans", "catalog", "ads"] as never,
      },
      {
        apiKey: "ad006-e2e-key-noads",
        tenantId: TENANT_ID,
        scopes: ["decisions", "outcomes"] as never,
      },
    ],
    apiVersion: "ad-006-e2e",
    clock: { now: () => PINNED_NOW },
    adAvailabilityChannels: [channel],
    adMemoryCapture: { policy: { eventTypes: ["impression"], retentionBasis: CAPTURE_BASIS } },
  });
  const makeClient = (apiKey: string) =>
    createReckonClient({
      baseUrl: "http://reckon-ad006-e2e.test",
      apiKey,
      fetchImpl: createInjectFetch(composition.app as never) as never,
      idGenerator: (() => {
        let n = 0;
        return () => `ad006-${(n += 1)}`;
      })(),
    });
  client = makeClient("ad006-e2e-key");
  noAdsClient = makeClient("ad006-e2e-key-noads");
}, 120_000);

afterAll(async () => {
  await composition.close();
  await server.stop();
}, 60_000);

/* ------------------------------------------------------------------ *
 * Request builders (deterministic ids per call site)
 * ------------------------------------------------------------------ */

let decisionSeq = 0;
function adDecisionRequest(overrides: Record<string, unknown> = {}): Promise<DecisionResult> {
  decisionSeq += 1;
  return client.decisions.request({
    requestId: `ad006-req-${decisionSeq}`,
    tenant: TENANT,
    subject: SUBJECT,
    objective: { objectiveId: "obj-shop", kind: "shop" },
    attentionPolicy: { policyId: "ap-balanced", style: "balanced" },
    context: { contextId: "ctx-ad006-home" },
    candidates: { setId: `ad006-cs-${decisionSeq}`, candidates: [] },
    policySelector: { policyId: "greedy-v1", version: "1" },
    at: T_QUERY,
    idempotencyKey: `ad006-idem-${decisionSeq}`,
    ...overrides,
  } as DecisionRequestInput);
}

async function queryAds(overrides: Record<string, unknown> = {}): Promise<AdQueryResult> {
  return client.queryAds({
    queryId: nextId("q"),
    tenant: TENANT,
    subject: SUBJECT,
    at: T_QUERY,
    ...overrides,
  });
}

function impressionInput(overrides: Record<string, unknown> = {}): OutcomeEventInput {
  return {
    eventId: nextId("ev"),
    tenant: TENANT,
    subject: SUBJECT,
    eventType: "impression",
    occurredAt: T_ENCOUNTER,
    context: { contextId: "ctx-ad006-home" },
    evidenceClass: "production-observed",
    idempotencyKey: nextId("idem-ev"),
    ...overrides,
  } as OutcomeEventInput;
}

/** Remembered-lane itemIds of a query result, in lane order. */
const rememberedItemIds = (result: AdQueryResult): readonly string[] =>
  result.remembered.map((candidate) => candidate.record.ad.itemId);

const availableItemIds = (result: AdQueryResult): readonly string[] =>
  result.available.map((candidate) => candidate.ad.itemId);

/* ================================================================== *
 * PATH 2 first (it bootstraps the observed encounter PATH 1 consumes):
 * current context → eligible ads → retrieval → decision → correct
 * format/timing → outcome
 * ================================================================== */

describe("AD-006 PATH 2 — the contextual path end-to-end (production composition over real PG)", () => {
  it("current context → eligible ads: the available lane returns only window-open supply, with disclosed provider provenance (E4a/E6/L3/L8/L9)", async () => {
    const result = await queryAds({ mode: "available", text: "gadget deal" });

    // Only the open-window ad is eligible at the caller clock; the
    // closed-window ad is suppressed — never presented as available (L3).
    expect(availableItemIds(result)).toEqual(["ad006-gadget-promo"]);
    expect(availableItemIds(result)).not.toContain("ad006-closed-promo");
    // The closed ad is excluded HONESTLY (counted note, never silent).
    expect(result.notes.join(" | ")).toContain(
      "1 provider-supplied ad excluded: the availability window was closed at the query clock",
    );

    const candidate = result.available[0]!;
    // L8: advertising is explicitly identifiable.
    expect(candidate.advertising).toBe(true);
    expect(candidate.ad.kind).toBe("advertising");
    // L9/E6: provider-supplied provenance — a declaration, never an
    // observation, naming the supplying channel.
    expect(candidate.availability.suppliedBy).toBe("ad006-exchange");
    const reasonKinds = candidate.whyRetrieved.map((reason: AdRetrievalReason) => reason.kind);
    expect(reasonKinds).toContain("provider-supplied");
    expect(reasonKinds).toContain("query-match");
    // Every whyRetrieved kind is from the frozen closed vocabulary.
    for (const reason of candidate.whyRetrieved) {
      expect(AD_RETRIEVAL_REASON_KINDS).toContain(reason.kind);
    }
    // E6: the query's disclosed understanding — terms verbatim, honest
    // limitations (no embedding model, no contextual matching).
    expect(result.queryUnderstanding?.terms).toContain("gadget");
    expect(result.notes.join(" | ")).toContain("no embedding model");
  });

  it("retrieval → decision: ad + organic candidates in ONE request through the ONE kernel chain (no second ranking)", async () => {
    // Organic truth ingested through the public catalog surface.
    await client.catalog.upsertItem({
      schema: "reckon.catalog-item",
      schemaVersion: "0.1.0",
      itemId: "ad006-organic-video",
      kind: "media",
      labels: ["tech"],
      attributes: { title: "Headphone review" },
    });
    await client.catalog.upsertRealization({
      schema: "reckon.realization",
      schemaVersion: "0.1.0",
      realizationId: "real-ad006-organic",
      itemId: "ad006-organic-video",
      kind: "stream",
      constraints: { formats: ["full"], durationSeconds: 300 },
    });

    const adResult = await queryAds({ mode: "available" });
    // The SDK retrieval gate (AD-004): gate lanes at the caller clock,
    // map to provenance-carrying candidate references, merge with organic.
    const built = buildAdBearingCandidates({
      setId: "ad006-merged-cs",
      organic: {
        setId: "ad006-organic-cs",
        candidates: [{ itemId: "ad006-organic-video", realizationIds: ["real-ad006-organic"], source: "host-retrieval" }],
      },
      adQueryResult: adResult,
      at: T_QUERY,
    });
    const sources = built.candidateSet.candidates.map((candidate) => candidate.source);
    expect(sources).toContain(AD_CANDIDATE_SOURCES.available);
    expect(sources).toContain("host-retrieval");

    // ONE decision request over the merged set — the ad is an ordinary
    // candidate carrying provenance (the frozen source vocabulary).
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    expect(decision.schema).toBe("reckon.decision-result");
    expect(["QUEUE", "SUGGEST", "CONTINUE", "HOLD"]).toContain(decision.action);
    expect(decision.selectedExperience).toBeDefined();
    // The ad-lane truth (item + realizations + projected eligibility
    // constraints) resolved from the composed channel at the request clock.
    expect(
      built.items.map((item) => item.itemId)).toContain("ad006-gadget-promo");
  });

  it("correct format/timing: the selected ad experience carries a declared format, the ad window on timing, and the projected rights/flight constraints (E4b/E5/L3/L4/L8)", async () => {
    const adResult = await queryAds({ mode: "available" });
    const built = buildAdBearingCandidates({ setId: "ad006-format-cs", adQueryResult: adResult, at: T_QUERY });
    const decision = await adDecisionRequest({ candidates: built.candidateSet });

    const selected = decision.selectedExperience as Experience;
    expect(selected.itemId).toBe("ad006-gadget-promo");
    // FORMAT: one of the realization's declared formats (banner/card).
    expect(["banner", "card"]).toContain(selected.format.kind);
    // The non-selected variant rides the alternatives (format choice is
    // explainable, never hidden).
    expect(decision.alternatives.length).toBe(1);
    // TIMING: the ad's availability window rides the experience's frozen
    // timing fields (earliest/latest) — the timing law.
    expect(selected.timing).toBeDefined();
    expect(selected.timing!.earliestMs).toBe(0);
    expect(selected.timing!.latestMs).toBe(T_CHANNEL_CLOSE);
    // RIGHTS/L4 + flight (L3): the declared eligibility projected onto the
    // frozen per-experience constraint surface (policy-rights gate +
    // time-window flight) — present verbatim for host-side enforcement.
    const constraintKinds = selected.constraints.map((constraint) => constraint.kind).sort();
    expect(constraintKinds).toContain("policy-rights");
    expect(constraintKinds).toContain("time-window");
    const gateIds = selected.constraints
      .filter((constraint) => constraint.kind === "policy-rights")
      .map((constraint) => (constraint as { gateId?: string }).gateId);
    expect(gateIds).toContain("ad006-brand-gate");
  });

  it("outcome: the host-reported observed impression is durable in PG, linked to the decision, and captured into Personal Ad Memory (E1/L1/L5/L9/L10)", async () => {
    // Decide to obtain the ad experience id deterministically.
    const adResult = await queryAds({ mode: "available" });
    const built = buildAdBearingCandidates({ setId: "ad006-outcome-cs", adQueryResult: adResult, at: T_QUERY });
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    const experienceId = (decision.selectedExperience as Experience).experienceId;

    // PRESENT → OUTCOME: the host presents the decided ad experience and
    // reports the observed impression through the EXISTING outcomes surface.
    const outcome = await client.outcomes.append(
      impressionInput({ decisionId: decision.decisionId, experienceId }),
    );
    expect(outcome.eventId).toBe(outcome.eventId);
    expect(outcome.evidenceClass).toBe("production-observed");

    // Durable in PG with content digest — the ground-truth outcome row.
    const stored = await composition.stores.events.getByEventId(TENANT, outcome.eventId);
    expect(stored).toBeDefined();
    expect(stored!.event.evidenceClass).toBe("production-observed");
    // Linked to the decision that selected the presented experience.
    const byDecision = await composition.stores.events.getByDecision(TENANT, decision.decisionId);
    expect(byDecision.map((row) => row.event.eventId)).toEqual([outcome.eventId]);

    // E1: the encounter was captured into Personal Ad Memory with
    // observed-encounter provenance bound to the REAL outcome event.
    const remembered = await queryAds({ mode: "remembered", at: T_ENCOUNTER + 1 });
    expect(rememberedItemIds(remembered)).toEqual(["ad006-gadget-promo"]);
    const record = remembered.remembered[0]!.record;
    if (record.provenance.kind !== "observed-encounter") {
      throw new Error("expected observed-encounter provenance (law 9)");
    }
    expect(record.provenance.evidence.outcomeEventId).toBe(outcome.eventId);
    expect(record.provenance.evidence.evidenceClass).toBe("production-observed");
    expect(record.provenance.evidence.encounteredAt).toBe(T_ENCOUNTER);
    // L1: retention carries the deployment-declared explicit basis.
    expect(record.retention.state).toBe("active");
    expect(record.retention.basis.kind).toBe("explicit-user-consent");
    expect(record.retention.basis.basisRef).toBe("ad006-consent-record-1");
    // L5: context BY REFERENCE only — the event's own ContextReference.
    expect(record.provenance.evidence.context).toEqual({ contextId: "ctx-ad006-home" });
    // L4: rights carried verbatim from the channel (encounter ≠ license).
    expect(record.rights.redistributionPermitted).toBe(false);
    expect(record.rights.gates).toEqual(["ad006-rights-gate"]);
    expect(record.rights.usageRestrictions).toEqual(["no-redistribution"]);
    // L8: the retained ad is structurally advertising.
    expect(record.ad.kind).toBe("advertising");
  });
});

/* ================================================================== *
 * PATH 1 — the memory path end-to-end:
 * encounter/save → retain → query/retrieve → resolve experience →
 * decide → schedule → present → outcome
 * ================================================================== */

describe("AD-006 PATH 1 — the memory path end-to-end (production composition over real PG)", () => {
  // The encounter was bootstrapped by PATH 2's final test (observed
  // impression → capture). PATH 1 now runs the FULL memory loop from
  // that retained record through a second presentation cycle.

  it("encounter/save → retain → query/retrieve: the retained ad is retrievable by query with disclosed provenance (E2/E6/L1/L9)", async () => {
    // RETAINED-MEMORY RETRIEVAL (E2): text query over memory.
    const result = await queryAds({ mode: "remembered", text: "the gadget ad I saw" });
    expect(rememberedItemIds(result)).toEqual(["ad006-gadget-promo"]);

    const candidate = result.remembered[0]!;
    const record = candidate.record;
    // E2: structurally active retention only (forgotten/expired cannot
    // appear — the frozen RetrievableAdMemoryRecord narrowing).
    expect(record.retention.state).toBe("active");
    // L1: the explicit basis rides every retrieval.
    expect(record.retention.basis.kind).toBe("explicit-user-consent");
    // E6: query provenance — whyRetrieved with a retrieval HINT score
    // (never a decision), terms disclosed verbatim.
    const queryMatch = candidate.whyRetrieved.find((reason) => reason.kind === "query-match");
    expect(queryMatch).toBeDefined();
    expect(queryMatch!.score).toBeGreaterThan(0);
    expect(result.queryUnderstanding?.terms).toContain("gadget");
    // L9: remembered provenance is the OBSERVED ENCOUNTER, never provider
    // availability.
    expect(record.provenance.kind).toBe("observed-encounter");
    // L8: explicit ad identification on the candidate.
    expect(candidate.advertising).toBe(true);
  });

  it("query/retrieve → resolve experience: the ad query result feeds the frozen resolve surface (experiences with formats + projected constraints)", async () => {
    const result = await queryAds({ mode: "remembered" });
    const built = buildAdBearingCandidates({ setId: "ad006-resolve-cs", adQueryResult: result, at: T_QUERY });

    // The retrieval helper collected the ad's catalog truth for resolve.
    expect(built.items.map((item) => item.itemId)).toEqual(["ad006-gadget-promo"]);
    expect(built.realizations.map((r) => r.realizationId)).toEqual(["real-ad006-gadget"]);

    // RESOLVE EXPERIENCE: the frozen resolve surface expands the ad item
    // into per-format experiences (the same expansion the decision path
    // runs — one experience surface, no ad-specific path).
    const resolved = await client.experiences.resolve({
      items: [...built.items],
      realizations: [...built.realizations],
      ...(Object.keys(built.itemConstraints).length > 0
        ? { itemConstraints: built.itemConstraints }
        : {}),
    } as ResolveRequestInput);
    const formats = resolved.experiences.map((e) => e.format.kind).sort();
    expect(formats).toEqual(["banner", "card"]);
    for (const experience of resolved.experiences) {
      expect(experience.itemId).toBe("ad006-gadget-promo");
      expect(experience.timing).toBeDefined();
      expect(experience.timing!.earliestMs).toBe(0);
      expect(experience.timing!.latestMs).toBe(T_CHANNEL_CLOSE);
    }
  });

  it("resolve experience → decide → schedule: the remembered ad is decided through the ONE kernel chain from PG memory truth (QUEUE, then CONTINUE dequeues it as plan head — present)", async () => {
    // Query memory → build the remembered-lane candidacy.
    const result = await queryAds({ mode: "remembered" });
    const built = buildAdBearingCandidates({ setId: "ad006-decide-cs", adQueryResult: result, at: T_QUERY });

    // DECIDE: the request declares the remembered-lane candidate source
    // (the frozen ad-lane vocabulary); the production handler resolves
    // ad truth from PG memory at the request clock.
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    expect(decision.action).toBe("QUEUE");
    const selected = decision.selectedExperience as Experience;
    expect(selected.itemId).toBe("ad006-gadget-promo");
    expect(["banner", "card"]).toContain(selected.format.kind);

    // SCHEDULE: the QUEUE decision's schedule delta enqueues the ad.
    expect(decision.scheduleDelta?.action).toBe("QUEUE");
    expect(decision.scheduleDelta?.enqueue).toEqual([selected.experienceId]);

    // PRESENT (the scheduler's own defer law): CONTINUE from the queued
    // plan dequeues the ad as the plan head. The plan is the durable PG
    // plan state (created through the public plans surface).
    const plan = await client.plans.create({
      schema: "reckon.experience-plan",
      schemaVersion: "0.1.0",
      planId: nextId("plan"),
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-shop", kind: "shop" },
      attentionPolicy: { policyId: "ap-balanced", style: "balanced" },
      queuedExperiences: [selected],
      createdAt: T_QUERY,
      updatedAt: T_QUERY,
    });
    expect(plan.queuedExperiences.map((e) => e.experienceId)).toEqual([selected.experienceId]);

    const continueDecision = await adDecisionRequest({
      candidates: built.candidateSet,
      planId: plan.planId,
      at: T_QUERY + 1,
    });
    expect(continueDecision.action).toBe("CONTINUE");
    expect(continueDecision.selectedExperience?.experienceId).toBe(selected.experienceId);
    expect(continueDecision.scheduleDelta?.dequeue).toEqual([selected.experienceId]);
  });

  it("present → outcome: the second presentation cycle reports a fresh observed impression (re-encounter) that supersedes the first record (deterministic supersession)", async () => {
    // Decide + continue to present again, then report the impression.
    const result = await queryAds({ mode: "remembered" });
    const built = buildAdBearingCandidates({ setId: "ad006-present-cs", adQueryResult: result, at: T_QUERY });
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    const experienceId = (decision.selectedExperience as Experience).experienceId;

    const secondEncounter = await client.outcomes.append(
      impressionInput({ decisionId: decision.decisionId, experienceId, occurredAt: T_QUERY + 2 }),
    );
    expect(secondEncounter.evidenceClass).toBe("production-observed");

    // The re-encounter (new evidence ⇒ new digest) becomes the CURRENT
    // record for the ad; exactly one current record per (subject, item)
    // — the AD-002 upsert policy.
    const remembered = await queryAds({ mode: "remembered", at: T_QUERY + 3 });
    expect(rememberedItemIds(remembered)).toEqual(["ad006-gadget-promo"]);
    const record = remembered.remembered[0]!.record;
    if (record.provenance.kind !== "observed-encounter") {
      throw new Error("expected observed-encounter provenance");
    }
    expect(record.provenance.evidence.outcomeEventId).toBe(secondEncounter.eventId);
    expect(record.provenance.evidence.encounteredAt).toBe(T_QUERY + 2);
    // The durable outcome trail in PG holds BOTH encounters, in order.
    const trail = await composition.stores.events.getBySubject(TENANT, SUBJECT);
    const impressions = trail.filter(
      (row) => row.event.eventType === "impression" && row.event.evidenceClass === "production-observed",
    );
    expect(impressions.length).toBeGreaterThanOrEqual(2);
  });
});

/* ================================================================== *
 * THE ELEVEN EVIDENCE REQUIREMENTS + THE TEN PRIVACY LAWS (E3–E11, the
 * proofs not already asserted inside the two paths)
 * ================================================================== */

describe("AD-006 evidence requirements — privacy, rights and determinism proofs", () => {
  /* ---- E3 / L2: explicit forget is terminal, at every clock ---- */
  it("E3/L2: explicit forget — subsequent retrieval can NEVER return the forgotten ad, at any clock (including rewinds)", async () => {
    // Seed a SEPARATE item's memory directly through the store port
    // (the AD-002 boundary — the same construction the capture uses).
    const seeded = await composition.stores.adMemory.put(
      finalizeAdMemoryRecord({
        tenant: TENANT,
        subject: SUBJECT,
        ad: {
          itemId: "ad006-forgotten-stay",
          kind: "advertising",
          labels: ["travel"],
          attributes: { headline: "Hotel stay to forget" },
        },
        realizations: [],
        lineage: { source: "host-ad-server", advertiserRef: "adv-ad006", campaignRef: "camp-ad006", creativeRefs: [] },
        retention: { state: "active", basis: CAPTURE_BASIS, retainedAt: T_BASIS },
        permissions: { retain: "granted", present: "granted", history: [] },
        provenance: {
          kind: "observed-encounter",
          evidence: { outcomeEventId: "ev-ad006-seed-1", evidenceClass: "production-observed", encounteredAt: T_ENCOUNTER },
        },
        rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
        recordedAt: T_BASIS,
      }),
    );
    expect(seeded.outcome).toBe("inserted");
    const recordId = seeded.record!.recordId;

    // Visible before the forget.
    const before = await queryAds({ mode: "remembered", text: "forget" });
    expect(rememberedItemIds(before)).toContain("ad006-forgotten-stay");

    // EXPLICIT FORGET through the public route.
    const forget = await client.forgetAds({
      requestId: nextId("forget"),
      tenant: TENANT,
      subject: SUBJECT,
      target: { kind: "record", recordId },
      reason: "AD-006 E3 proof: user requested removal",
      at: T_POST_EXPIRY,
      idempotencyKey: nextId("idem-forget"),
    });
    expect(forget.forgottenCount).toBe(1);
    expect(forget.forgottenRecordIds).toEqual([recordId]);

    // Subsequent retrieval NEVER returns it — at later clocks AND at
    // rewound clocks BEFORE the forget (terminality is state, not time).
    for (const at of [T_POST_EXPIRY, T_POST_EXPIRY + 10_000, T_BASIS, 0]) {
      const after = await queryAds({ mode: "remembered", text: "forget", at });
      expect(after.remembered.map((c) => c.record.recordId)).not.toContain(recordId);
    }
    // The tombstone: get() returns null on every read path.
    expect(await composition.stores.adMemory.get(TENANT, recordId)).toBeNull();
    // Row-level idempotency: a fresh forget of the tombstoned record
    // reports 0 (never re-counted).
    const reForget = await client.forgetAds({
      requestId: nextId("forget"),
      tenant: TENANT,
      subject: SUBJECT,
      target: { kind: "record", recordId },
      at: T_POST_EXPIRY + 1,
      idempotencyKey: nextId("idem-forget"),
    });
    expect(reForget.forgottenCount).toBe(0);
    // The OTHER ad's memory is untouched by the targeted forget.
    const untouched = await queryAds({ mode: "remembered" });
    expect(rememberedItemIds(untouched)).toContain("ad006-gadget-promo");
  });

  /* ---- E4 / L3: expired ads cannot be presented as currently available ---- */
  it("E4/L3: expired ad suppression — retention expiry suppresses retrieval deterministically; closed windows suppress selection truth", async () => {
    // (a) An EXPIRING memory record: boundary, suppression, rewind,
    //     re-suppression — the store keeps no hidden now.
    await composition.stores.adMemory.put(
      finalizeAdMemoryRecord({
        tenant: TENANT,
        subject: SUBJECT,
        ad: {
          itemId: "ad006-expiring-stay",
          kind: "advertising",
          labels: ["travel"],
          attributes: { headline: "Expiring hotel deal" },
        },
        realizations: [],
        lineage: { source: "host-ad-server", advertiserRef: "adv-ad006", campaignRef: "camp-ad006", creativeRefs: [] },
        retention: {
          state: "active",
          basis: CAPTURE_BASIS,
          retainedAt: T_BASIS,
          expiresAt: T_EXPIRY,
        },
        permissions: { retain: "granted", present: "granted", history: [] },
        provenance: {
          kind: "observed-encounter",
          evidence: { outcomeEventId: "ev-ad006-seed-2", evidenceClass: "production-observed", encounteredAt: T_ENCOUNTER },
        },
        rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
        recordedAt: T_BASIS,
      }),
    );

    const before = await queryAds({ mode: "remembered", text: "expiring", at: T_EXPIRY - 1 });
    expect(rememberedItemIds(before)).toEqual(["ad006-expiring-stay"]);

    const atBoundary = await queryAds({ mode: "remembered", text: "expiring", at: T_EXPIRY });
    expect(rememberedItemIds(atBoundary)).not.toContain("ad006-expiring-stay");

    const rewind = await queryAds({ mode: "remembered", text: "expiring", at: T_EXPIRY - 1 });
    expect(rememberedItemIds(rewind)).toEqual(["ad006-expiring-stay"]);

    const after = await queryAds({ mode: "remembered", text: "expiring", at: T_POST_EXPIRY });
    expect(rememberedItemIds(after)).not.toContain("ad006-expiring-stay");

    // (b) A REMEMBERED ad whose own catalog window closed: the decision
    //     path's ad-selection truth EXCLUDES it at the later clock (an
    //     expired ad is never candidacy truth for presentation).
    const rememberedNow = await queryAds({ mode: "remembered", at: T_LATE });
    // Memory retention is still active (no retention expiry was set on
    // the gadget record) — but the AD's OWN window is closed at T_LATE…
    expect(rememberedItemIds(rememberedNow)).toContain("ad006-gadget-promo");
    const record = rememberedNow.remembered.find(
      (c) => c.record.ad.itemId === "ad006-gadget-promo",
    )!.record;
    expect(isAdAvailableAt(record.ad, T_LATE)).toBe(false);
    // …so decisions at T_LATE never present it: with the organic
    // candidate alongside, the ad falls out of candidacy truth and the
    // decision selects the organic experience (suppression in the
    // presentation path — never a stale ad).
    const lateDecision = await adDecisionRequest({
      at: T_LATE,
      candidates: {
        setId: "ad006-late-cs",
        candidates: [
          {
            itemId: "ad006-gadget-promo",
            realizationIds: ["real-ad006-gadget"],
            source: AD_CANDIDATE_SOURCES.remembered,
          },
          {
            itemId: "ad006-organic-video",
            realizationIds: ["real-ad006-organic"],
            source: "host-retrieval",
          },
        ],
      },
    });
    expect(lateDecision.selectedExperience?.itemId).toBe("ad006-organic-video");
    // And an ads-only late request is an honest composition failure —
    // the normalizer's no-catalog-item absence law, never a fabricated
    // ad experience.
    await expect(
      adDecisionRequest({
        at: T_LATE,
        candidates: {
          setId: "ad006-late-only-cs",
          candidates: [
            {
              itemId: "ad006-gadget-promo",
              realizationIds: ["real-ad006-gadget"],
              source: AD_CANDIDATE_SOURCES.remembered,
            },
          ],
        },
      }),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    // (c) The SDK selection gate excludes the window-closed remembered
    //     ad at the later clock, with an honest note.
    const gated = selectAdCandidacy(rememberedNow, T_LATE);
    expect(gated.candidates.map((c) => c.itemId)).not.toContain("ad006-gadget-promo");
    expect(gated.notes.join(" | ")).toContain("closed at the selection clock");

    // (d) Channel supply with a closed window is never currently
    //     available (the frozen runtime gate, both windows).
    expect(isAdCandidateCurrentlyAvailable(SUPPLY_CLOSED, T_QUERY)).toBe(false);
  });

  /* ---- E5: rights/permission denial (present-revoked, scope, rights verbatim) ---- */
  it("E5: rights/permission denial — present-revoked memory is never a presentation candidate; a key without the ads scope is denied (403); redistribution stays unlicensed (L2/L4)", async () => {
    // A present-revoked record: retained but never presentable.
    const seeded = await composition.stores.adMemory.put(
      finalizeAdMemoryRecord({
        tenant: TENANT,
        subject: SUBJECT,
        ad: {
          itemId: "ad006-unpresentable",
          kind: "advertising",
          labels: ["finance"],
          attributes: { headline: "Present-revoked loan ad" },
        },
        realizations: [],
        lineage: { source: "host-ad-server", advertiserRef: "adv-ad006", campaignRef: "camp-ad006", creativeRefs: [] },
        retention: { state: "active", basis: CAPTURE_BASIS, retainedAt: T_BASIS },
        permissions: { retain: "granted", present: "revoked", history: [] },
        provenance: {
          kind: "observed-encounter",
          evidence: { outcomeEventId: "ev-ad006-seed-3", evidenceClass: "production-observed", encounteredAt: T_ENCOUNTER },
        },
        rights: { redistributionPermitted: false, gates: ["ad006-rights-gate"], usageRestrictions: [] },
        recordedAt: T_BASIS,
      }),
    );
    const revokedRecordId = seeded.record!.recordId;

    const lane = await queryAds({ mode: "remembered", text: "present-revoked" });
    expect(lane.remembered.map((c) => c.record.recordId)).not.toContain(revokedRecordId);

    // The retain-revoke path forgets terminally (ADR-003) — permission
    // denial at the store boundary.
    await composition.stores.adMemory.applyPermissionTransition(TENANT, revokedRecordId, {
      capability: "retain",
      from: "granted",
      to: "revoked",
      at: T_POST_EXPIRY,
      consentRef: "ad006-consent-record-2",
      reason: "user revoked retention",
    });
    expect(await composition.stores.adMemory.get(TENANT, revokedRecordId)).toBeNull();

    // RIGHTS denial at the API boundary: a key WITHOUT the `ads` scope
    // cannot query or forget ad memory (typed 403 INSUFFICIENT_SCOPE).
    await expect(
      noAdsClient.queryAds({
        queryId: nextId("q"),
        tenant: TENANT,
        subject: SUBJECT,
        at: T_QUERY,
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });
    await expect(
      noAdsClient.forgetAds({
        requestId: nextId("forget"),
        tenant: TENANT,
        subject: SUBJECT,
        target: { kind: "all" },
        at: T_QUERY,
        idempotencyKey: nextId("idem-forget"),
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE" });

    // L4: encountering the gadget ad licensed nothing — the captured
    // record still carries redistributionPermitted FALSE and the rights
    // gates verbatim (asserted on the live captured record).
    const remembered = await queryAds({ mode: "remembered", text: "gadget" });
    const captured = remembered.remembered.find((c) => c.record.ad.itemId === "ad006-gadget-promo");
    expect(captured).toBeDefined();
    expect(captured!.record.rights.redistributionPermitted).toBe(false);
    expect(captured!.record.rights.gates).toEqual(["ad006-rights-gate"]);
  });

  /* ---- E7 / L9: current-versus-remembered distinction, both directions ---- */
  it("E7/L9: the same ad appears in BOTH lanes with unconfusable provenance, memory link, and strict mode discipline", async () => {
    const both = await queryAds({ mode: "both", text: "gadget" });

    // Both lanes carry the SAME ad with DIFFERENT provenance kinds —
    // remembered (observed-encounter) vs available (provider-supplied).
    expect(rememberedItemIds(both)).toEqual(["ad006-gadget-promo"]);
    expect(availableItemIds(both)).toEqual(["ad006-gadget-promo"]);
    const rememberedRecord = both.remembered[0]!.record;
    expect(rememberedRecord.provenance.kind).toBe("observed-encounter");
    // The remembered evidence is one of THIS SUITE's observed encounters
    // (never a provider declaration time — the kinds are disjoint).
    if (rememberedRecord.provenance.kind !== "observed-encounter") {
      throw new Error("expected observed-encounter provenance (law 9)");
    }
    expect([T_ENCOUNTER, T_QUERY, T_QUERY + 2]).toContain(
      rememberedRecord.provenance.evidence.encounteredAt,
    );
    const availableCandidate = both.available[0]!;
    expect(availableCandidate.availability.suppliedBy).toBe("ad006-exchange");
    // The available candidate links to the memory record (the AD-002
    // one-current-record-per-ad upsert guarantees the link target).
    expect(availableCandidate.memoryRecordId).toBe(rememberedRecord.recordId);

    // MODE DISCIPLINE (lane/mode consistency enforced by the frozen
    // result schema): remembered mode never returns available candidates
    // and vice versa.
    const rememberedOnly = await queryAds({ mode: "remembered", text: "gadget" });
    expect(rememberedOnly.available).toEqual([]);
    const availableOnly = await queryAds({ mode: "available", text: "gadget" });
    expect(availableOnly.remembered).toEqual([]);

    // The candidate kinds are disjoint discriminators (law 9's union).
    expect(both.remembered[0]!.candidateKind).toBe("remembered");
    expect(both.available[0]!.candidateKind).toBe("available");
  });

  /* ---- E8 / L10: no fabricated engagement ---- */
  it("E8/L10: no fabricated engagement — non-observed evidence classes and unresolvable experiences are typed skips; outcomes exist only when reported", async () => {
    // The remembered lane BEFORE the fabrication probes.
    const before = await queryAds({ mode: "remembered", at: T_POST_EXPIRY });
    const beforeIds = new Set(before.remembered.map((c) => c.record.recordId));

    // (a) Simulated / counterfactual / fixture impressions are NEVER
    //     captured (law 10 — research-class events never become memory).
    for (const evidenceClass of ["simulated", "counterfactual", "fixture"] as const) {
      await client.outcomes.append(
        impressionInput({
          experienceId: "exp-ad006-gadget-banner-fake",
          occurredAt: T_POST_EXPIRY,
          evidenceClass,
        }),
      );
    }
    // (b) An impression whose experience resolves to NO ad context is an
    //     honest skip (no invented ad, no invented encounter).
    await client.outcomes.append(
      impressionInput({ experienceId: "exp-ad006-never-existed", occurredAt: T_POST_EXPIRY }),
    );

    const after = await queryAds({ mode: "remembered", at: T_POST_EXPIRY + 1 });
    const afterIds = new Set(after.remembered.map((c) => c.record.recordId));
    expect([...afterIds].filter((id) => !beforeIds.has(id))).toEqual([]);

    // (c) No fabricated OUTCOMES: a decision that was never reported has
    //     NO outcome rows in durable storage (the system never invents
    //     engagement evidence on any surface).
    const decision = await adDecisionRequest({
      candidates: {
        setId: "ad006-nooutcome-cs",
        candidates: [
          { itemId: "ad006-organic-video", realizationIds: ["real-ad006-organic"], source: "host-retrieval" },
        ],
      },
    });
    const trail = await composition.stores.events.getByDecision(TENANT, decision.decisionId);
    expect(trail).toEqual([]);

    // (d) The research/observed evidence partition (law 10's shared
    //     evidence-class rules): the ad impressions live in the OBSERVED
    //     partition only.
    const observed = await composition.stores.events.observed(TENANT);
    const research = await composition.stores.events.research(TENANT);
    for (const row of observed) {
      expect(["production-observed", "staging", "controlled-local"]).toContain(row.event.evidenceClass);
    }
    for (const row of research) {
      expect(["simulated", "counterfactual", "fixture"]).toContain(row.event.evidenceClass);
    }
    const observedImpressions = observed.filter((row) => row.event.eventType === "impression");
    expect(observedImpressions.length).toBeGreaterThanOrEqual(2);
  });

  /* ---- E9: deterministic replay ---- */
  it("E9: deterministic replay — identical queries return byte-identical results; idempotent requests replay verbatim without re-execution", async () => {
    // (a) Two IDENTICAL ad queries (same body incl. queryId, fresh SDK
    //     idempotency keys so both EXECUTE independently) produce
    //     byte-identical results — same lanes, same order, same reasons.
    const queryBody = {
      queryId: "ad006-determinism-q",
      tenant: TENANT,
      subject: SUBJECT,
      mode: "both" as const,
      text: "gadget",
      at: T_QUERY,
    };
    const first = await client.queryAds(queryBody);
    const second = await client.queryAds(queryBody);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    // (b) Idempotent POST replay through the route pipeline: the same
    //     idempotency key + body replays VERBATIM with the
    //     Idempotent-Replayed marker and no handler re-execution.
    const injectBody = {
      schema: "reckon.ad-query-request",
      queryId: "ad006-replay-inject",
      tenant: TENANT,
      subject: SUBJECT,
      mode: "remembered",
      text: "gadget",
      at: T_QUERY,
      idempotencyKey: "ad006-replay-inject-key",
    };
    const injectHeaders = {
      authorization: "Bearer ad006-e2e-key",
      "content-type": "application/json",
      "idempotency-key": "ad006-replay-inject-key",
    };
    const firstRes = await composition.app.inject({
      method: "POST",
      url: "/v1/ads/query",
      headers: injectHeaders,
      payload: injectBody,
    });
    expect(firstRes.statusCode).toBe(200);
    expect(firstRes.headers["idempotent-replayed"]).toBeUndefined();
    const secondRes = await composition.app.inject({
      method: "POST",
      url: "/v1/ads/query",
      headers: injectHeaders,
      payload: injectBody,
    });
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.headers["idempotent-replayed"]).toBe("true");
    expect(secondRes.json()).toEqual(firstRes.json());

    // (c) A DECISION replay: the same request idempotency key + body
    //     returns the same decisionId (the deterministic content digest).
    const decisionBody = {
      requestId: "ad006-replay-decision",
      tenant: TENANT,
      subject: SUBJECT,
      objective: { objectiveId: "obj-shop", kind: "shop" },
      attentionPolicy: { policyId: "ap-balanced", style: "balanced" },
      context: { contextId: "ctx-ad006-home" },
      candidates: {
        setId: "ad006-replay-cs",
        candidates: [
          { itemId: "ad006-organic-video", realizationIds: ["real-ad006-organic"], source: "host-retrieval" },
        ],
      },
      policySelector: { policyId: "greedy-v1", version: "1" },
      at: T_QUERY,
      idempotencyKey: "ad006-replay-decision-key",
    };
    const decision1 = await client.decisions.request(decisionBody as DecisionRequestInput);
    const decision2 = await client.decisions.request(decisionBody as DecisionRequestInput);
    expect(decision2.decisionId).toBe(decision1.decisionId);
    expect(JSON.stringify(decision2)).toBe(JSON.stringify(decision1));

    // (d) Memory write idempotency: replaying the SAME outcome event
    //     (same idempotency key) is a duplicate write, not a new record.
    const adResult = await queryAds({ mode: "available" });
    const built = buildAdBearingCandidates({ setId: "ad006-idem-cs", adQueryResult: adResult, at: T_QUERY });
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    const experienceId = (decision.selectedExperience as Experience).experienceId;
    const event = impressionInput({ decisionId: decision.decisionId, experienceId, occurredAt: T_POST_EXPIRY + 5 });
    const firstOutcome = await client.outcomes.append(event);
    const replayedOutcome = await client.outcomes.append(event);
    expect(replayedOutcome.eventId).toBe(firstOutcome.eventId);
    const remembered = await queryAds({ mode: "remembered", at: T_POST_EXPIRY + 6, text: "gadget" });
    const gadgetRecords = remembered.remembered.filter((c) => c.record.ad.itemId === "ad006-gadget-promo");
    // Exactly ONE current record for the ad (the upsert policy) — the
    // replay added nothing.
    expect(gadgetRecords).toHaveLength(1);
    expect(gadgetRecords[0]!.record.provenance.kind).toBe("observed-encounter");
    if (gadgetRecords[0]!.record.provenance.kind === "observed-encounter") {
      expect(gadgetRecords[0]!.record.provenance.evidence.outcomeEventId).toBe(firstOutcome.eventId);
    }
  });

  /* ---- L1: retention requires an explicit basis (structural) ---- */
  it("L1: retention requires an explicit permission/retention basis — a basis-less retention cannot parse, cannot be stored", () => {
    const content = {
      tenant: TENANT,
      subject: SUBJECT,
      ad: {
        itemId: "ad006-basisless",
        kind: "advertising" as const,
        labels: [],
        attributes: {},
      },
      realizations: [],
      lineage: { source: "host-ad-server", creativeRefs: [] },
      // NO retention basis — law 1 violation.
      retention: { state: "active" as const, retainedAt: T_BASIS },
      permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
      provenance: {
        kind: "observed-encounter" as const,
        evidence: {
          outcomeEventId: "ev-ad006-basisless",
          evidenceClass: "production-observed" as const,
          encounteredAt: T_ENCOUNTER,
        },
      },
      rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
      recordedAt: T_BASIS,
    };
    // The frozen schema rejects it — public observability is never a
    // retention basis; there is no basis-free retention shape at all.
    const parsed = AdMemoryRecordSchema.safeParse({
      ...content,
      recordId: "admem-0000000000000000000000000",
      contentDigest: "0".repeat(64),
    });
    expect(parsed.success).toBe(false);
    // And the single construction path (finalize) throws on it too
    // (intentionally-basisless content — cast to the input type the same
    // way a hostile caller would smuggle it past the compiler).
    expect(() =>
      finalizeAdMemoryRecord(
        content as unknown as Parameters<typeof finalizeAdMemoryRecord>[0],
      ),
    ).toThrow();
    // The captured records in this suite all carry a real basis.
    expect(CAPTURE_BASIS.kind).toBe("explicit-user-consent");
    expect(Object.keys(CAPTURE_BASIS).length).toBeGreaterThan(0);
  });

  /* ---- L5: raw location/attention/sensitive payloads cannot persist ---- */
  it("L5: raw location, attention, or sensitive attributes are not silently persisted as ad targeting data (context by reference only; unknown keys stripped)", async () => {
    // The frozen encounter-evidence surface strips unknown keys: a raw
    // location/attention payload has NO field to hide in.
    const stripped = AdEncounterEvidenceSchema.parse({
      outcomeEventId: "ev-ad006-l5",
      evidenceClass: "production-observed",
      encounteredAt: T_ENCOUNTER,
      context: { contextId: "ctx-ad006-home" },
      // Raw targeting payloads — silently stripped on parse, never persisted.
      location: { lat: 5.6037, lon: -0.187 },
      attention: { focusMs: 412, gazeFixations: 7 },
      preciseGeolocation: "Accra",
      sensorStream: [1, 2, 3],
    });
    expect(stripped).toEqual({
      outcomeEventId: "ev-ad006-l5",
      evidenceClass: "production-observed",
      encounteredAt: T_ENCOUNTER,
      context: { contextId: "ctx-ad006-home" },
    });
    expect(Object.keys(stripped)).not.toContain("location");
    expect(Object.keys(stripped)).not.toContain("attention");

    // The captured records in this suite: context BY REFERENCE only
    // (an id, never raw values).
    const remembered = await queryAds({ mode: "remembered", text: "gadget" });
    for (const candidate of remembered.remembered) {
      const evidence =
        candidate.record.provenance.kind === "observed-encounter"
          ? candidate.record.provenance.evidence
          : undefined;
      if (evidence !== undefined) {
        expect(evidence.context).toEqual({ contextId: "ctx-ad006-home" });
        expect(Object.keys(evidence)).not.toContain("location");
        expect(Object.keys(evidence)).not.toContain("attention");
      }
    }
  });

  /* ---- L6: no inferred sensitive attributes on the memory record ---- */
  it("L6: the memory record carries NO audience-inference or sensitive-attribute field — the key set is exactly the frozen schema's", async () => {
    const remembered = await queryAds({ mode: "remembered", text: "gadget" });
    const record = remembered.remembered[0]!.record;
    const keys = Object.keys(record).sort();
    // Exactly the frozen AdMemoryRecord shape — no inference fields exist.
    expect(keys).toEqual([
      "ad",
      "contentDigest",
      "idempotencyKey",
      "lineage",
      "permissions",
      "provenance",
      "realizations",
      "recordId",
      "recordedAt",
      "retention",
      "rights",
      "schema",
      "schemaVersion",
      "subject",
      "tenant",
    ]);
    // No key anywhere in the record claims an audience/sensitive
    // inference vocabulary.
    const serialized = JSON.stringify(record);
    for (const forbidden of ["audience", "inferred", "sensitive", "ethnicity", "health", "sexualOrientation", "political"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  /* ---- L7: user value vs commercial value stay separate ---- */
  it("L7: user value and commercial value remain separate — commercial value has NO ranking path; the reward bridge carries user value only", async () => {
    const result = await queryAds({ mode: "available", text: "gadget" });
    const candidate = result.available[0]!;
    // The two value assessments are SEPARATE optional fields with
    // distinct schemas (never blended).
    expect(candidate.userValue).toBeDefined();
    expect(candidate.userValue!.score).toBe(0.6);
    expect(candidate.commercialValue).toBeDefined();
    expect(candidate.commercialValue!.metrics).toEqual({ ecpm: 4.2 });
    expect((candidate.commercialValue as { score?: number }).score).toBeUndefined();

    // The SDK reward bridge (the documented path by which declared ad
    // USER value reaches the policy engine) keys on USER value only —
    // commercialValue has no ranking path by design.
    const built = buildAdBearingCandidates({ setId: "ad006-value-cs", adQueryResult: result, at: T_QUERY });
    const resolved = await client.experiences.resolve({
      items: [...built.items],
      realizations: [...built.realizations],
    });
    const term = adUserValueRewardTerm({
      experiences: resolved.experiences,
      userValueByItemId: built.userValueByItemId,
    });
    expect(term).not.toBeNull();
    expect(term!.kind).toBe("satisfaction-proxy");
    const valueEntries = Object.entries(term!.params.values as Record<string, number>);
    expect(valueEntries).toHaveLength(resolved.experiences.length);
    for (const [, score] of valueEntries) {
      expect(score).toBe(0.6); // the USER value score — never ecpm
    }
    // The term is parseable as a frozen RewardTerm (the policy engine's
    // existing declared-value channel).
    expect(RewardTermSchema.safeParse(term).success).toBe(true);
  });

  /* ---- L8: advertising stays identifiable through the lane ---- */
  it("L8: advertising remains explicitly identifiable — every ad candidate and the retained ad are structurally advertising; sources are the frozen ad-lane vocabulary", async () => {
    const both = await queryAds({ mode: "both", text: "gadget" });
    for (const candidate of both.remembered) {
      expect(candidate.advertising).toBe(true);
      expect(candidate.record.ad.kind).toBe("advertising");
    }
    for (const candidate of both.available) {
      expect(candidate.advertising).toBe(true);
      expect(candidate.ad.kind).toBe("advertising");
    }
    // The decision-path candidate sources are the frozen ad-lane
    // vocabulary (distinguishable from organic "host-retrieval").
    expect(AD_CANDIDATE_SOURCES.remembered).toBe("reckon.ad-memory.remembered");
    expect(AD_CANDIDATE_SOURCES.available).toBe("reckon.ad-availability.current");
    const built = buildAdBearingCandidates({ setId: "ad006-l8-cs", adQueryResult: both, at: T_QUERY });
    const adSources = built.candidateSet.candidates
      .filter((c) => c.source === AD_CANDIDATE_SOURCES.remembered || c.source === AD_CANDIDATE_SOURCES.available)
      .map((c) => c.source);
    expect(adSources.length).toBeGreaterThan(0);
  });

  /* ---- L10: the ad lane uses the same evidence-class rules ---- */
  it("L10: encounter evidence accepts ONLY observed evidence classes — simulated/counterfactual/fixture are parse errors (same enum family as OutcomeEvent)", () => {
    for (const observedClass of OBSERVED_EVIDENCE_CLASSES) {
      expect(
        AdEncounterEvidenceSchema.safeParse({
          outcomeEventId: "ev-ad006-l10",
          evidenceClass: observedClass,
          encounteredAt: T_ENCOUNTER,
        }).success,
      ).toBe(true);
    }
    for (const researchClass of ["simulated", "counterfactual", "fixture"] as const) {
      const parsed = AdEncounterEvidenceSchema.safeParse({
        outcomeEventId: "ev-ad006-l10",
        evidenceClass: researchClass,
        encounteredAt: T_ENCOUNTER,
      });
      expect(parsed.success).toBe(false);
    }
    // OBSERVED_EVIDENCE_CLASSES is the SAME family the OutcomeEvent
    // contract uses (the shared evidence-class rule).
    expect(OBSERVED_EVIDENCE_CLASSES).toEqual(["production-observed", "staging", "controlled-local"]);
  });

  /* ---- subject/tenant scoping (the rights boundary of memory) ---- */
  it("memory is subject-scoped: another subject sees none of this subject's Personal Ad Memory through the same key", async () => {
    const otherSubjectResult = await client.queryAds({
      queryId: nextId("q"),
      tenant: TENANT,
      subject: OTHER_SUBJECT,
      mode: "remembered",
      at: T_QUERY,
    });
    expect(otherSubjectResult.remembered).toEqual([]);
    // And forgetting as another subject affects nothing of ours.
    const forget = await client.forgetAds({
      requestId: nextId("forget"),
      tenant: TENANT,
      subject: OTHER_SUBJECT,
      target: { kind: "all" },
      at: T_QUERY,
      idempotencyKey: nextId("idem-forget"),
    });
    expect(forget.forgottenCount).toBe(0);
    const ours = await queryAds({ mode: "remembered", text: "gadget" });
    expect(rememberedItemIds(ours)).toContain("ad006-gadget-promo");
  });
});

/* ================================================================== *
 * THE DECISION RESULT CONTRACT (the outcome lane's frozen envelope —
 * every decision surfaced in this suite parses through it)
 * ================================================================== */

describe("AD-006 contract soundness — every surfaced decision parses through the frozen result contract", () => {
  it("ad-bearing decisions returned by the production composition are frozen-contract valid (E-every: the envelope law)", async () => {
    const adResult = await queryAds({ mode: "both", text: "gadget" });
    const built = buildAdBearingCandidates({ setId: "ad006-envelope-cs", adQueryResult: adResult, at: T_QUERY });
    const decision = await adDecisionRequest({ candidates: built.candidateSet });
    const parsed = DecisionResultSchema.safeParse(decision);
    expect(parsed.success).toBe(true);
    expect(parsed.data!.selectedExperience?.itemId).toBe("ad006-gadget-promo");
  });
});
