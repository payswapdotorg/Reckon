import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  // schemas
  AdMemoryRecordSchema,
  AdMemoryRecordContentSchema,
  RetrievableAdMemoryRecordSchema,
  AdEncounterEvidenceSchema,
  AdProvenanceSchema,
  AdRetentionSchema,
  AdRightsConstraintsSchema,
  AdPermissionStateSchema,
  AdEligibilitySchema,
  AdQueryRequestSchema,
  AdQueryResultSchema,
  AdForgetRequestSchema,
  AdForgetResultSchema,
  RememberedAdCandidateSchema,
  AvailableAdCandidateSchema,
  AdCandidateSchema,
  CandidateSetSchema,
  HardConstraintSchema,
  // values
  AD_RETENTION_BASES,
  AD_QUERY_MODES,
  AD_CANDIDATE_SOURCES,
  OBSERVED_EVIDENCE_CLASSES,
  // helpers
  finalizeAdMemoryRecord,
  adMemoryRecordDigest,
  adMemoryRecordId,
  applyAdPermissionTransition,
  isAdMemoryRetrievable,
  isAdAvailableAt,
  isAdCandidateCurrentlyAvailable,
  adEligibilityToConstraints,
  adCandidatesToCandidateSet,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tenant = { tenantId: "t-1" };
const subject = { kind: "user" as const, ref: "user-9" };

const adItem = {
  itemId: "ad-hotel-accra-1",
  kind: "advertising" as const,
  labels: ["travel", "hotel"],
  attributes: { headline: "Stay in Accra" },
};

const evidence = {
  outcomeEventId: "ev-1",
  evidenceClass: "production-observed" as const,
  encounteredAt: 1_000,
  context: { contextId: "ctx-1" },
  surface: "in-stream",
};

const retentionBasis = {
  kind: "explicit-user-consent" as const,
  establishedAt: 1_000,
  basisRef: "consent-42",
};

const recordContent = {
  tenant,
  subject,
  ad: adItem,
  realizations: [],
  lineage: {
    source: "host-ad-server",
    advertiserRef: "adv-7",
    campaignRef: "camp-2",
    creativeRefs: ["cr-1"],
  },
  retention: { state: "active" as const, basis: retentionBasis, retainedAt: 1_000, expiresAt: 100_000 },
  permissions: { retain: "granted" as const, present: "granted" as const, history: [] },
  provenance: { kind: "observed-encounter" as const, evidence },
  rights: { redistributionPermitted: false, gates: ["host-rights-gate"], usageRestrictions: [] },
  recordedAt: 1_050,
};

const record = finalizeAdMemoryRecord(recordContent, "idem-1");

const rememberedCandidate = {
  candidateKind: "remembered" as const,
  advertising: true as const,
  record,
  whyRetrieved: [{ kind: "query-match" as const, detail: "hotel", score: 0.9 }],
};

const availableAd = {
  itemId: "ad-shoe-offer-1",
  kind: "advertising" as const,
  labels: ["sport", "offer"],
  attributes: { headline: "Running shoes -20%" },
  availableFrom: 0,
  availableUntil: 200_000,
};

const availableCandidate = {
  candidateKind: "available" as const,
  advertising: true as const,
  ad: availableAd,
  realizations: [],
  availability: { suppliedBy: "host-ad-exchange", availableFrom: 0, availableUntil: 200_000 },
  rights: { redistributionPermitted: false, gates: [], usageRestrictions: [] },
  whyRetrieved: [{ kind: "provider-supplied" as const, detail: "exchange feed", score: 0.4 }],
};

// Parsed fixtures — the output-typed values a real consumer (AD-003)
// holds after AdQueryResultSchema.parse.
const rememberedCandidateParsed = RememberedAdCandidateSchema.parse(rememberedCandidate);
const availableCandidateParsed = AvailableAdCandidateSchema.parse(availableCandidate);

// ---------------------------------------------------------------------------
// Canonical Ad Memory record
// ---------------------------------------------------------------------------

