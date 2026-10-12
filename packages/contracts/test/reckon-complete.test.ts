/**
 * SIM-001 — Reckon-Complete conformance profile contract tests.
 *
 * Proves:
 * 1. zod round-trips for every member of the `reckon.complete.*` family;
 * 2. discriminator-family exhaustiveness (RECKON_COMPLETE_CONTRACT_IDS ↔
 *    ReckonCompleteEnvelopeSchema members);
 * 3. the frozen vocabularies (capabilities / evidence classes / friction
 *    categories) are exactly the frozen unions;
 * 4. manifest + record + scorecard checksums are deterministic and
 *    content-scoped;
 * 5. evidence-class sufficiency semantics (simulated never satisfies an
 *    observed requirement);
 * 6. conformance evaluation categorization rules;
 * 7. generated JSON-schema parity (files, $ids, enums, friction-required law).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  // schemas
  ReckonCompleteProfileDeclarationSchema,
  ReckonCompleteCapabilityManifestSchema,
  ReckonCompleteConformanceVerdictSchema,
  IntegrationEffortRecordSchema,
  IntegrationEffortScorecardSchema,
  ReckonCompleteEnvelopeSchema,
  ReckonCompleteCapabilitySupportSchema,
  ReckonCompleteSupportedCapabilitySchema,
  // vocabularies
  RECKON_COMPLETE_CAPABILITIES,
  RECKON_COMPLETE_FRICTION_CATEGORIES,
  RECKON_COMPLETE_EVIDENCE_CLASSES,
  RECKON_COMPLETE_CONTRACT_IDS,
  RECKON_COMPLETE_SUPPORT_STATUSES,
  RECKON_COMPLETE_CONFORMANCE_STATES,
  EVIDENCE_CLASSES,
  // helpers
  finalizeReckonCompleteProfile,
  finalizeReckonCompleteCapabilityManifest,
  reckonCompleteManifestChecksum,
  evaluateReckonCompleteConformance,
  finalizeReckonCompleteConformanceVerdict,
  finalizeIntegrationEffortRecord,
  integrationEffortRecordChecksum,
  finalizeIntegrationEffortScorecard,
  evidenceClassSatisfies,
  weakestEvidenceClass,
  // types
  type ReckonCompleteProfileDeclaration,
  type ReckonCompleteCapabilityManifest,
} from "../src/index.js";
import type {
  ReckonCompleteProfileDeclarationInput,
  ReckonCompleteCapabilityManifestContentInput,
} from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LEVEL_1_PROFILE_INPUT = {
  profileId: "profile-level-1",
  name: "Static catalog picker",
  description: "Ladder level 1 — query a small catalog and return the best item.",
  ladderLevel: 1,
  requiredCapabilities: [
    { capability: "tenant-identity" },
    { capability: "catalog-registration" },
    { capability: "candidate-retrieval" },
    { capability: "objective-declaration" },
    { capability: "attention-policy" },
    { capability: "decision-request" },
    { capability: "outcome-return" },
    { capability: "preference-feedback" },
    { capability: "conformance-verification" },
  ],
  requiredEvidenceClass: "fixture" as const,
  declaredAt: 1_000,
} satisfies ReckonCompleteProfileDeclarationInput;

const level1Profile: ReckonCompleteProfileDeclaration = finalizeReckonCompleteProfile(LEVEL_1_PROFILE_INPUT);

const COMPLETE_MANIFEST_CONTENT = {
  manifestVersion: "1",
  hostSystem: {
    hostId: "host-minimal-1",
    name: "Minimal Static Picker",
    hostAdapterId: "adapter-minimal-static-1",
    version: "0.1.0",
  },
  declaredAt: 1_100,
  supportedCapabilities: [
    {
      capability: "tenant-identity",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: [],
      sdkMethods: [],
    },
    {
      capability: "catalog-registration",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: ["POST /v1/catalog/items"],
      sdkMethods: ["catalog.upsertItem"],
    },
    {
      capability: "candidate-retrieval",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: ["POST /v1/candidates"],
      sdkMethods: ["candidates.submit"],
    },
    {
      capability: "objective-declaration",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: [],
      sdkMethods: [],
    },
    {
      capability: "attention-policy",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: [],
      sdkMethods: [],
    },
    {
      capability: "decision-request",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: ["POST /v1/decisions"],
      sdkMethods: ["decisions.request"],
    },
    {
      capability: "outcome-return",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: ["POST /v1/outcomes"],
      sdkMethods: ["outcomes.append"],
    },
    {
      capability: "preference-feedback",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: ["POST /v1/preferences/events"],
      sdkMethods: ["preferences.appendDelta"],
    },
    {
      capability: "conformance-verification",
      status: "supported" as const,
      evidenceClass: "fixture" as const,
      apiOperations: [],
      sdkMethods: [],
    },
  ],
} satisfies ReckonCompleteCapabilityManifestContentInput;

const completeManifest: ReckonCompleteCapabilityManifest = finalizeReckonCompleteCapabilityManifest(
  COMPLETE_MANIFEST_CONTENT,
  "manifest-minimal-1",
);

// ---------------------------------------------------------------------------
// Frozen vocabularies
// ---------------------------------------------------------------------------

describe("frozen vocabularies", () => {
  it("capability names are the frozen 20-member literal union", () => {
    expect([...RECKON_COMPLETE_CAPABILITIES]).toHaveLength(20);
    expect(new Set(RECKON_COMPLETE_CAPABILITIES).size).toBe(20);
    // Spot anchors from the ladder's target onboarding flow.
    expect(RECKON_COMPLETE_CAPABILITIES).toContain("decision-request");
    expect(RECKON_COMPLETE_CAPABILITIES).toContain("outcome-return");
    expect(RECKON_COMPLETE_CAPABILITIES).toContain("conformance-verification");
    expect(RECKON_COMPLETE_CAPABILITIES).toContain("ad-memory");
    expect(RECKON_COMPLETE_CAPABILITIES).toContain("agent-delegation");
  });

  it("friction categories are the exact ladder-doc list (11 members)", () => {
    expect([...RECKON_COMPLETE_FRICTION_CATEGORIES]).toEqual([
      "CONTRACT_GAP",
      "API_GAP",
      "SDK_GAP",
      "COMPOSITION_GAP",
      "PERSISTENCE_GAP",
      "CAPABILITY_GAP",
      "ADAPTER_GAP",
      "OBSERVABILITY_GAP",
      "UX_DX_GAP",
      "HOST_RESPONSIBILITY",
      "RIGHTS_POLICY_BOUNDARY",
    ]);
  });

  it("evidence classes alias the frozen primitives vocabulary (single source)", () => {
    expect([...RECKON_COMPLETE_EVIDENCE_CLASSES]).toEqual([...EVIDENCE_CLASSES]);
    expect([...RECKON_COMPLETE_EVIDENCE_CLASSES]).toContain("simulated");
    expect([...RECKON_COMPLETE_EVIDENCE_CLASSES]).toContain("production-observed");
  });

  it("the discriminator family ids are frozen and distinct", () => {
    expect([...RECKON_COMPLETE_CONTRACT_IDS]).toHaveLength(5);
    expect(new Set(RECKON_COMPLETE_CONTRACT_IDS).size).toBe(5);
    for (const id of RECKON_COMPLETE_CONTRACT_IDS) {
      expect(id.startsWith("reckon.complete.")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Round-trips + family exhaustiveness
// ---------------------------------------------------------------------------

describe("zod round-trips", () => {
  it("profile declaration round-trips (parse → serialize → parse)", () => {
    const json = JSON.stringify(level1Profile);
    const reparsed = ReckonCompleteProfileDeclarationSchema.parse(JSON.parse(json));
    expect(reparsed).toEqual(level1Profile);
    expect(reparsed.schema).toBe("reckon.complete.profile-declaration");
  });

  it("profile applies defaults for schema/schemaVersion", () => {
    const parsed = ReckonCompleteProfileDeclarationSchema.parse({
      ...LEVEL_1_PROFILE_INPUT,
      // schema omitted → default applies
    });
    expect(parsed.schema).toBe("reckon.complete.profile-declaration");
    expect(parsed.schemaVersion).toBe("0.1.0");
  });

  it("capability manifest round-trips and rejects a bad checksum", () => {
    const json = JSON.stringify(completeManifest);
    const reparsed = ReckonCompleteCapabilityManifestSchema.parse(JSON.parse(json));
    expect(reparsed.checksum).toBe(completeManifest.checksum);
    expect(() =>
      ReckonCompleteCapabilityManifestSchema.parse({
        ...completeManifest,
        checksum: "0".repeat(64),
      }),
    ).not.toThrow(); // structural check only — checksum verification is semantic
    expect(() =>
      ReckonCompleteCapabilityManifestSchema.parse({
        ...completeManifest,
        checksum: "not-hex",
      }),
    ).toThrow(); // hex64 pattern is structural
  });

  it("capability support union requires friction on partial and gap", () => {
    expect(() =>
      ReckonCompleteCapabilitySupportSchema.parse({
        capability: "plan-management",
        status: "partial",
        evidenceClass: "fixture",
        // friction missing → rejected
      }),
    ).toThrow();
    expect(() =>
      ReckonCompleteCapabilitySupportSchema.parse({
        capability: "plan-management",
        status: "gap",
        // friction missing → rejected
      }),
    ).toThrow();
    expect(() =>
      ReckonCompleteCapabilitySupportSchema.parse({
        capability: "plan-management",
        status: "gap",
        friction: "API_GAP",
      }),
    ).not.toThrow();
  });

  it("unknown capability names are rejected (frozen vocabulary)", () => {
    expect(() =>
      ReckonCompleteSupportedCapabilitySchema.parse({
        capability: "teleportation",
        status: "supported",
        evidenceClass: "fixture",
      }),
    ).toThrow();
  });

  it("effort record round-trips through finalize", () => {
    const record = finalizeIntegrationEffortRecord(
      {
        runId: "run-1",
        harnessVersion: "0.1.0",
        seed: "42",
        hostAdapterId: completeManifest.hostSystem.hostAdapterId,
        hostSystem: completeManifest.hostSystem,
        profileId: level1Profile.profileId,
        ladderLevel: 1,
        manifestId: completeManifest.manifestId,
        manifestChecksum: completeManifest.checksum,
        evidenceClass: "fixture",
        apiOperations: ["POST /v1/decisions"],
        sdkMethods: ["decisions.request"],
        glue: { functions: 3, loc: 120, customAdapterLoc: 40 },
        internalImports: 0,
        timing: { firstDecisionMs: 12, firstDecisionSteps: 1, fullLoopMs: 40, fullLoopSteps: 1 },
        latency: { p50Ms: 10, p95Ms: 30, samples: 5 },
        failures: { count: 1, retriedCount: 1, retryCount: 1, exhaustedCount: 0 },
        capabilityCoverage: {
          required: 9,
          satisfied: 9,
          partial: 0,
          missing: 0,
          coverageRatio: 1,
          perCapability: [],
        },
        gaps: [],
        replayInputs: {
          seed: "42",
          manifestChecksum: completeManifest.checksum,
          hostAdapterId: completeManifest.hostSystem.hostAdapterId,
          harnessVersion: "0.1.0",
          steps: 5,
          faultRate: 0,
          maxRetries: 2,
          clockStartMs: 0,
          clockStepMs: 1000,
        },
        completedAt: 9_999,
      },
      "record-1",
    );
    expect(record.schema).toBe("reckon.complete.integration-effort-record");
    expect(IntegrationEffortRecordSchema.parse(JSON.parse(JSON.stringify(record)))).toEqual(record);
  });

  it("scorecard round-trips through finalize", () => {
    const scorecard = finalizeIntegrationEffortScorecard(
      {
        generatedAt: 10_000,
        aggregate: {
          runCount: 1,
          distinctHosts: 1,
          distinctLevels: 1,
          medianGlueLoc: 120,
          p95GlueLoc: 120,
          medianFirstDecisionMs: 12,
          p95FirstDecisionMs: 12,
          medianFullLoopMs: 40,
          p95FullLoopMs: 40,
          medianLatencyP50Ms: 10,
          p95LatencyP95Ms: 30,
          meanCapabilityCoverageRatio: 1,
          totalFailures: 0,
          totalRetries: 0,
        },
        recurringGaps: [],
        records: [
          {
            recordId: "record-1",
            runId: "run-1",
            hostAdapterId: "adapter-minimal-static-1",
            ladderLevel: 1,
            recordChecksum: "a".repeat(64),
          },
        ],
      },
      "scorecard-1",
    );
    expect(scorecard.schema).toBe("reckon.complete.integration-effort-scorecard");
    expect(IntegrationEffortScorecardSchema.parse(JSON.parse(JSON.stringify(scorecard)))).toEqual(
      scorecard,
    );
  });
});

describe("discriminator family exhaustiveness", () => {
  it("every family member parses through ReckonCompleteEnvelopeSchema by its discriminator", () => {
    const verdict = finalizeReckonCompleteConformanceVerdict({
      verdictId: "verdict-1",
      measuredAt: 1_200,
      profile: level1Profile,
      manifest: completeManifest,
    });
    const record = finalizeIntegrationEffortRecord(
      {
        runId: "run-1",
        harnessVersion: "0.1.0",
        seed: "42",
        hostAdapterId: completeManifest.hostSystem.hostAdapterId,
        hostSystem: completeManifest.hostSystem,
        profileId: level1Profile.profileId,
        manifestId: completeManifest.manifestId,
        manifestChecksum: completeManifest.checksum,
        evidenceClass: "fixture",
        apiOperations: [],
        sdkMethods: [],
        glue: { functions: 0, loc: 0, customAdapterLoc: 0 },
        internalImports: 0,
        timing: { firstDecisionMs: 1, firstDecisionSteps: 1, fullLoopMs: 1, fullLoopSteps: 1 },
        latency: { p50Ms: 1, p95Ms: 1, samples: 1 },
        failures: { count: 0, retriedCount: 0, retryCount: 0, exhaustedCount: 0 },
        capabilityCoverage: {
          required: 9,
          satisfied: 9,
          partial: 0,
          missing: 0,
          coverageRatio: 1,
          perCapability: [],
        },
        gaps: [],
        replayInputs: {
          seed: "42",
          manifestChecksum: completeManifest.checksum,
          hostAdapterId: completeManifest.hostSystem.hostAdapterId,
          harnessVersion: "0.1.0",
          steps: 1,
          faultRate: 0,
          maxRetries: 0,
          clockStartMs: 0,
          clockStepMs: 1,
        },
        completedAt: 1_300,
      },
      "record-1",
    );
    const scorecard = finalizeIntegrationEffortScorecard(
      {
        generatedAt: 1_400,
        aggregate: {
          runCount: 1,
          distinctHosts: 1,
          distinctLevels: 1,
          medianGlueLoc: 0,
          p95GlueLoc: 0,
          medianFirstDecisionMs: 1,
          p95FirstDecisionMs: 1,
          medianFullLoopMs: 1,
          p95FullLoopMs: 1,
          medianLatencyP50Ms: 1,
          p95LatencyP95Ms: 1,
          meanCapabilityCoverageRatio: 1,
          totalFailures: 0,
          totalRetries: 0,
        },
        recurringGaps: [],
        records: [
          {
            recordId: "record-1",
            runId: "run-1",
            hostAdapterId: "adapter-minimal-static-1",
            recordChecksum: record.checksum,
          },
        ],
      },
      "scorecard-1",
    );

    const envelopes = [level1Profile, completeManifest, verdict, record, scorecard];
    expect(envelopes).toHaveLength(RECKON_COMPLETE_CONTRACT_IDS.length);
    const seen = new Set<string>();
    for (const envelope of envelopes) {
      const parsed = ReckonCompleteEnvelopeSchema.parse(envelope);
      seen.add(parsed.schema);
    }
    expect([...seen].sort()).toEqual([...RECKON_COMPLETE_CONTRACT_IDS].sort());
  });

  it("a foreign discriminator is rejected by the family union", () => {
    expect(() =>
      ReckonCompleteEnvelopeSchema.parse({ schema: "reckon.complete.nope", profileId: "x" }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Checksums + invariants
// ---------------------------------------------------------------------------

describe("manifest checksums and invariants", () => {
  it("same content ⇒ same checksum; different content ⇒ different checksum", () => {
    const a = finalizeReckonCompleteCapabilityManifest(COMPLETE_MANIFEST_CONTENT, "manifest-a");
    const b = finalizeReckonCompleteCapabilityManifest(COMPLETE_MANIFEST_CONTENT, "manifest-b");
    // The checksum covers CONTENT (manifestId excluded) — id differs, checksum equal.
    expect(a.checksum).toBe(b.checksum);
    expect(reckonCompleteManifestChecksum(COMPLETE_MANIFEST_CONTENT)).toBe(a.checksum);

    const changed = finalizeReckonCompleteCapabilityManifest(
      {
        ...COMPLETE_MANIFEST_CONTENT,
        supportedCapabilities: COMPLETE_MANIFEST_CONTENT.supportedCapabilities.slice(0, -1),
      },
      "manifest-a",
    );
    expect(changed.checksum).not.toBe(a.checksum);
  });

  it("duplicate capabilities are rejected by finalize", () => {
    expect(() =>
      finalizeReckonCompleteCapabilityManifest(
        {
          ...COMPLETE_MANIFEST_CONTENT,
          supportedCapabilities: [
            ...COMPLETE_MANIFEST_CONTENT.supportedCapabilities,
            COMPLETE_MANIFEST_CONTENT.supportedCapabilities[0]!,
          ],
        },
        "manifest-dup",
      ),
    ).toThrow(/duplicate capability/);
  });

  it("duplicate required capabilities are rejected by profile finalize", () => {
    expect(() =>
      finalizeReckonCompleteProfile({
        ...LEVEL_1_PROFILE_INPUT,
        requiredCapabilities: [
          ...LEVEL_1_PROFILE_INPUT.requiredCapabilities,
          { capability: "decision-request" },
        ],
      }),
    ).toThrow(/duplicate required capability/);
  });

  it("effort-record and scorecard checksums are content-scoped", () => {
    const content = {
      runId: "run-x",
      harnessVersion: "0.1.0",
      seed: "7",
      hostAdapterId: "adapter-1",
      hostSystem: COMPLETE_MANIFEST_CONTENT.hostSystem,
      profileId: "profile-level-1",
      manifestId: "manifest-minimal-1",
      manifestChecksum: completeManifest.checksum,
      evidenceClass: "fixture" as const,
      apiOperations: [] as string[],
      sdkMethods: [] as string[],
      glue: { functions: 1, loc: 2, customAdapterLoc: 3 },
      internalImports: 0,
      timing: { firstDecisionMs: 1, firstDecisionSteps: 1, fullLoopMs: 2, fullLoopSteps: 2 },
      latency: { p50Ms: 1, p95Ms: 2, samples: 3 },
      failures: { count: 0, retriedCount: 0, retryCount: 0, exhaustedCount: 0 },
      capabilityCoverage: {
        required: 1,
        satisfied: 1,
        partial: 0,
        missing: 0,
        coverageRatio: 1,
        perCapability: [],
      },
      gaps: [],
      replayInputs: {
        seed: "7",
        manifestChecksum: completeManifest.checksum,
        hostAdapterId: "adapter-1",
        harnessVersion: "0.1.0",
        steps: 1,
        faultRate: 0,
        maxRetries: 0,
        clockStartMs: 0,
        clockStepMs: 1,
      },
      completedAt: 5,
    };
    expect(integrationEffortRecordChecksum(content)).toBe(
      integrationEffortRecordChecksum(JSON.parse(JSON.stringify(content))),
    );
    const r1 = finalizeIntegrationEffortRecord(content, "record-a");
    const r2 = finalizeIntegrationEffortRecord(content, "record-b");
    expect(r1.checksum).toBe(r2.checksum); // recordId is outside the digest
  });
});

// ---------------------------------------------------------------------------
// Evidence-class sufficiency semantics
// ---------------------------------------------------------------------------

describe("evidence-class sufficiency", () => {
  it("observed classes satisfy weaker observed requirements", () => {
    expect(evidenceClassSatisfies("fixture", "fixture")).toBe(true);
    expect(evidenceClassSatisfies("controlled-local", "fixture")).toBe(true);
    expect(evidenceClassSatisfies("production-observed", "staging")).toBe(true);
    expect(evidenceClassSatisfies("fixture", "staging")).toBe(false);
    expect(evidenceClassSatisfies("staging", "production-observed")).toBe(false);
  });

  it("simulated/counterfactual NEVER satisfy observed requirements", () => {
    expect(evidenceClassSatisfies("simulated", "fixture")).toBe(false);
    expect(evidenceClassSatisfies("simulated", "production-observed")).toBe(false);
    expect(evidenceClassSatisfies("counterfactual", "controlled-local")).toBe(false);
  });

  it("research requirements need exact research matches (observed is not a substitute)", () => {
    expect(evidenceClassSatisfies("simulated", "simulated")).toBe(true);
    expect(evidenceClassSatisfies("counterfactual", "counterfactual")).toBe(true);
    expect(evidenceClassSatisfies("counterfactual", "simulated")).toBe(false);
    expect(evidenceClassSatisfies("production-observed", "counterfactual")).toBe(false);
  });

  it("weakestEvidenceClass returns the minimum observed class and taints on research", () => {
    expect(weakestEvidenceClass(["staging", "fixture", "controlled-local"])).toBe("fixture");
    expect(weakestEvidenceClass(["staging", "simulated"])).toBe("simulated");
    expect(weakestEvidenceClass([])).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Conformance evaluation
// ---------------------------------------------------------------------------

describe("conformance evaluation", () => {
  it("a complete manifest against its profile is Reckon-Complete", () => {
    const assessment = evaluateReckonCompleteConformance(level1Profile, completeManifest);
    expect(assessment.reckonComplete).toBe(true);
    expect(assessment.coverage.required).toBe(9);
    expect(assessment.coverage.satisfied).toBe(9);
    expect(assessment.coverage.missing).toBe(0);
    expect(assessment.coverage.coverageRatio).toBe(1);
    expect(assessment.gaps).toHaveLength(0);
    expect(assessment.evidenceClass).toBe("fixture");
    expect(assessment.evidenceSufficient).toBe(true);
  });

  it("a required capability absent from the manifest is a CAPABILITY_GAP", () => {
    const partialContent = {
      ...COMPLETE_MANIFEST_CONTENT,
      supportedCapabilities: COMPLETE_MANIFEST_CONTENT.supportedCapabilities.filter(
        (c: { capability: string }) => c.capability !== "preference-feedback",
      ),
    };
    const manifest = finalizeReckonCompleteCapabilityManifest(partialContent, "manifest-partial");
    const assessment = evaluateReckonCompleteConformance(level1Profile, manifest);
    expect(assessment.reckonComplete).toBe(false);
    expect(assessment.coverage.missing).toBe(1);
    expect(assessment.gaps).toEqual([
      expect.objectContaining({ capability: "preference-feedback", friction: "CAPABILITY_GAP" }),
    ]);
  });

  it("a declared gap surfaces the DECLARED friction verbatim", () => {
    const content = {
      ...COMPLETE_MANIFEST_CONTENT,
      supportedCapabilities: COMPLETE_MANIFEST_CONTENT.supportedCapabilities.map((c: any) =>
        c.capability === "preference-feedback"
          ? {
              capability: "preference-feedback",
              status: "gap" as const,
              friction: "PERSISTENCE_GAP" as const,
              notes: "host has no preference store yet",
            }
          : c,
      ),
    };
    const manifest = finalizeReckonCompleteCapabilityManifest(content, "manifest-gap");
    const assessment = evaluateReckonCompleteConformance(level1Profile, manifest);
    expect(assessment.reckonComplete).toBe(false);
    expect(assessment.gaps).toEqual([
      expect.objectContaining({
        capability: "preference-feedback",
        friction: "PERSISTENCE_GAP",
        detail: "host has no preference store yet",
      }),
    ]);
  });

  it("a partial capability is surfaced with its declared friction", () => {
    const content = {
      ...COMPLETE_MANIFEST_CONTENT,
      supportedCapabilities: COMPLETE_MANIFEST_CONTENT.supportedCapabilities.map((c: any) =>
        c.capability === "outcome-return"
          ? {
              ...c,
              status: "partial" as const,
              friction: "ADAPTER_GAP" as const,
              notes: "outcome batching incomplete",
            }
          : c,
      ),
    };
    const manifest = finalizeReckonCompleteCapabilityManifest(content, "manifest-partial-status");
    const assessment = evaluateReckonCompleteConformance(level1Profile, manifest);
    expect(assessment.reckonComplete).toBe(false);
    expect(assessment.coverage.partial).toBe(1);
    expect(assessment.gaps).toEqual([
      expect.objectContaining({ capability: "outcome-return", friction: "ADAPTER_GAP" }),
    ]);
  });

  it("insufficient evidence is an OBSERVABILITY_GAP, never a silent pass", () => {
    // Profile requires production-observed; manifest offers fixture only.
    const strictProfile = finalizeReckonCompleteProfile({
      ...LEVEL_1_PROFILE_INPUT,
      profileId: "profile-strict",
      requiredEvidenceClass: "production-observed" as const,
    });
    const assessment = evaluateReckonCompleteConformance(strictProfile, completeManifest);
    expect(assessment.reckonComplete).toBe(false);
    expect(assessment.evidenceSufficient).toBe(false);
    expect(assessment.gaps.filter((g) => g.friction === "OBSERVABILITY_GAP")).toHaveLength(9);
    // Simulated evidence never masquerades as observed either.
    const simulatedContent = {
      ...COMPLETE_MANIFEST_CONTENT,
      supportedCapabilities: COMPLETE_MANIFEST_CONTENT.supportedCapabilities.map((c: any) => ({
        ...c,
        evidenceClass: "simulated" as const,
      })),
    };
    const simulatedManifest = finalizeReckonCompleteCapabilityManifest(
      simulatedContent,
      "manifest-sim",
    );
    const simAssessment = evaluateReckonCompleteConformance(strictProfile, simulatedManifest);
    expect(simAssessment.reckonComplete).toBe(false);
    expect(simAssessment.evidenceClass).toBe("simulated");
  });

  it("a verdict envelope assembles and parses", () => {
    const verdict = finalizeReckonCompleteConformanceVerdict({
      verdictId: "verdict-complete",
      measuredAt: 2_000,
      profile: level1Profile,
      manifest: completeManifest,
    });
    expect(verdict.reckonComplete).toBe(true);
    expect(verdict.profileId).toBe("profile-level-1");
    expect(verdict.manifestChecksum).toBe(completeManifest.checksum);
    expect(ReckonCompleteConformanceVerdictSchema.parse(JSON.parse(JSON.stringify(verdict)))).toEqual(
      verdict,
    );
  });

  it("per-capability evidence floors override the profile-wide floor", () => {
    const mixedProfile = finalizeReckonCompleteProfile({
      ...LEVEL_1_PROFILE_INPUT,
      profileId: "profile-mixed",
      requiredEvidenceClass: "fixture" as const,
      requiredCapabilities: [
        { capability: "decision-request", minimumEvidenceClass: "staging" as const },
        { capability: "outcome-return" },
      ],
    });
    const assessment = evaluateReckonCompleteConformance(mixedProfile, completeManifest);
    expect(assessment.reckonComplete).toBe(false);
    expect(assessment.gaps).toEqual([
      expect.objectContaining({ capability: "decision-request", friction: "OBSERVABILITY_GAP" }),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Generated JSON-schema parity
// ---------------------------------------------------------------------------

describe("generated JSON schemas include the Reckon-Complete family", () => {
  const familyFiles = [
    "reckon-complete-profile-declaration.schema.json",
    "reckon-complete-capability-manifest.schema.json",
    "reckon-complete-conformance-verdict.schema.json",
    "integration-effort-record.schema.json",
    "integration-effort-scorecard.schema.json",
  ] as const;

  const readDoc = (file: string): any =>
    JSON.parse(readFileSync(new URL(`../schemas/${file}`, import.meta.url), "utf8"));

  it("all five family files exist with canonical $ids", () => {
    for (const file of familyFiles) {
      const doc = readDoc(file);
      expect(doc.$id).toBe(`https://reckon.dev/schemas/${file}`);
    }
  });

  it("the capability enum in the artifacts equals the frozen vocabulary", () => {
    const profileDoc = readDoc("reckon-complete-profile-declaration.schema.json");
    const capabilitySchema = profileDoc.properties.requiredCapabilities.items.properties.capability;
    expect(capabilitySchema.enum).toEqual([...RECKON_COMPLETE_CAPABILITIES]);
  });

  it("the friction-required law is machine-checkable in the manifest artifact", () => {
    const doc = readDoc("reckon-complete-capability-manifest.schema.json");
    const members = doc.properties.supportedCapabilities.items.anyOf;
    expect(members).toHaveLength(3);
    const byStatus = new Map<string, any>();
    for (const member of members) {
      byStatus.set(member.properties.status.const as string, member);
    }
    expect([...byStatus.keys()].sort()).toEqual([...RECKON_COMPLETE_SUPPORT_STATUSES].sort());
    // Every non-supported member REQUIRES friction.
    for (const status of ["partial", "gap"]) {
      expect(byStatus.get(status)!.required).toContain("friction");
    }
    // Supported members require the evidence class instead.
    expect(byStatus.get("supported")!.required).toContain("evidenceClass");
    expect(byStatus.get("supported")!.required).not.toContain("friction");
    // The friction enum is the frozen 11-member vocabulary.
    expect(byStatus.get("gap")!.properties.friction.enum).toEqual([
      ...RECKON_COMPLETE_FRICTION_CATEGORIES,
    ]);
  });

  it("the evidence-class enums in the artifacts equal the frozen primitives vocabulary", () => {
    const manifestDoc = readDoc("reckon-complete-capability-manifest.schema.json");
    const supportedMember = manifestDoc.properties.supportedCapabilities.items.anyOf.find(
      (m: any) => m.properties.status.const === "supported",
    );
    expect(supportedMember.properties.evidenceClass.enum).toEqual([...EVIDENCE_CLASSES]);
  });

  it("the effort record artifact carries the replay-gate block and the zero-internal-imports field", () => {
    const doc = readDoc("integration-effort-record.schema.json");
    expect(doc.properties.replayInputs.required).toContain("seed");
    expect(doc.properties.replayInputs.required).toContain("manifestChecksum");
    expect(doc.properties.replayInputs.required).toContain("hostAdapterId");
    expect(doc.properties.replayInputs.required).toContain("steps");
    expect(doc.properties.internalImports).toBeDefined();
    expect(doc.properties.latency.required).toEqual(["p50Ms", "p95Ms", "samples"]);
    expect(doc.properties.timing.required).toEqual([
      "firstDecisionMs",
      "firstDecisionSteps",
      "fullLoopMs",
      "fullLoopSteps",
    ]);
  });

  it("the scorecard artifact carries the 3-domain platform-upgrade fields", () => {
    const doc = readDoc("integration-effort-scorecard.schema.json");
    const gapItem = doc.properties.recurringGaps.items;
    expect(gapItem.required).toContain("domainCount");
    expect(gapItem.required).toContain("platformUpgradeCandidate");
    expect(gapItem.properties.ladderLevels).toBeDefined();
  });

  it("the verdict artifact exposes the conformance-state vocabulary", () => {
    const doc = readDoc("reckon-complete-conformance-verdict.schema.json");
    const stateEnum = doc.properties.coverage.properties.perCapability.items.properties.state.enum;
    expect(stateEnum).toEqual([...RECKON_COMPLETE_CONFORMANCE_STATES]);
  });
});