describe("AdMemoryRecord construction and determinism", () => {
  it("finalizes a valid record with schema discriminant and derived identity", () => {
    expect(record.schema).toBe("reckon.ad-memory-record");
    expect(record.recordId).toMatch(/^admem-[0-9a-f]{24}$/);
    expect(record.contentDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(record.contentDigest).toBe(adMemoryRecordDigest(recordContent));
    expect(record.recordId).toBe(adMemoryRecordId(recordContent));
    expect(record.idempotencyKey).toBe("idem-1");
  });

  it("is deterministic: same content yields the same id and digest (idempotent writes)", () => {
    const again = finalizeAdMemoryRecord(recordContent, "idem-1");
    expect(again.recordId).toBe(record.recordId);
    expect(again.contentDigest).toBe(record.contentDigest);
  });

  it("scopes the digest by subject: a different subject yields a different record", () => {
    const other = finalizeAdMemoryRecord({
      ...recordContent,
      subject: { kind: "user", ref: "user-10" },
    });
    expect(other.recordId).not.toBe(record.recordId);
  });

  it("round-trips through AdMemoryRecordSchema", () => {
    const parsed = AdMemoryRecordSchema.parse(record);
    expect(parsed.recordId).toBe(record.recordId);
  });

  it("rejects a malformed content digest", () => {
    expect(() => AdMemoryRecordSchema.parse({ ...record, contentDigest: "not-hex" })).toThrow();
  });

  it("idempotencyKey is optional", () => {
    const noKey = finalizeAdMemoryRecord(recordContent);
    expect(noKey.idempotencyKey).toBeUndefined();
    expect(noKey.recordId).toBe(record.recordId);
  });
});

// ---------------------------------------------------------------------------
// Law 1 — retention requires an explicit basis
// ---------------------------------------------------------------------------

describe("law 1: retention requires an explicit permission/retention basis", () => {
  it("rejects every retention state without a basis", () => {
    const { basis: _drop, ...activeWithoutBasis } = recordContent.retention;
    expect(() => AdRetentionSchema.parse(activeWithoutBasis)).toThrow();
    expect(() => AdRetentionSchema.parse({ state: "expired", expiresAt: 5 })).toThrow();
    expect(() => AdRetentionSchema.parse({ state: "forgotten", forgottenAt: 5 })).toThrow();
  });

  it("accepts every retention state with a valid basis", () => {
    for (const [state, extra] of [
      ["active", {}],
      ["expired", { expiresAt: 100 }],
      ["forgotten", { forgottenAt: 100 }],
    ] as const) {
      const parsed = AdRetentionSchema.parse({ state, basis: retentionBasis, ...extra });
      expect(parsed.basis.kind).toBe("explicit-user-consent");
    }
  });

  it("never treats public observability as a retention basis", () => {
    expect(AD_RETENTION_BASES).not.toContain("publicly-observable");
    expect(AD_RETENTION_BASES).toEqual([
      "explicit-user-consent",
      "host-retention-policy",
      "host-contractual-term",
      "legal-obligation",
    ]);
  });

  it("rejects an unknown basis kind", () => {
    expect(() =>
      AdRetentionSchema.parse({
        state: "active",
        basis: { kind: "because-it-was-public", establishedAt: 1 },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Law 2 — forget is terminal and unretrievable
// ---------------------------------------------------------------------------

describe("law 2: forget means subsequent retrieval cannot return the ad", () => {
  const forgottenRecord = finalizeAdMemoryRecord({
    ...recordContent,
    retention: { state: "forgotten", basis: retentionBasis, forgottenAt: 90_000, forgetReason: "user request" },
  });

  it("requires forgottenAt for the forgotten state", () => {
    expect(() =>
      AdRetentionSchema.parse({ state: "forgotten", basis: retentionBasis }),
    ).toThrow();
  });

  it("parses a forgotten record with an audit trail", () => {
    expect(forgottenRecord.retention.state).toBe("forgotten");
    if (forgottenRecord.retention.state === "forgotten") {
      expect(forgottenRecord.retention.forgottenAt).toBe(90_000);
      expect(forgottenRecord.retention.forgetReason).toBe("user request");
    }
  });

  it("isAdMemoryRetrievable is false for forgotten records", () => {
    expect(isAdMemoryRetrievable(forgottenRecord, 95_000)).toBe(false);
  });

  it("a remembered candidate cannot embed a forgotten record", () => {
    expect(() =>
      RememberedAdCandidateSchema.parse({ ...rememberedCandidate, record: forgottenRecord }),
    ).toThrow();
  });

  it("parses forget requests and results", () => {
    const request = AdForgetRequestSchema.parse({
      requestId: "fg-1",
      tenant,
      subject,
      target: { kind: "record", recordId: record.recordId },
      reason: "user asked to forget",
      at: 90_000,
      idempotencyKey: "idem-fg-1",
    });
    expect(request.target).toEqual({ kind: "record", recordId: record.recordId });

    const result = AdForgetResultSchema.parse({
      requestId: "fg-1",
      tenant,
      forgottenCount: 1,
      forgottenRecordIds: [record.recordId],
      at: 90_000,
    });
    expect(result.forgottenCount).toBe(1);
  });

  it("supports item, advertiser and all forget targets, and requires idempotencyKey", () => {
    expect(
      AdForgetRequestSchema.parse({
        requestId: "fg-2",
        tenant,
        subject,
        target: { kind: "all" },
        at: 1,
        idempotencyKey: "k",
      }).target,
    ).toEqual({ kind: "all" });
    expect(
      AdForgetRequestSchema.parse({
        requestId: "fg-3",
        tenant,
        subject,
        target: { kind: "advertiser", advertiserRef: "adv-7" },
        at: 1,
        idempotencyKey: "k",
      }).target,
    ).toEqual({ kind: "advertiser", advertiserRef: "adv-7" });
    const { idempotencyKey: _k, ...withoutKey } = {
      requestId: "fg-4",
      tenant,
      subject,
      target: { kind: "item", itemId: "ad-hotel-accra-1" },
      at: 1,
      idempotencyKey: "k",
    };
    expect(() => AdForgetRequestSchema.parse(withoutKey)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Law 3 — expired is never "currently available"
// ---------------------------------------------------------------------------

describe("law 3: expired ads cannot be presented as currently available", () => {
  it("isAdMemoryRetrievable respects retention expiry against the query clock", () => {
    expect(isAdMemoryRetrievable(record, 50_000)).toBe(true);
    expect(isAdMemoryRetrievable(record, 100_000)).toBe(false); // expiresAt <= at
    expect(isAdMemoryRetrievable(record, 150_000)).toBe(false);
  });

  it("expired retention requires expiresAt and suppresses retrieval", () => {
    const expired = finalizeAdMemoryRecord({
      ...recordContent,
      retention: { state: "expired", basis: retentionBasis, expiresAt: 100_000, expiredAt: 100_000 },
    });
    expect(expired.retention.state).toBe("expired");
    expect(isAdMemoryRetrievable(expired, 150_000)).toBe(false);
    expect(() => AdRetentionSchema.parse({ state: "expired", basis: retentionBasis })).toThrow();
  });

  it("a remembered candidate cannot embed an expired record", () => {
    const expired = finalizeAdMemoryRecord({
      ...recordContent,
      retention: { state: "expired", basis: retentionBasis, expiresAt: 100_000 },
    });
    expect(() =>
      RememberedAdCandidateSchema.parse({ ...rememberedCandidate, record: expired }),
    ).toThrow();
  });

  it("isAdAvailableAt evaluates the ad's own availability window", () => {
    expect(isAdAvailableAt(availableAd, 10_000)).toBe(true);
    expect(isAdAvailableAt(availableAd, 200_000)).toBe(false); // until is exclusive
    expect(isAdAvailableAt({ availableFrom: 5_000 }, 4_999)).toBe(false);
    expect(isAdAvailableAt({ availableFrom: 5_000 }, 5_000)).toBe(true);
    expect(isAdAvailableAt({}, 123)).toBe(true); // no window declared
  });

  it("isAdCandidateCurrentlyAvailable combines candidate and ad windows", () => {
    expect(isAdCandidateCurrentlyAvailable(availableCandidate, 10_000)).toBe(true);
    expect(isAdCandidateCurrentlyAvailable(availableCandidate, 199_999)).toBe(true);
    expect(isAdCandidateCurrentlyAvailable(availableCandidate, 200_000)).toBe(false);
    const staleSupply = {
      ...availableCandidate,
      availability: { suppliedBy: "host-ad-exchange", availableUntil: 5_000 },
    };
    expect(isAdCandidateCurrentlyAvailable(staleSupply, 10_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Law 4 — encounter is not a license; rights are never inferred
// ---------------------------------------------------------------------------

describe("law 4: rights constraints and redistribution default", () => {
  it("redistributionPermitted defaults to false when omitted", () => {
    const rights = AdRightsConstraintsSchema.parse({});
    expect(rights.redistributionPermitted).toBe(false);
    expect(rights.gates).toEqual([]);
    expect(rights.usageRestrictions).toEqual([]);
  });

  it("the record's rights parse and default within the full record", () => {
    const bare = finalizeAdMemoryRecord({
      ...recordContent,
      rights: {},
    });
    expect(bare.rights.redistributionPermitted).toBe(false);
  });

  it("an explicit host declaration is allowed — but must be explicit", () => {
    const rights = AdRightsConstraintsSchema.parse({ redistributionPermitted: true, rightsRef: "rights-rec-9" });
    expect(rights.redistributionPermitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Law 5 — no raw location/attention payload in encounter evidence
// ---------------------------------------------------------------------------

describe("law 5: encounter evidence references context by id only", () => {
  it("has no location/attention/sensor field, structurally", () => {
    const keys = Object.keys(AdEncounterEvidenceSchema.shape);
    expect(keys.some((k) => /location|attention|sensor|geo|gps|coords/i.test(k))).toBe(false);
    expect(keys).toContain("context"); // by reference only
  });

  it("strips unknown raw payload keys on parse (nothing raw persists)", () => {
    const parsed = AdEncounterEvidenceSchema.parse({
      ...evidence,
      location: { lat: 5.6, lng: -0.19 },
      attentionRaw: { dwellMs: 4200 },
    }) as Record<string, unknown>;
    expect(parsed.location).toBeUndefined();
    expect(parsed.attentionRaw).toBeUndefined();
    expect(parsed.outcomeEventId).toBe("ev-1");
  });

  it("requires the observed outcome event id and encounter time", () => {
    const { outcomeEventId: _e, ...noEvent } = evidence;
    expect(() => AdEncounterEvidenceSchema.parse(noEvent)).toThrow();
    const { encounteredAt: _t, ...noTime } = evidence;
    expect(() => AdEncounterEvidenceSchema.parse(noTime)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Law 6 — no inferred sensitive attributes on the memory record
// ---------------------------------------------------------------------------

describe("law 6: no inference/audience-attribute fields on the record", () => {
  it("has no audience-inference field, structurally", () => {
    const keys = Object.keys(AdMemoryRecordSchema.shape);
    expect(keys.some((k) => /infer|audience|target|attribute|segment/i.test(k))).toBe(false);
  });

  it("derived learning state stays in PreferenceDelta (separate primitive)", () => {
    // structural absence is the contract-level statement; PreferenceDelta
    // remains the only learning-state carrier (own provenance/confidence).
    expect(Object.keys(AdMemoryRecordSchema.shape)).not.toContain("preferenceDeltas");
  });
});

// ---------------------------------------------------------------------------
// Law 7 — user value vs commercial value are separate fields
// ---------------------------------------------------------------------------

describe("law 7: value separation", () => {
  it("carries userValue and commercialValue as separate optional fields", () => {
    const withUserOnly = RememberedAdCandidateSchema.parse({
      ...rememberedCandidate,
      userValue: { score: 0.8, reasons: ["matches your trip"] },
    });
    expect(withUserOnly.userValue?.score).toBe(0.8);
    expect(withUserOnly.commercialValue).toBeUndefined();

    const withCommercialOnly = RememberedAdCandidateSchema.parse({
      ...rememberedCandidate,
      commercialValue: { metrics: { ecpm: 4.2 }, currency: "USD", declaredBy: "host-ad-exchange" },
    });
    expect(withCommercialOnly.commercialValue?.metrics.ecpm).toBe(4.2);
    expect(withCommercialOnly.userValue).toBeUndefined();
  });

  it("userValue score is bounded 0..1", () => {
    expect(() =>
      RememberedAdCandidateSchema.parse({
        ...rememberedCandidate,
        userValue: { score: 1.5 },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Law 8 — advertising stays explicitly identifiable
// ---------------------------------------------------------------------------

describe("law 8: explicit ad identification", () => {
  it("rejects a memory record whose item is not advertising", () => {
    expect(() =>
      finalizeAdMemoryRecord({
        ...recordContent,
        ad: { ...adItem, kind: "media" as unknown as "advertising" },
      }),
    ).toThrow();
  });

  it("rejects an ad candidate that does not declare advertising: true", () => {
    expect(() =>
      RememberedAdCandidateSchema.parse({ ...rememberedCandidate, advertising: false }),
    ).toThrow();
    expect(() =>
      AvailableAdCandidateSchema.parse({ ...availableCandidate, advertising: false }),
    ).toThrow();
  });

  it("rejects an available candidate whose ad item is not advertising", () => {
    expect(() =>
      AvailableAdCandidateSchema.parse({
        ...availableCandidate,
        ad: { ...availableAd, kind: "commerce" as unknown as "advertising" },
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Law 9 — remembered vs provider-supplied provenance is unconfusable
// ---------------------------------------------------------------------------

describe("law 9: unconfusable provenance and separated result lanes", () => {
  it("observed-encounter requires evidence; provider-supplied requires availability", () => {
    expect(() => AdProvenanceSchema.parse({ kind: "observed-encounter" })).toThrow();
    expect(() => AdProvenanceSchema.parse({ kind: "provider-supplied" })).toThrow();
    const observed = AdProvenanceSchema.parse({ kind: "observed-encounter", evidence });
    expect(observed.kind).toBe("observed-encounter");
    const supplied = AdProvenanceSchema.parse({
      kind: "provider-supplied",
      availability: { suppliedBy: "host-ad-exchange" },
    });
    expect(supplied.kind).toBe("provider-supplied");
  });

  it("evidence cannot pose as availability or the reverse", () => {
    expect(() => AdProvenanceSchema.parse({ kind: "observed-encounter", availability: { suppliedBy: "x" } })).toThrow();
    expect(() => AdProvenanceSchema.parse({ kind: "provider-supplied", evidence })).toThrow();
  });

  it("the candidate union discriminates remembered vs available", () => {
    expect(AdCandidateSchema.parse(rememberedCandidate).candidateKind).toBe("remembered");
    expect(AdCandidateSchema.parse(availableCandidate).candidateKind).toBe("available");
    expect(() => AdCandidateSchema.parse({ candidateKind: "mystery" })).toThrow();
  });

  it("keeps remembered and available candidates in separate arrays", () => {
    const result = AdQueryResultSchema.parse({
      queryId: "q-1",
      tenant,
      mode: "both",
      at: 10_000,
      remembered: [rememberedCandidate],
      available: [availableCandidate],
    });
    expect(result.remembered).toHaveLength(1);
    expect(result.available).toHaveLength(1);
    expect(result.remembered[0]?.record.recordId).toBe(record.recordId);
    expect(result.available[0]?.availability.suppliedBy).toBe("host-ad-exchange");
  });

  it("enforces mode consistency: remembered mode cannot return available candidates", () => {
    expect(() =>
      AdQueryResultSchema.parse({
        queryId: "q-2",
        tenant,
        mode: "remembered",
        at: 10_000,
        remembered: [rememberedCandidate],
        available: [availableCandidate],
      }),
    ).toThrow(/must not return available candidates/);
  });

  it("enforces mode consistency: available mode cannot return remembered candidates", () => {
    expect(() =>
      AdQueryResultSchema.parse({
        queryId: "q-3",
        tenant,
        mode: "available",
        at: 10_000,
        remembered: [rememberedCandidate],
      }),
    ).toThrow(/must not return remembered candidates/);
  });
});

// ---------------------------------------------------------------------------
// Law 10 — encounter evidence accepts observed classes only
// ---------------------------------------------------------------------------

describe("law 10: same evidence-class rules as the rest of Reckon", () => {
  it("accepts every observed evidence class", () => {
    for (const evidenceClass of OBSERVED_EVIDENCE_CLASSES) {
      expect(AdEncounterEvidenceSchema.parse({ ...evidence, evidenceClass }).evidenceClass).toBe(evidenceClass);
    }
  });

  it("rejects simulated, counterfactual and fixture encounters", () => {
    for (const bad of ["simulated", "counterfactual", "fixture"] as const) {
      expect(() => AdEncounterEvidenceSchema.parse({ ...evidence, evidenceClass: bad })).toThrow();
    }
  });

  it("rejects an unknown evidence class", () => {
    expect(() =>
      AdEncounterEvidenceSchema.parse({ ...evidence, evidenceClass: "vibes" as never }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Permission / consent state
// ---------------------------------------------------------------------------

describe("permission state with append-only transitions", () => {
  const state = AdPermissionStateSchema.parse({ retain: "granted", present: "granted" });

  it("applies a valid transition and appends history", () => {
    const revoked = applyAdPermissionTransition(state, {
      capability: "present",
      from: "granted",
      to: "revoked",
      at: 5_000,
      consentRef: "consent-43",
      reason: "user paused ad re-shows",
    });
    expect(revoked.present).toBe("revoked");
    expect(revoked.retain).toBe("granted"); // untouched capability unchanged
    expect(revoked.history).toHaveLength(1);
    expect(state.history).toHaveLength(0); // original untouched (append-only)
  });

  it("rejects a transition whose from-state does not match (no history rewrite)", () => {
    expect(() =>
      applyAdPermissionTransition(state, {
        capability: "retain",
        from: "revoked",
        to: "granted",
        at: 5_000,
      }),
    ).toThrow(/transition mismatch/);
  });

  it("revoking retain makes the record unretrievable (revocation stops future use)", () => {
    const revoked = applyAdPermissionTransition(state, {
      capability: "retain",
      from: "granted",
      to: "revoked",
      at: 5_000,
    });
    expect(isAdMemoryRetrievable({ retention: record.retention, permissions: revoked }, 10_000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Eligibility → existing hard constraints
// ---------------------------------------------------------------------------

describe("ad eligibility projects onto the existing constraint vocabulary", () => {
  it("maps flight window to time-window and gates to policy-rights", () => {
    const eligibility = AdEligibilitySchema.parse({
      flight: { fromMs: 1_000, untilMs: 50_000 },
      gates: ["age-gate", "region-gate"],
      surfaces: ["in-stream"],
      hostFrequencyPolicy: { maxPerHour: 3 },
    });
    const constraints = adEligibilityToConstraints(eligibility);
    expect(constraints).toHaveLength(3);
    for (const constraint of constraints) {
      expect(() => HardConstraintSchema.parse(constraint)).not.toThrow();
    }
    expect(constraints[0]).toEqual({ kind: "time-window", fromMs: 1_000, untilMs: 50_000 });
    expect(constraints[1]).toEqual({ kind: "policy-rights", gateId: "age-gate" });
    expect(constraints[2]).toEqual({ kind: "policy-rights", gateId: "region-gate" });
  });

  it("projects nothing when nothing portable is declared", () => {
    expect(adEligibilityToConstraints(AdEligibilitySchema.parse({}))).toEqual([]);
    expect(
      adEligibilityToConstraints(AdEligibilitySchema.parse({ surfaces: ["feed-slot"], hostFrequencyPolicy: { x: 1 } })),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Ad Query request contracts
// ---------------------------------------------------------------------------

describe("AdQueryRequest", () => {
  it("parses a minimal request with prefaulted filters and default mode", () => {
    const request = AdQueryRequestSchema.parse({ queryId: "q-1", tenant, subject, at: 5_000 });
    expect(request.schema).toBe("reckon.ad-query-request");
    expect(request.mode).toBe("both");
    expect(request.filters.terms).toEqual([]);
    expect(request.filters.labels).toEqual([]);
  });

  it("requires the caller-supplied evaluation clock", () => {
    const { at: _at, ...withoutClock } = { queryId: "q-1", tenant, subject, at: 5_000 };
    expect(() => AdQueryRequestSchema.parse(withoutClock)).toThrow();
  });

  it("accepts the declared query modes and structured filters", () => {
    expect(AD_QUERY_MODES).toEqual(["remembered", "available", "both"]);
    const request = AdQueryRequestSchema.parse({
      queryId: "q-2",
      tenant,
      subject,
      mode: "remembered",
      text: "Show me the hotel ad I saw last week",
      filters: {
        terms: ["hotel"],
        labels: ["travel"],
        advertiserRefs: ["adv-7"],
        encounteredFrom: 0,
        encounteredUntil: 50_000,
        limit: 10,
      },
      context: { contextId: "ctx-1" },
      at: 60_000,
    });
    expect(request.filters.limit).toBe(10);
    expect(request.text).toContain("hotel");
  });

  it("rejects an unknown mode and oversized text", () => {
    expect(() =>
      AdQueryRequestSchema.parse({ queryId: "q-3", tenant, subject, mode: "everything", at: 1 }),
    ).toThrow();
    expect(() =>
      AdQueryRequestSchema.parse({ queryId: "q-4", tenant, subject, text: "x".repeat(1025), at: 1 }),
    ).toThrow();
  });

  it("discloses model-assisted query understanding on the result", () => {
    const result = AdQueryResultSchema.parse({
      queryId: "q-5",
      tenant,
      mode: "remembered",
      at: 10_000,
      remembered: [rememberedCandidate],
      queryUnderstanding: {
        terms: ["hotel", "accra", "stay"],
        modelProvenance: { system: "query-understanding-adapter", version: "1.3" },
      },
      notes: ["provider lane skipped in remembered mode"],
    });
    expect(result.queryUnderstanding?.modelProvenance?.system).toBe("query-understanding-adapter");
    expect(result.notes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Candidate resolution into the EXISTING decision path (no parallel ranking)
// ---------------------------------------------------------------------------

describe("adCandidatesToCandidateSet maps into the existing CandidateSet", () => {
  it("produces a valid CandidateSet with distinct provenance per lane", () => {
    const set = adCandidatesToCandidateSet("cs-ads-1", {
      remembered: [rememberedCandidateParsed],
      available: [availableCandidateParsed],
    });
    expect(() => CandidateSetSchema.parse(set)).not.toThrow();
    expect(set.setId).toBe("cs-ads-1");
    expect(set.candidates).toHaveLength(2);
    expect(set.candidates[0]).toEqual({
      itemId: "ad-hotel-accra-1",
      realizationIds: [],
      source: AD_CANDIDATE_SOURCES.remembered,
      rankHint: 1,
      scoreHint: 0.9,
    });
    expect(set.candidates[1]).toEqual({
      itemId: "ad-shoe-offer-1",
      realizationIds: [],
      source: AD_CANDIDATE_SOURCES.available,
      rankHint: 2,
      scoreHint: 0.4,
    });
    expect(AD_CANDIDATE_SOURCES.remembered).not.toBe(AD_CANDIDATE_SOURCES.available);
  });

  it("hints are retrieval hints, never decisions (positional rank, optional score)", () => {
    const noScores = adCandidatesToCandidateSet("cs-ads-2", {
      remembered: [{ ...rememberedCandidateParsed, whyRetrieved: [{ kind: "recency" }] }],
      available: [],
    });
    expect(noScores.candidates[0]?.rankHint).toBe(1);
    expect(noScores.candidates[0]?.scoreHint).toBeUndefined();
  });

  it("throws on an empty mapping (mirrors DecisionRequest's empty-set rejection)", () => {
    expect(() => adCandidatesToCandidateSet("cs-empty", { remembered: [], available: [] })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Retrievable record narrowing
// ---------------------------------------------------------------------------

describe("RetrievableAdMemoryRecordSchema", () => {
  it("accepts an active record and rejects non-active retention", () => {
    expect(() => RetrievableAdMemoryRecordSchema.parse(record)).not.toThrow();
    const expired = finalizeAdMemoryRecord({
      ...recordContent,
      retention: { state: "expired", basis: retentionBasis, expiresAt: 100_000 },
    });
    expect(() => RetrievableAdMemoryRecordSchema.parse(expired)).toThrow();
  });

  it("round-trips through AdMemoryRecordContentSchema", () => {
    const content = AdMemoryRecordContentSchema.parse(recordContent);
    expect(content.retention.state).toBe("active");
  });
});

// ---------------------------------------------------------------------------
// Generated JSON Schema artifacts (AD-001 targets in export-json-schemas.ts)
// ---------------------------------------------------------------------------

describe("generated JSON schemas include the ad contracts", () => {
  const adSchemaFiles = [
    "ad-memory-record.schema.json",
    "ad-query-request.schema.json",
    "ad-query-result.schema.json",
    "ad-forget-request.schema.json",
    "ad-forget-result.schema.json",
  ] as const;

  it("all five ad schema files exist with canonical $ids", () => {
    for (const file of adSchemaFiles) {
      const doc = JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8"));
      expect(doc.$id).toBe(`https://reckon.dev/schemas/${file}`);
    }
  });

  it("law 1 is machine-checkable in the artifact: every retention member requires basis", () => {
    const doc = JSON.parse(
      readFileSync(new URL("../schemas/ad-memory-record.schema.json", import.meta.url), "utf8"),
    );
    const retention = doc.properties.retention;
    expect(retention.anyOf).toHaveLength(3);
    for (const member of retention.anyOf) {
      expect(member.required).toContain("basis");
      expect(member.required).toContain("state");
    }
  });

  it("law 8 is machine-checkable in the artifact: ad.kind is const advertising", () => {
    const doc = JSON.parse(
      readFileSync(new URL("../schemas/ad-memory-record.schema.json", import.meta.url), "utf8"),
    );
    expect(doc.properties.ad.properties.kind.const).toBe("advertising");
  });

  it("law 10 is machine-checkable in the artifact: encounter evidence enum is observed-only", () => {
    const doc = JSON.parse(
      readFileSync(new URL("../schemas/ad-memory-record.schema.json", import.meta.url), "utf8"),
    );
    const encounterMember = doc.properties.provenance.anyOf[0];
    expect(encounterMember.properties.kind.const).toBe("observed-encounter");
    expect(encounterMember.properties.evidence.properties.evidenceClass.enum).toEqual([
      ...OBSERVED_EVIDENCE_CLASSES,
    ]);
  });

  it("law 4 is machine-checkable in the artifact: redistribution defaults to false", () => {
    const doc = JSON.parse(
      readFileSync(new URL("../schemas/ad-memory-record.schema.json", import.meta.url), "utf8"),
    );
    expect(doc.properties.rights.properties.redistributionPermitted.default).toBe(false);
  });
});
